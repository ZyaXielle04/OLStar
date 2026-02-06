from flask import Blueprint, jsonify, request
from firebase_admin import db
from decorators import admin_required
import random
import string

admin_transport_units = Blueprint("admin_transport_units", __name__)

# -------------------------------
# Helper: Generate XXXYYY unit_id
# -------------------------------
def generate_unit_id():
    ref = db.reference("transportUnits")

    while True:
        numbers = f"{random.randint(0, 999):03d}"     # XXX
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))  # YYY
        unit_id = f"{numbers}{letters}"

        # ensure uniqueness
        if not ref.child(unit_id).get():
            return unit_id


# -------------------------------
# GET all transport units
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units", methods=["GET"])
@admin_required
def get_transport_units():
    return jsonify(db.reference("transportUnits").get() or {})


# -------------------------------
# CREATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units", methods=["POST"])
@admin_required
def create_transport_unit():
    data = request.json or {}

    unit_id = generate_unit_id()

    unit = {
        "unitType": data.get("unitType"),
        "transportUnit": data.get("transportUnit"),
        "color": data.get("color"),
        "plateNumber": data.get("plateNumber")
    }

    db.reference(f"transportUnits/{unit_id}").set(unit)

    return jsonify({"unit_id": unit_id}), 201


# -------------------------------
# UPDATE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["PUT"])
@admin_required
def update_transport_unit(unit_id):
    data = request.json or {}

    db.reference(f"transportUnits/{unit_id}").update({
        "unitType": data.get("unitType"),
        "transportUnit": data.get("transportUnit"),
        "color": data.get("color"),
        "plateNumber": data.get("plateNumber")
    })

    return jsonify(success=True)


# -------------------------------
# DELETE transport unit
# -------------------------------
@admin_transport_units.route("/api/admin/transport-units/<unit_id>", methods=["DELETE"])
@admin_required
def delete_transport_unit(unit_id):
    db.reference(f"transportUnits/{unit_id}").delete()
    return jsonify(success=True)
