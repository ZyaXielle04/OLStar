from flask import Blueprint, jsonify, request
from firebase_admin import db
from decorators import admin_required
import random
import string
import logging
from datetime import datetime, timedelta
from functools import wraps

admin_transport_units = Blueprint("admin_transport_units", __name__)

# =======================
# CACHING SYSTEM
# =======================
class TransportCache:
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.default_ttl = 3600  # 1 hour default cache
    
    def get(self, key):
        """Get cached data if not expired"""
        if key in self.cache and key in self.cache_time:
            age = (datetime.now() - self.cache_time[key]).total_seconds()
            ttl = self.cache.get(f"{key}_ttl", self.default_ttl)
            if age < ttl:
                return self.cache[key]
        return None
    
    def set(self, key, value, ttl=3600):
        """Cache data with TTL in seconds"""
        self.cache[key] = value
        self.cache_time[key] = datetime.now()
        self.cache[f"{key}_ttl"] = ttl
    
    def clear(self, pattern=None):
        """Clear cache"""
        if pattern:
            keys_to_delete = [k for k in self.cache.keys() if pattern in k]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.cache_time.pop(key, None)
        else:
            self.cache.clear()
            self.cache_time.clear()

# Initialize cache
transport_cache = TransportCache()

# =======================
# RATE LIMITING
# =======================
class RateLimiter:
    def __init__(self, max_requests=60, time_window=60):
        self.max_requests = max_requests
        self.time_window = time_window
        self.requests = {}
    
    def is_allowed(self, user_id):
        """Check if user is within rate limit"""
        now = datetime.now().timestamp()
        if user_id not in self.requests:
            self.requests[user_id] = []
        
        # Clean old requests
        self.requests[user_id] = [req_time for req_time in self.requests[user_id] 
                                   if now - req_time < self.time_window]
        
        if len(self.requests[user_id]) >= self.max_requests:
            return False
        
        self.requests[user_id].append(now)
        return True

rate_limiter = RateLimiter(max_requests=60, time_window=60)

def rate_limit(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = request.headers.get('X-User-ID', request.remote_addr)
        if not rate_limiter.is_allowed(user_id):
            return jsonify({"error": "Rate limit exceeded. Please wait before making more requests."}), 429
        return f(*args, **kwargs)
    return decorated_function

# -------------------------------
# Helper: Generate XXXYYY unit_id
# -------------------------------
def generate_unit_id():
    """Generate unique unit ID with retry logic"""
    ref = db.reference("transportUnits")
    max_attempts = 10
    
    for _ in range(max_attempts):
        numbers = f"{random.randint(0, 999):03d}"  # XXX
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))  # YYY
        unit_id = f"{numbers}{letters}"
        
        # Check uniqueness efficiently using shallow get
        if not ref.child(unit_id).get(shallow=True):
            return unit_id
    
    # Fallback: use timestamp-based ID
    return f"{int(datetime.now().timestamp())}{random.randint(100, 999)}"

