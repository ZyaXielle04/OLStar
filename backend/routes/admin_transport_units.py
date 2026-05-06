from flask import Blueprint, jsonify, request
from firebase_admin import db
from decorators import admin_required
import random
import string
import logging
from datetime import datetime
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
        """Clear cache - can clear all or by pattern"""
        if pattern:
            keys_to_delete = [k for k in self.cache.keys() if pattern in k]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.cache_time.pop(key, None)
                self.cache.pop(f"{key}_ttl", None)
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
        now = datetime.now().timestamp()
        if user_id not in self.requests:
            self.requests[user_id] = []
        
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
    ref = db.reference("transportUnits")
    max_attempts = 10
    
    for _ in range(max_attempts):
        numbers = f"{random.randint(0, 999):03d}"
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        unit_id = f"{numbers}{letters}"
        
        if not ref.child(unit_id).get(shallow=True):
            return unit_id
    
    return f"{int(datetime.now().timestamp())}{random.randint(100, 999)}"

# -------------------------------
# GET all transport units (WITH CACHING)
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
            if unit_data:
                units_list.append({
                    "id": unit_id,
                    "unitCategory": unit_data.get("unitCategory", ""),
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
# CREATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units", methods=["POST"])
@admin_required
@rate_limit
def create_transport_unit():
    try:
        data = request.json or {}
        
        required_fields = ["unitCategory", "unitType", "transportUnit", "color", "plateNumber"]
        missing_fields = [f for f in required_fields if not data.get(f)]
        if missing_fields:
            return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400
        
        unit_category = data.get("unitCategory")
        valid_categories = ["company-owned", "outsource", "project-based"]
        if unit_category not in valid_categories:
            return jsonify({"error": "Invalid unit category. Must be 'company-owned', 'outsource', or 'project-based'"}), 400
        
        unit_id = generate_unit_id()
        
        unit = {
            "unitCategory": unit_category,
            "unitType": data.get("unitType").strip(),
            "transportUnit": data.get("transportUnit").strip(),
            "color": data.get("color").strip(),
            "plateNumber": data.get("plateNumber").strip().upper(),
            "createdAt": {".sv": "timestamp"},
            "updatedAt": {".sv": "timestamp"}
        }
        
        db.reference(f"transportUnits/{unit_id}").set(unit)
        
        # Clear cache after create
        transport_cache.clear("all_units")
        
        logging.info(f"Transport unit {unit_id} created with category: {unit_category}")
        
        return jsonify({
            "message": "Transport unit created successfully",
            "unit_id": unit_id,
            "unit": {
                "id": unit_id,
                "unitCategory": unit["unitCategory"],
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
# UPDATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["PUT"])
@admin_required
@rate_limit
def update_transport_unit(unit_id):
    try:
        data = request.json or {}
        
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        existing = unit_ref.get(shallow=True)
        if not existing:
            return jsonify({"error": "Transport unit not found"}), 404
        
        updates = {}
        
        if "unitCategory" in data and data["unitCategory"]:
            unit_category = data["unitCategory"].strip()
            valid_categories = ["company-owned", "outsource", "project-based"]
            if unit_category not in valid_categories:
                return jsonify({"error": "Invalid unit category. Must be 'company-owned', 'outsource', or 'project-based'"}), 400
            updates["unitCategory"] = unit_category
            
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
        
        updates["updatedAt"] = {".sv": "timestamp"}
        unit_ref.update(updates)
        
        # Clear cache after update
        transport_cache.clear("all_units")
        transport_cache.clear(f"unit_{unit_id}")
        
        logging.info(f"Transport unit {unit_id} updated successfully")
        
        return jsonify({
            "message": "Transport unit updated successfully",
            "success": True
        }), 200
        
    except Exception as e:
        logging.error(f"Error updating transport unit {unit_id}: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# DELETE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["DELETE"])
@admin_required
@rate_limit
def delete_transport_unit(unit_id):
    try:
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        existing = unit_ref.get()
        if not existing:
            return jsonify({"error": "Transport unit not found"}), 404
        
        users_ref = db.reference("users")
        users_snapshot = users_ref.get()
        
        is_assigned = False
        if users_snapshot:
            for user_id, user_data in users_snapshot.items():
                if (user_data.get("defaultTransportUnit") == unit_id or 
                    user_data.get("transportUnit") == unit_id or
                    user_data.get("assignedUnit") == unit_id):
                    is_assigned = True
                    break
        
        if is_assigned:
            return jsonify({
                "error": "Cannot delete transport unit that is assigned to one or more users. Please reassign users first."
            }), 400
        
        unit_ref.delete()
        
        # Clear cache after delete
        transport_cache.clear("all_units")
        transport_cache.clear(f"unit_{unit_id}")
        
        logging.info(f"Transport unit {unit_id} deleted")
        
        return jsonify({
            "message": "Transport unit deleted successfully",
            "success": True
        }), 200
        
    except Exception as e:
        logging.error(f"Error deleting transport unit {unit_id}: {e}")
        import traceback
        logging.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

# -------------------------------
# GET single transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["GET"])
@admin_required
@rate_limit
def get_transport_unit(unit_id):
    try:
        cache_key = f"unit_{unit_id}"
        cached_data = transport_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        unit_ref = db.reference(f"transportUnits/{unit_id}")
        unit_data = unit_ref.get()
        
        if not unit_data:
            return jsonify({"error": "Transport unit not found"}), 404
        
        response = {
            "id": unit_id,
            "unitCategory": unit_data.get("unitCategory", ""),
            "unitType": unit_data.get("unitType", ""),
            "name": unit_data.get("transportUnit", ""),
            "color": unit_data.get("color", ""),
            "plateNo": unit_data.get("plateNumber", "")
        }
        
        transport_cache.set(cache_key, response, ttl=3600)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching transport unit {unit_id}: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# Bulk import transport units
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/bulk", methods=["POST"])
@admin_required
@rate_limit
def bulk_import_units():
    try:
        data = request.json or {}
        units = data.get("units", [])
        
        if not units:
            return jsonify({"error": "No units provided"}), 400
        
        results = []
        for unit_data in units:
            if not all(k in unit_data for k in ["unitCategory", "unitType", "transportUnit", "color", "plateNumber"]):
                results.append({
                    "success": False,
                    "error": "Missing required fields. Need: unitCategory, unitType, transportUnit, color, plateNumber",
                    "data": unit_data
                })
                continue
            
            unit_category = unit_data.get("unitCategory")
            valid_categories = ["company-owned", "outsource", "project-based"]
            if unit_category not in valid_categories:
                results.append({
                    "success": False,
                    "error": f"Invalid unit category: {unit_category}. Must be 'company-owned', 'outsource', or 'project-based'",
                    "data": unit_data
                })
                continue
            
            unit_id = generate_unit_id()
            
            unit = {
                "unitCategory": unit_category,
                "unitType": unit_data["unitType"].strip(),
                "transportUnit": unit_data["transportUnit"].strip(),
                "color": unit_data["color"].strip(),
                "plateNumber": unit_data["plateNumber"].strip().upper(),
                "createdAt": {".sv": "timestamp"},
                "updatedAt": {".sv": "timestamp"}
            }
            
            db.reference(f"transportUnits/{unit_id}").set(unit)
            
            results.append({
                "success": True,
                "id": unit_id,
                "name": unit["transportUnit"]
            })
        
        # Clear cache after bulk import
        transport_cache.clear("all_units")
        
        success_count = sum(1 for r in results if r['success'])
        logging.info(f"Bulk import completed: {success_count} of {len(units)} units imported")
        
        return jsonify({
            "message": f"Successfully imported {success_count} of {len(units)} units",
            "results": results
        }), 201
        
    except Exception as e:
        logging.error(f"Error bulk importing units: {e}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# Clear cache endpoint (for manual cache clearing)
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/clear-cache", methods=["POST"])
@admin_required
def clear_transport_cache():
    """Manually clear the transport units cache"""
    transport_cache.clear()
    logging.info("Transport units cache manually cleared")
    return jsonify({"message": "Transport units cache cleared successfully"}), 200