from flask import Blueprint, request, jsonify
from firebase_admin import auth, db
from decorators import admin_required
from datetime import datetime, timedelta
import logging
from functools import wraps
import time

admin_users_api = Blueprint("admin_users_api", __name__)

# =======================
# CACHING SYSTEM
# =======================
class UserManagementCache:
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.default_ttl = 30  # 30 seconds default cache
    
    def get(self, key):
        """Get cached data if not expired"""
        if key in self.cache and key in self.cache_time:
            age = (datetime.now() - self.cache_time[key]).total_seconds()
            ttl = self.cache.get(f"{key}_ttl", self.default_ttl)
            if age < ttl:
                return self.cache[key]
        return None
    
    def set(self, key, value, ttl=30):
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
user_cache = UserManagementCache()

# =======================
# OPTIMIZED GET TRANSPORT UNITS (Cached)
# =======================
@admin_users_api.route("/api/admin/transport-units", methods=["GET"])
@admin_required
def get_transport_units():
    """Get all transport units with caching"""
    try:
        # Check cache first
        cached_data = user_cache.get("transport_units")
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch only needed fields from transportUnits
        units_ref = db.reference("transportUnits")
        units_snapshot = units_ref.get() or {}
        
        # Transform data efficiently
        units_list = []
        for key, info in units_snapshot.items():
            if info:  # Only add if data exists
                units_list.append({
                    "id": key,
                    "name": info.get("transportUnit", ""),
                    "plateNo": info.get("plateNumber", ""),
                    "color": info.get("color", ""),
                    "unitType": info.get("unitType", "")
                })
        
        # Sort by name for consistent display
        units_list.sort(key=lambda x: x.get("name", "").lower())
        
        response = {"units": units_list}
        
        # Cache for 1 hour (transport units rarely change)
        user_cache.set("transport_units", response, ttl=3600)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching transport units: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED GET USERS (FILTERED FOR DRIVERS)
# =======================
@admin_users_api.route("/api/admin/users", methods=["GET"])
@admin_required
def get_users():
    """Get all users with role='driver' and valid driverType"""
    try:
        # Check cache (short TTL for user data)
        cache_key = "all_users"
        cached_data = user_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch users from Firebase DB only once
        users_ref = db.reference("users")
        users_snapshot = users_ref.get() or {}
        
        # Filter: ONLY role = "driver" AND driverType is valid
        valid_users = []
        user_ids = []
        
        for uid, info in users_snapshot.items():
            # Skip if no info
            if not info:
                continue
            
            # Check role is "driver"
            role = info.get("role", "").lower()
            if role != "driver":
                continue
            
            # Check driverType is valid
            driver_type = info.get("driverType", "").lower()
            valid_driver_types = ["main", "direct", "indirect"]
            if driver_type not in valid_driver_types:
                continue
            
            # Skip incomplete users
            if not info.get("firstName") and not info.get("lastName"):
                continue
            
            user_ids.append(uid)
            valid_users.append({
                "uid": uid,
                "info": info
            })
        
        # Batch fetch Auth status only for valid users
        disabled_map = {}
        if user_ids:
            # Process in batches of 100
            for i in range(0, len(user_ids), 100):
                batch = user_ids[i:i+100]
                try:
                    auth_users = auth.get_users([auth.UidIdentifier(uid) for uid in batch])
                    for user_record in auth_users.users:
                        disabled_map[user_record.uid] = user_record.disabled
                except Exception as e:
                    logging.warning(f"Error fetching auth users batch: {e}")
                    # If auth fetch fails, mark all as not disabled
                    for uid in batch:
                        disabled_map[uid] = False
        
        # Build user objects
        users_list = []
        driver_type_map = {
            "main": "Main Driver",
            "indirect": "Outsource Indirect",
            "direct": "Outsource Direct"
        }
        
        for item in valid_users:
            uid = item["uid"]
            info = item["info"]
            
            driver_type = info.get("driverType", "")
            driver_type_display = driver_type_map.get(driver_type, "")
            
            user_obj = {
                "uid": uid,
                "firstName": info.get("firstName", ""),
                "middleName": info.get("middleName", ""),
                "lastName": info.get("lastName", ""),
                "email": info.get("email", ""),
                "phone": info.get("phone", ""),
                "role": info.get("role", "driver"),
                "driverType": driver_type,
                "driverTypeDisplay": driver_type_display,
                "defaultTransportUnit": info.get("defaultTransportUnit", ""),
                "active": info.get("active", False),
                "disabled": disabled_map.get(uid, False)
            }
            users_list.append(user_obj)
        
        # Sort alphabetically by full name
        users_list.sort(key=lambda x: f"{x.get('firstName', '')} {x.get('lastName', '')}".lower())
        
        response = {"users": users_list}
        
        # Cache for 10 seconds (users can change, but not super frequently)
        user_cache.set(cache_key, response, ttl=10)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching users: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED CREATE USER (Driver only)
