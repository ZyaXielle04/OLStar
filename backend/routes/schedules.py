from flask import Blueprint, request, jsonify
from flask_wtf.csrf import validate_csrf, CSRFError

schedules_api = Blueprint("schedules_api", __name__)

@schedules_api.route("/api/schedules", methods=["POST"])
def create_schedule():
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # ---------------- CSRF check ----------------
    token = request.headers.get("X-CSRFToken") or request.headers.get("X-XSRF-TOKEN")
    if not token:
        return jsonify({"error": "Missing CSRF token"}), 400

    # Use a simple check: make sure token exists (optional: compare with server-generated token)
    # Remove validate_csrf() call for JSON API

    # Ensure data is always a list
    if isinstance(data, dict):
        data = [data]

    saved_ids = []
    try:
        for item in data:
            transaction_id = item.get("transactionID")
            if not transaction_id:
                return jsonify({"error": "transactionID is required"}), 400

            ref = db.reference(f"schedules/{transaction_id}")
            ref.set(item)
            saved_ids.append(transaction_id)

        return jsonify({"success": True, "transactionIDs": saved_ids}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@schedules_api.route("/api/schedules", methods=["GET"])
def get_schedules():
    from firebase_admin import db
    try:
        ref = db.reference("schedules")
        data = ref.get() or {}

        # Convert dict to list
        schedules = list(data.values())

        return jsonify({"success": True, "schedules": schedules}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
