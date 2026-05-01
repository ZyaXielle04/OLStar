from flask import Blueprint, request, jsonify
from firebase_admin import auth, db
from decorators import admin_required
from datetime import datetime
import logging
import secrets
import string

admin_bk_drivers_api = Blueprint("admin_bk_drivers_api", __name__)

# Cache system (simple in-memory)
class BKDriverCache:
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.default_ttl = 30
    
    def get(self, key):
        if key in self.cache and key in self.cache_time:
            age = (datetime.now() - self.cache_time[key]).total_seconds()
            ttl = self.cache.get(f"{key}_ttl", self.default_ttl)
            if age < ttl:
                return self.cache[key]
        return None
    
    def set(self, key, value, ttl=30):
        self.cache[key] = value
        self.cache_time[key] = datetime.now()
        self.cache[f"{key}_ttl"] = ttl
    
    def clear(self, pattern=None):
        if pattern:
            keys_to_delete = [k for k in self.cache.keys() if pattern in k]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.cache_time.pop(key, None)
        else:
            self.cache.clear()
            self.cache_time.clear()

cache = BKDriverCache()

def generate_temp_password(length=12):
    """Generate a secure temporary password"""
    # Fixed password for development/testing
    return "qwerty123"

# =======================
# GET ALL BK DRIVERS
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers", methods=["GET"])
@admin_required
def get_bk_drivers():
    """Get all users with driverType='bkdriver' AND role='driver'"""
    try:
        # Check cache
        cached_data = cache.get("bk_drivers_list")
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch from Firebase
        users_ref = db.reference("users")
        all_users = users_ref.get() or {}
        
        drivers_list = []
        for uid, info in all_users.items():
            # Check BOTH conditions: driverType = "bkdriver" AND role = "driver"
            if info and info.get("driverType") == "bkdriver" and info.get("role") == "driver":
                # Get van details
                van_info = info.get("bkVan", {})
                
                driver_obj = {
                    "uid": uid,
                    "firstName": info.get("firstName", ""),
                    "middleName": info.get("middleName", ""),
                    "lastName": info.get("lastName", ""),
                    "email": info.get("email", ""),
                    "phone": info.get("phone", ""),
                    "role": info.get("role", "driver"),
                    "driverType": info.get("driverType", "bkdriver"),
                    "vanModel": van_info.get("vanModel", ""),
                    "plateNumber": van_info.get("plateNumber", ""),
                    "vanColor": van_info.get("vanColor", "")
                }
                drivers_list.append(driver_obj)
        
        # Sort by name
        drivers_list.sort(key=lambda x: f"{x.get('firstName', '')} {x.get('lastName', '')}".lower())
        
        response = {"drivers": drivers_list}
        
        # Cache for 10 seconds
        cache.set("bk_drivers_list", response, ttl=10)
        return jsonify(response), 200
        
    except Exception as e:
        logging.error(f"Error fetching BK drivers: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# CREATE BK DRIVER
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers", methods=["POST"])
@admin_required
def create_bk_driver():
    """Create a new BK Driver with van details"""
    data = request.get_json(force=True) or {}
    
    # Validate required fields
    required_fields = ["email", "phone", "firstName", "lastName", "vanModel", "plateNumber", "vanColor"]
    missing_fields = [f for f in required_fields if not data.get(f)]
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400
    
    try:
        # Use fixed password "qwerty123"
        temp_password = "qwerty123"
        
        # Create Firebase Auth user
        user = auth.create_user(
            email=data["email"],
            password=temp_password,
            email_verified=True  # Auto-verified for development
        )
        uid = user.uid
        
        # Save user data to Firebase DB with BOTH conditions
        user_data = {
            "email": data["email"],
            "phone": str(data["phone"]),
            "firstName": data["firstName"],
            "middleName": data.get("middleName", ""),
            "lastName": data["lastName"],
            "role": "driver",  # ← Set role to "driver"
            "driverType": "bkdriver",  # ← Set driverType to "bkdriver"
            "bkVan": {
                "vanModel": data["vanModel"],
                "plateNumber": data["plateNumber"],
                "vanColor": data["vanColor"]
            },
            "active": True,
            "createdAt": {".sv": "timestamp"}
        }
        db.reference(f"users/{uid}").set(user_data)
        
        # Clear cache
        cache.clear("bk_drivers_list")
        
        return jsonify({
            "message": "BK Driver created successfully", 
            "uid": uid,
            "temp_password": temp_password  # Returns "qwerty123"
        }), 201
        
    except auth.EmailAlreadyExistsError:
        return jsonify({"error": "Email already exists"}), 409
    except Exception as e:
        logging.error(f"Error creating BK driver: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# UPDATE BK DRIVER
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers/<uid>", methods=["PATCH"])
@admin_required
def update_bk_driver(uid):
    """Update BK Driver information (personal + van details)"""
    data = request.get_json() or {}
    
    try:
        # Get existing user data
        user_ref = db.reference(f"users/{uid}")
        existing_data = user_ref.get()
        
        if not existing_data:
            return jsonify({"error": "Driver not found"}), 404
        
        # Update personal fields
        personal_updates = {}
        for field in ["firstName", "middleName", "lastName", "phone"]:
            if field in data:
                personal_updates[field] = data[field]
        
        # Update van details if provided
        van_updates = {}
        van_fields = ["vanModel", "plateNumber", "vanColor"]
        for field in van_fields:
            if field in data:
                van_updates[field] = data[field]
        
        # Apply updates
        if personal_updates:
            user_ref.update(personal_updates)
        
        if van_updates:
            # Update nested bkVan object
            current_van = existing_data.get("bkVan", {})
            current_van.update(van_updates)
            user_ref.update({"bkVan": current_van})
        
        # Clear cache
        cache.clear("bk_drivers_list")
        
        return jsonify({"message": "BK Driver updated successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error updating BK driver: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# DELETE BK DRIVER
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers/<uid>", methods=["DELETE"])
@admin_required
def delete_bk_driver(uid):
    """Delete a BK Driver completely"""
    try:
        # Delete from Firebase Auth
        auth.delete_user(uid)
        
        # Delete from Realtime Database
        db.reference(f"users/{uid}").delete()
        
        # Clear cache
        cache.clear("bk_drivers_list")
        
        return jsonify({"message": "BK Driver deleted successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error deleting BK driver: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# UPDATE PASSWORD
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers/<uid>/password", methods=["PATCH"])
@admin_required
def update_bk_driver_password(uid):
    """Update BK Driver's password"""
    data = request.get_json(force=True) or {}
    new_password = data.get("password")
    
    if not new_password:
        return jsonify({"error": "Password is required"}), 400
    
    try:
        auth.update_user(uid, password=new_password)
        return jsonify({"message": "Password updated successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error updating password: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# CLEAR CACHE (Optional)
# =======================
@admin_bk_drivers_api.route("/api/admin/bk-drivers/clear-cache", methods=["POST"])
@admin_required
def clear_bk_driver_cache():
    """Manually clear cache"""
    cache.clear()
    return jsonify({"message": "Cache cleared successfully"}), 200