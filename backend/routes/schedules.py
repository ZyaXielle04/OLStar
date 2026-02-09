from flask import Blueprint, request, jsonify
from message_template import build_message
from decorators import admin_required

schedules_api = Blueprint("schedules_api", __name__)


def normalize_phone(number: str) -> str:
    """
    Convert "63-9171234567" → "+639171234567"
    """
    if not number:
        return ""

    number = number.strip()

    if "-" in number:
        country, rest = number.split("-", 1)
        return f"+{country}{rest}"

    if number.startswith("+"):
        return number

    return f"+{number}"


# ---------------- CREATE ----------------
@admin_required
@schedules_api.route("/api/schedules", methods=["POST"])
def create_schedule():
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    if isinstance(data, dict):
        data = [data]

    saved_ids = []
    message_results = []

    try:
        for item in data:
            transaction_id = item.get("transactionID")
            if not transaction_id:
                return jsonify({"error": "transactionID is required"}), 400

            # ---------------- Save to Firebase ----------------
            ref = db.reference(f"schedules/{transaction_id}")
            ref.set(item)
            saved_ids.append(transaction_id)

        return jsonify({
            "success": True,
            "transactionIDs": saved_ids,
            "messages": message_results
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- READ ----------------
@admin_required
@schedules_api.route("/api/schedules", methods=["GET"])
def get_schedules():
    from firebase_admin import db
    try:
        ref = db.reference("schedules")
        data = ref.get() or {}

        schedules = []
        for transaction_id, schedule in data.items():
            schedule["transactionID"] = transaction_id
            current = schedule.get("current") or {}
            schedule["current"] = {
                "driverName": current.get("driverName", ""),
                "cellPhone": current.get("cellPhone", "")
            }
            schedules.append(schedule)

        return jsonify({"success": True, "schedules": schedules}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- UPDATE ----------------
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>", methods=["PATCH"])
def update_schedule(transaction_id):
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    ref = db.reference(f"schedules/{transaction_id}")
    existing = ref.get()
    if not existing:
        return jsonify({"error": "Schedule not found"}), 404

    if "current" in data:
        ref.child("current").set(data["current"])
        data.pop("current")

    ref.update(data)
    return jsonify({"success": True, "transactionID": transaction_id}), 200


# ---------------- DELETE ----------------
@admin_required
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

# ---------------- TRANSPORT UNITS ----------------
@admin_required
@schedules_api.route("/api/transportUnits", methods=["GET"])
def get_transport_units():
    """
    Fetch all transport units from Firebase Realtime Database
    """
    from firebase_admin import db

    try:
        ref = db.reference("transportUnits")
        data = ref.get() or {}

        # Convert to list
        transport_units = []
        for key, unit in data.items():
            transport_units.append({
                "transportUnit": unit.get("transportUnit", ""),
                "unitType": unit.get("unitType", ""),
                "color": unit.get("color", ""),
                "plateNumber": unit.get("plateNumber", "")
            })

        return jsonify({"success": True, "transportUnits": transport_units}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
