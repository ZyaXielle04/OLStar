# backend/routes/admin_requests.py
from flask import Blueprint, jsonify
from firebase_admin import db
from decorators import admin_required

admin_requests_api = Blueprint("admin_requests_api", __name__)

@admin_requests_api.route("/api/admin/requests", methods=["GET"])
@admin_required
def get_all_requests():
    """
    Fetch all requests from RTDB for admin panel
    """
    try:
        requests_ref = db.reference("requests")
        users_ref = db.reference("users")

        requests_data = requests_ref.get() or {}
        users_data = users_ref.get() or {}

        requests_list = []

        for key, req in requests_data.items():
            req_obj = req.copy()
            req_obj["id"] = key

            # Replace requestedBy UID with full name if possible
            uid = req.get("requestedBy")
            if uid and uid in users_data:
                user = users_data[uid]
                first = user.get("firstName", "")
                last = user.get("lastName", "")
                req_obj["requestedByName"] = f"{first} {last}".strip()
            else:
                req_obj["requestedByName"] = uid or "Unknown"

            requests_list.append(req_obj)

        return jsonify({"requests": requests_list}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