# -------------------------------
# OPTIMIZED: GET all transport units
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units", methods=["GET"])
@admin_required
@rate_limit
def get_transport_units():
    """Get all transport units with caching"""
    try:
        # Check cache first
        cached_data = transport_cache.get("all_units")
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch from Firebase
        units_ref = db.reference("transportUnits")
        units_snapshot = units_ref.get() or {}
        
        # Transform to consistent format
        units_list = []
        for unit_id, unit_data in units_snapshot.items():
            if unit_data:  # Only add if data exists
                units_list.append({
                    "id": unit_id,
                    "unitType": unit_data.get("unitType", ""),
                    "name": unit_data.get("transportUnit", ""),
                    "color": unit_data.get("color", ""),
                    "plateNo": unit_data.get("plateNumber", "")
                })
        
        # Sort by name for consistent display
        units_list.sort(key=lambda x: x.get("name", "").lower())
        
        response = {
            "units": units_list,
            "count": len(units_list),
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache for 1 hour (transport units rarely change)
        transport_cache.set("all_units", response, ttl=3600)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching transport units: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# OPTIMIZED: CREATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units", methods=["POST"])
@admin_required
@rate_limit
def create_transport_unit():
    """Create a new transport unit"""
    try:
        data = request.json or {}
        
        # Validate required fields
        required_fields = ["unitType", "transportUnit", "color", "plateNumber"]
        missing_fields = [f for f in required_fields if not data.get(f)]
        if missing_fields:
            return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400
        
        # Generate unique ID
        unit_id = generate_unit_id()
        
        # Create unit object
        unit = {
            "unitType": data.get("unitType").strip(),
            "transportUnit": data.get("transportUnit").strip(),
            "color": data.get("color").strip(),
            "plateNumber": data.get("plateNumber").strip().upper(),
            "createdAt": {".sv": "timestamp"},
            "updatedAt": {".sv": "timestamp"}
        }
        
        # Save to Firebase
        db.reference(f"transportUnits/{unit_id}").set(unit)
        
        # Clear cache
        transport_cache.clear("all_units")
        
        # Return created unit
        return jsonify({
            "message": "Transport unit created successfully",
            "unit_id": unit_id,
            "unit": {
                "id": unit_id,
                "unitType": unit["unitType"],
                "name": unit["transportUnit"],
                "color": unit["color"],
                "plateNo": unit["plateNumber"]
            }
        }), 201
        
    except Exception as e:
        logging.error(f"Error creating transport unit: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# OPTIMIZED: UPDATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["PUT"])
@admin_required
@rate_limit
def update_transport_unit(unit_id):
    """Update an existing transport unit"""
    try:
        data = request.json or {}
        
        # Check if unit exists
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        existing = unit_ref.get(shallow=True)
        if not existing:
            return jsonify({"error": "Transport unit not found"}), 404
        
        # Prepare updates
        updates = {}
        if "unitType" in data and data["unitType"]:
            updates["unitType"] = data["unitType"].strip()
        if "transportUnit" in data and data["transportUnit"]:
            updates["transportUnit"] = data["transportUnit"].strip()
        if "color" in data and data["color"]:
            updates["color"] = data["color"].strip()
        if "plateNumber" in data and data["plateNumber"]:
            updates["plateNumber"] = data["plateNumber"].strip().upper()
        
        if not updates:
            return jsonify({"error": "No valid fields to update"}), 400
        
        # Add updated timestamp
        updates["updatedAt"] = {".sv": "timestamp"}
        
        # Update in Firebase
        unit_ref.update(updates)
        
        # Clear cache
        transport_cache.clear("all_units")
        
        return jsonify({
            "message": "Transport unit updated successfully",
            "success": True
        }), 200
        
    except Exception as e:
        logging.error(f"Error updating transport unit {unit_id}: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# OPTIMIZED: DELETE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["DELETE"])
@admin_required
@rate_limit
def delete_transport_unit(unit_id):
    """Delete a transport unit"""
    try:
        # Check if unit exists and not assigned to any user
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        existing = unit_ref.get()
        if not existing:
            return jsonify({"error": "Transport unit not found"}), 404
        
        # Check if unit is assigned to any user
        users_ref = db.reference("users")
        users_snapshot = users_ref.order_by_child("defaultTransportUnit").equal_to(unit_id).get(shallow=True)
        
        if users_snapshot and len(users_snapshot) > 0:
            return jsonify({
                "error": "Cannot delete transport unit that is assigned to one or more users. Please reassign users first."
            }), 400
        
        # Delete the unit
        unit_ref.delete()
        
        # Clear cache
        transport_cache.clear("all_units")
        
        return jsonify({
            "message": "Transport unit deleted successfully",
            "success": True
        }), 200
        
    except Exception as e:
        logging.error(f"Error deleting transport unit {unit_id}: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# OPTIMIZED: GET single transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["GET"])
@admin_required
@rate_limit
def get_transport_unit(unit_id):
    """Get a single transport unit by ID"""
    try:
        # Check cache
        cache_key = f"unit_{unit_id}"
        cached_data = transport_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch from Firebase
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        unit_data = unit_ref.get()
        
        if not unit_data:
            return jsonify({"error": "Transport unit not found"}), 404
        
        response = {
            "id": unit_id,
            "unitType": unit_data.get("unitType", ""),
            "name": unit_data.get("transportUnit", ""),
            "color": unit_data.get("color", ""),
            "plateNo": unit_data.get("plateNumber", "")
        }
        
        # Cache for 1 hour
        transport_cache.set(cache_key, response, ttl=3600)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching transport unit {unit_id}: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# OPTIMIZED: Bulk import transport units
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/bulk", methods=["POST"])
@admin_required
@rate_limit
def bulk_import_units():
    """Bulk import multiple transport units"""
    try:
        data = request.json or {}
        units = data.get("units", [])
        
        if not units:
            return jsonify({"error": "No units provided"}), 400
        
        results = []
        for unit_data in units:
            # Validate required fields
            if not all(k in unit_data for k in ["unitType", "transportUnit", "color", "plateNumber"]):
                results.append({
                    "success": False,
                    "error": "Missing required fields",
                    "data": unit_data
                })
                continue
            
            # Generate unique ID
            unit_id = generate_unit_id()
            
            # Create unit
            unit = {
                "unitType": unit_data["unitType"].strip(),
                "transportUnit": unit_data["transportUnit"].strip(),
                "color": unit_data["color"].strip(),
                "plateNumber": unit_data["plateNumber"].strip().upper(),
                "createdAt": {".sv": "timestamp"}
            }
            
            # Save to Firebase
            db.reference(f"transportUnits/{unit_id}").set(unit)
            
            results.append({
                "success": True,
                "id": unit_id,
                "name": unit["transportUnit"]
            })
        
        # Clear cache
        transport_cache.clear("all_units")
        
        return jsonify({
            "message": f"Successfully imported {sum(1 for r in results if r['success'])} of {len(units)} units",
            "results": results
        }), 201
        
    except Exception as e:
        logging.error(f"Error bulk importing units: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# ADMIN: Clear transport cache
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/clear-cache", methods=["POST"])
@admin_required
def clear_transport_cache():
    """Manually clear the transport units cache"""
    transport_cache.clear()
    return jsonify({"message": "Transport units cache cleared successfully"})