from flask import Blueprint, request, jsonify
from twilio_client import send_sms, send_whatsapp
from message_template import build_message

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

            # ---------------- Build Message ----------------
            message_body = build_message(item)

            # ---------------- Send SMS ----------------
            contact_number = normalize_phone(item.get("contactNumber", ""))
            msg_result = {"transactionID": transaction_id}

            if contact_number:
                try:
                    send_sms(contact_number, message_body)
                    msg_result["sms"] = "sent"
                except Exception as e:
                    msg_result["sms"] = f"failed: {str(e)}"

                # ---------------- Send WhatsApp ----------------
                try:
                    send_whatsapp(contact_number, message_body)
                    msg_result["whatsapp"] = "sent"
                except Exception as e:
                    msg_result["whatsapp"] = f"failed: {str(e)}"

            message_results.append(msg_result)

        return jsonify({
            "success": True,
            "transactionIDs": saved_ids,
            "messages": message_results
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- READ ----------------
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
@schedules_api.route("/api/schedules/<transaction_id>", methods=["PUT"])
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