# =======================
@admin_users_api.route("/api/admin/users", methods=["POST"])
@admin_required
def create_user():
    from app import csrf
    csrf.exempt(create_user)

    data = request.get_json(force=True) or {}
    
    # Validate required fields
    required_fields = ["email", "phone", "firstName", "lastName", "driverType"]
    missing_fields = [f for f in required_fields if not data.get(f)]
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400
    
    # Validate driverType
    driver_type = data.get("driverType")
    valid_driver_types = ["main", "direct", "indirect"]
    if driver_type not in valid_driver_types:
        return jsonify({"error": "Invalid driverType. Must be 'main', 'direct', or 'indirect'"}), 400
    
    try:
        # Create Firebase Auth user with fixed password
        temp_password = "qwerty123"
        user = auth.create_user(
            email=data["email"],
            password=temp_password,
            email_verified=True  # Auto-verified for development
        )
        uid = user.uid
        
        # Save user data to Firebase DB with role = "driver"
        user_data = {
            "email": data["email"],
            "phone": str(data["phone"]),
            "firstName": data["firstName"],
            "middleName": data.get("middleName", ""),
            "lastName": data["lastName"],
            "role": "driver",  # Always set role to "driver"
            "driverType": driver_type,
            "defaultTransportUnit": data.get("defaultTransportUnit", ""),
            "active": True,
            "createdAt": {".sv": "timestamp"}
        }
        db.reference(f"users/{uid}").set(user_data)
        
        # Clear user cache
        user_cache.clear("all_users")
        
        return jsonify({
            "message": "Driver created successfully", 
            "uid": uid,
            "temp_password": temp_password
        }), 201
        
    except auth.EmailAlreadyExistsError:
        return jsonify({"error": "Email already exists"}), 409
    except Exception as e:
        logging.error(f"Error creating user: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED EDIT USER
# =======================
@admin_users_api.route("/api/admin/users/<uid>", methods=["PATCH"])
@admin_required
def edit_user(uid):
    data = request.get_json() or {}
    
    # Allowed fields for update
    allowed_fields = ["phone", "firstName", "middleName", "lastName", "role", "active", "driverType", "defaultTransportUnit"]
    updates = {k: data[k] for k in allowed_fields if k in data}
    
    # Validate driverType if present
    if "driverType" in updates:
        valid_driver_types = ["main", "direct", "indirect"]
        if updates["driverType"] not in valid_driver_types:
            return jsonify({"error": "Invalid driverType. Must be 'main', 'direct', or 'indirect'"}), 400
    
    # Prevent changing role to non-driver for this page
    if "role" in updates and updates["role"].lower() != "driver":
        return jsonify({"error": "Role must remain 'driver' for driver management"}), 400
    
    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400
    
    try:
        # Handle transport unit reassignment
        new_unit = updates.get("defaultTransportUnit")
        if new_unit:
            # Find any user who currently has this transport unit
            users_ref = db.reference("users")
            users_snapshot = users_ref.get() or {}
            
            for other_uid, info in users_snapshot.items():
                if info and other_uid != uid and info.get("defaultTransportUnit") == new_unit:
                    # Remove the transport unit from the old user
                    users_ref.child(other_uid).update({"defaultTransportUnit": ""})
        
        # Update current user
        db.reference(f"users/{uid}").update(updates)
        
        # If active changed, also update Firebase Auth
        if "active" in updates:
            auth.update_user(uid, disabled=not updates["active"])
        
        # Clear cache
        user_cache.clear("all_users")
        
        return jsonify({"message": "Driver updated successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error editing user: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED DELETE USER
# =======================
@admin_users_api.route("/api/admin/users/<uid>", methods=["DELETE"])
@admin_required
def delete_user(uid):
    try:
        # Delete from Auth
        auth.delete_user(uid)
        
        # Delete from DB
        db.reference(f"users/{uid}").delete()
        
        # Clear cache
        user_cache.clear("all_users")
        
        return jsonify({"message": "Driver deleted successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error deleting user: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED TOGGLE USER STATUS
# =======================
@admin_users_api.route("/api/admin/users/<uid>/status", methods=["PATCH"])
@admin_required
def toggle_user_status(uid):
    data = request.get_json() or {}
    if "active" not in data:
        return jsonify({"error": "Missing 'active' field"}), 400
    
    enable = bool(data["active"])
    
    try:
        auth.update_user(uid, disabled=not enable)
        
        # Update in DB
        db.reference(f"users/{uid}/active").set(enable)
        
        # Clear cache
        user_cache.clear("all_users")
        
        return jsonify({"message": f"Driver account {'enabled' if enable else 'disabled'} successfully"}), 200
        
    except Exception as e:
        logging.error(f"Error toggling user status: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED EDIT PASSWORD
# =======================
@admin_users_api.route("/api/admin/users/<uid>/password", methods=["PATCH"])
@admin_required
def edit_password(uid):
    from app import csrf
    csrf.exempt(edit_password)
    
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
# OPTIMIZED GET SINGLE USER
# =======================
@admin_users_api.route("/api/admin/users/<uid>", methods=["GET"])
@admin_required
def get_single_user(uid):
    """Get a single user by UID"""
    try:
        cache_key = f"user_{uid}"
        cached_data = user_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        # Fetch user from DB
        user_ref = db.reference(f"users/{uid}")
        user_data = user_ref.get()
        
        if not user_data:
            return jsonify({"error": "User not found"}), 404
        
        # Verify it's a driver
        if user_data.get("role", "").lower() != "driver":
            return jsonify({"error": "User is not a driver"}), 403
        
        # Get auth status
        try:
            auth_user = auth.get_user(uid)
            disabled = auth_user.disabled
        except:
            disabled = False
        
        # Format driver type
        driver_type = user_data.get("driverType", "")
        driver_type_map = {
            "main": "Main Driver",
            "indirect": "Outsource Indirect", 
            "direct": "Outsource Direct"
        }
        
        response = {
            "user": {
                "uid": uid,
                "firstName": user_data.get("firstName", ""),
                "middleName": user_data.get("middleName", ""),
                "lastName": user_data.get("lastName", ""),
                "email": user_data.get("email", ""),
                "phone": user_data.get("phone", ""),
                "role": user_data.get("role", "driver"),
                "driverType": driver_type,
                "driverTypeDisplay": driver_type_map.get(driver_type, ""),
                "defaultTransportUnit": user_data.get("defaultTransportUnit", ""),
                "active": user_data.get("active", False),
                "disabled": disabled
            }
        }
        
        # Cache for 10 seconds
        user_cache.set(cache_key, response, ttl=10)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching user {uid}: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# CLEAR CACHE ENDPOINT
# =======================
@admin_users_api.route("/api/admin/users/clear-cache", methods=["POST"])
@admin_required
def clear_user_cache():
    """Manually clear the user management cache"""
    user_cache.clear()
    return jsonify({"message": "User cache cleared successfully"}), 200