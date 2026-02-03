from flask import Blueprint, jsonify, request
from firebase_admin import db
from decorators import admin_required

admin_requests_api = Blueprint("admin_requests_api", __name__)

# ---------------- GET all requests (existing) ----------------
@admin_requests_api.route("/api/admin/requests", methods=["GET"])
@admin_required
def get_all_requests():
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


# ---------------- PATCH request status ----------------
@admin_requests_api.route("/api/admin/requests/<request_id>", methods=["PATCH"])
@admin_required
def update_request(request_id):
    """
    Update a single request's status and/or imageReply
    Expected JSON body:
    {
        "status": "paid" or "denied",
        "imageReply": "https://..." (optional, only for 'paid')
    }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing JSON body"}), 400

        status = data.get("status")
        if status not in ["paid", "denied"]:
            return jsonify({"error": "Invalid status"}), 400

        image_reply = data.get("imageReply", None)

        request_ref = db.reference(f"requests/{request_id}")
        current_data = request_ref.get()
        if not current_data:
            return jsonify({"error": "Request not found"}), 404

        updates = {"status": status}
        if image_reply:
            updates["imageReply"] = image_reply

        request_ref.update(updates)

        return jsonify({"message": "Request updated successfully", "updatedFields": updates}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
