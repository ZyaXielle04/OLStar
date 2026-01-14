from flask import Blueprint, request, jsonify
from flask_wtf.csrf import CSRFError

schedules_api = Blueprint("schedules_api", __name__)

# ---------------- CREATE ----------------
@schedules_api.route("/api/schedules", methods=["POST"])
def create_schedule():
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    token = request.headers.get("X-CSRFToken") or request.headers.get("X-XSRF-TOKEN")
    if not token:
        return jsonify({"error": "Missing CSRF token"}), 400

    if isinstance(data, dict):
        data = [data]

    saved_ids = []
    try:
        for item in data:
            transaction_id = item.get("transactionID")
            if not transaction_id:
                return jsonify({"error": "transactionID is required"}), 400

            ref = db.reference(f"schedules/{transaction_id}")
            ref.set(item)  # Create new schedule
            saved_ids.append(transaction_id)

        return jsonify({"success": True, "transactionIDs": saved_ids}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- READ ----------------
@schedules_api.route("/api/schedules", methods=["GET"])
def get_schedules():
    from firebase_admin import db
    try:
        ref = db.reference("schedules")
        data = ref.get() or {}
        schedules = list(data.values())
        return jsonify({"success": True, "schedules": schedules}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- UPDATE ----------------
@schedules_api.route("/api/schedules/<transaction_id>", methods=["PUT"])
def update_schedule(transaction_id):
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    token = request.headers.get("X-CSRFToken") or request.headers.get("X-XSRF-TOKEN")
    if not token:
        return jsonify({"error": "Missing CSRF token"}), 400

    try:
        ref = db.reference(f"schedules/{transaction_id}")
        if not ref.get():
            return jsonify({"error": "Schedule not found"}), 404

        ref.update(data)  # Update only the provided fields
        return jsonify({"success": True, "transactionID": transaction_id}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- DELETE ----------------
@schedules_api.route("/api/schedules/<transaction_id>", methods=["DELETE"])
def delete_schedule(transaction_id):
    from firebase_admin import db

    try:
        ref = db.reference(f"schedules/{transaction_id}")
        if not ref.get():
            return jsonify({"error": "Schedule not found"}), 404

        ref.delete()
        return jsonify({"success": True, "transactionID": transaction_id}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
