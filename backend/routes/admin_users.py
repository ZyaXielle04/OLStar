from flask import Blueprint, request, jsonify
from firebase_admin import auth, db
from decorators import admin_required

admin_users_api = Blueprint("admin_users_api", __name__)

# -----------------------
# CREATE USER
# -----------------------
@admin_users_api.route("/api/admin/users", methods=["POST"])
@admin_required
def create_user():
    from app import csrf
    csrf.exempt(create_user)

    data = request.get_json(force=True) or {}
    print("Received payload:", data)  # Debug log

    # Required fields
    required_fields = ["email", "phone", "firstName", "lastName"]
    missing_fields = [f for f in required_fields if not data.get(f)]
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400

    middle_name = data.get("middleName", "")

    try:
        # Create Firebase Auth user
        user = auth.create_user(
            email=data["email"],
            password="TempPass@123",
            email_verified=True
        )
        uid = user.uid

        # Save additional user info to Firebase DB
        user_data = {
            "email": data["email"],
            "phone": str(data["phone"]),
            "firstName": data["firstName"],
            "middleName": middle_name,
            "lastName": data["lastName"],
            "role": data.get("role", "driver"),
            "defaultTransportUnit": data.get("defaultTransportUnit", ""),
            "active": False,
            "createdAt": {".sv": "timestamp"}
        }
        db.reference(f"users/{uid}").set(user_data)

        return jsonify({"message": "User created successfully", "uid": uid}), 201

    except auth.EmailAlreadyExistsError:
        return jsonify({"error": "Email already exists"}), 409
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET USERS (optionally filter by role)
# -----------------------
@admin_users_api.route("/api/admin/users", methods=["GET"])
@admin_required
def get_users():
    try:
        users_ref = db.reference("users")
        users_snapshot = users_ref.get() or {}
        role_filter = request.args.get("role")

        uids = list(users_snapshot.keys())
        users_list = []

        # Batch fetch Auth users in chunks of 100
        batches = [uids[i:i + 100] for i in range(0, len(uids), 100)]
        disabled_map = {}
        for batch in batches:
            auth_users = auth.get_users([auth.UidIdentifier(uid) for uid in batch])
            for user_record in auth_users.users:
                disabled_map[user_record.uid] = user_record.disabled

        # Build user objects
        for uid, info in users_snapshot.items():
            if role_filter and info.get("role") != role_filter:
                continue

            user_obj = {
                "uid": uid,
                "firstName": info.get("firstName", ""),
                "middleName": info.get("middleName", ""),
                "lastName": info.get("lastName", ""),
                "email": info.get("email", ""),
                "phone": info.get("phone", ""),
                "role": info.get("role", "user"),
                "defaultTransportUnit": info.get("defaultTransportUnit", ""),
                "active": info.get("active", False),
                "disabled": disabled_map.get(uid, False)
            }
            users_list.append(user_obj)

        return jsonify({"users": users_list}), 200

    except Exception as e:
        print("Error fetching users:", e)
        return jsonify({"error": str(e)}), 500

# -----------------------
# EDIT USER PROFILE WITH TRANSPORT UNIT REASSIGNMENT
# -----------------------
@admin_users_api.route("/api/admin/users/<uid>", methods=["PATCH"])
@admin_required
def edit_user(uid):
    data = request.get_json() or {}
    allowed_fields = ["phone", "firstName", "middleName", "lastName", "role", "active", "defaultTransportUnit"]
    updates = {k: data[k] for k in allowed_fields if k in data}

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    try:
        # ---------------- Handle transport unit reassignment ----------------
        new_unit = updates.get("defaultTransportUnit")
        if new_unit:
            # Find any user who currently has this transport unit
            users_ref = db.reference("users")
            users_snapshot = users_ref.get() or {}
            for other_uid, info in users_snapshot.items():
                if other_uid != uid and info.get("defaultTransportUnit") == new_unit:
                    # Remove the transport unit from the old user
                    users_ref.child(other_uid).update({"defaultTransportUnit": ""})

        # Update current user
        db.reference(f"users/{uid}").update(updates)

        # If active changed, also update Firebase Auth
        if "active" in updates:
            auth.update_user(uid, disabled=not updates["active"])

        return jsonify({"message": "User updated successfully"}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------
# DELETE USER
# -----------------------
@admin_users_api.route("/api/admin/users/<uid>", methods=["DELETE"])
@admin_required
def delete_user(uid):
    try:
        auth.delete_user(uid)
        db.reference(f"users/{uid}").delete()
        return jsonify({"message": "User deleted successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------
# ENABLE / DISABLE USER (Firebase Auth only)
# -----------------------
@admin_users_api.route("/api/admin/users/<uid>/status", methods=["PATCH"])
@admin_required
def toggle_user_status(uid):
    data = request.get_json() or {}
    if "active" not in data:
        return jsonify({"error": "Missing 'active' field"}), 400

    enable = bool(data["active"])  # True = enable account, False = disable

    try:
        auth.update_user(uid, disabled=not enable)
        return jsonify({"message": f"User account {'enabled' if enable else 'disabled'} successfully"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------
# EDIT PASSWORD
# -----------------------
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
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET ALL TRANSPORT UNITS
# -----------------------
@admin_users_api.route("/api/admin/transport-units", methods=["GET"])
@admin_required
def get_transport_units():
    try:
        # Fetch all transport units from Firebase
        units_ref = db.reference("transportUnits")
        units_snapshot = units_ref.get() or {}

        # Transform data into an array for frontend
        units_list = []
        for key, info in units_snapshot.items():
            units_list.append({
                "id": key,
                "name": info.get("transportUnit", ""),
                "plateNo": info.get("plateNumber", ""),
                "color": info.get("color", ""),
                "unitType": info.get("unitType", "")
            })

        return jsonify({"units": units_list}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
