"""Read driver submissions from vehicleInspections/date/period/vehicle/driver."""

from datetime import date, datetime, timedelta, timezone

from firebase_admin import db
from flask import Blueprint, current_app, jsonify, request

from decorators import admin_required


vehicle_inspections_api = Blueprint("vehicle_inspections_api", __name__)
MANILA = timezone(timedelta(hours=8))


def flatten_inspections(snapshot, inspection_date, selected_period=None):
    """Keep the existing Firebase hierarchy and submission fields intact."""
    inspections = []
    if not isinstance(snapshot, dict):
        return inspections

    for period in ("AM", "PM"):
        if selected_period and period != selected_period:
            continue
        vehicles = snapshot.get(period)
        if not isinstance(vehicles, dict):
            continue
        for vehicle_key, drivers in vehicles.items():
            if not isinstance(drivers, dict):
                continue
            for driver_id, submission in drivers.items():
                if not isinstance(submission, dict):
                    continue
                # Ignore malformed branches rather than displaying phantom records.
                if not any(field in submission for field in ("status", "photos", "submittedAt")):
                    continue
                record = {
                    field: submission.get(field)
                    for field in (
                        "driverName", "driverPhone", "photos", "source", "status",
                        "submittedAt", "transportUnit", "tripId", "windowEnd", "windowStart",
                    )
                }
                record.update({
                    "id": f"{inspection_date}/{period}/{vehicle_key}/{driver_id}",
                    "date": inspection_date,
                    "period": period,
                    "driverId": submission.get("driverId") or driver_id,
                    "vehicleKey": submission.get("vehicleKey") or vehicle_key,
                    "plateNumber": submission.get("plateNumber") or vehicle_key,
                })
                inspections.append(record)

    return inspections


@vehicle_inspections_api.route("/api/admin/vehicle-inspections", methods=["GET"])
@admin_required
def get_vehicle_inspections():
    inspection_date = request.args.get("date", datetime.now(MANILA).date().isoformat())
    period = request.args.get("period", "").upper()
    try:
        if date.fromisoformat(inspection_date).isoformat() != inspection_date:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "Date must use YYYY-MM-DD format."}), 400
    if period not in ("", "AM", "PM"):
        return jsonify({"error": "Period must be AM or PM."}), 400

    try:
        # Read one date only; no root scan or database index is required.
        snapshot = db.reference("vehicleInspections").child(inspection_date).get()
        inspections = flatten_inspections(snapshot, inspection_date, period)
        response = jsonify({
            "inspections": inspections,
            "date": inspection_date,
            "count": len(inspections),
        })
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception:
        current_app.logger.exception("Unable to load vehicle inspections")
        return jsonify({"error": "Unable to load inspections. Please try again."}), 500
