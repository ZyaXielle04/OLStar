"""Driver/admin inspection photos at vehicleInspections/date/period/vehicle/driver."""

import copy
import os
import re
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import requests
from firebase_admin import db
from flask import Blueprint, current_app, jsonify, request, session
from flask_wtf.csrf import validate_csrf
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge
from wtforms import ValidationError

from decorators import inspection_access_required


vehicle_inspections_api = Blueprint("vehicle_inspections_api", __name__)
MANILA = timezone(timedelta(hours=8))
PHOTO_SIDES = ("front", "back", "left", "right")
PHOTO_SLOTS = ("photo1", "photo2")
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_UPLOAD_BYTES = MAX_PHOTO_BYTES * 8 + 1024 * 1024


def valid_date(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False


def photo_pairs(driver_photos, admin_photos):
    """Pair the exact side/photo slot; never pair pictures by list position."""
    def photo_at(photos, side, slot):
        if not isinstance(photos, dict):
            return None
        group = photos.get(side)
        # Older records sometimes have one URL/photo object directly under a side.
        if isinstance(group, str):
            return {"url": group} if slot == "photo1" else None
        if not isinstance(group, dict):
            return None
        photo = group.get(slot)
        if photo is None and slot == "photo1" and "url" in group:
            photo = group
        if isinstance(photo, str):
            return {"url": photo}
        return copy.deepcopy(photo) if isinstance(photo, dict) else None

    return [
        {"side": side, "slot": slot,
         "driverPhoto": photo_at(driver_photos, side, slot),
         "adminPhoto": photo_at(admin_photos, side, slot)}
        for side in PHOTO_SIDES for slot in PHOTO_SLOTS
    ]


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
                        "adminPhotos", "adminSubmittedAt", "adminSubmittedBy", "adminSubmittedByName",
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
                record["photoPairs"] = photo_pairs(record["photos"], record["adminPhotos"])
                inspections.append(record)

    return inspections


@vehicle_inspections_api.route("/api/admin/vehicle-inspections", methods=["GET"])
@vehicle_inspections_api.route("/api/inspector/vehicle-inspections", methods=["GET"])
@inspection_access_required
def get_vehicle_inspections():
    inspection_date = request.args.get("date", datetime.now(MANILA).date().isoformat())
    period = request.args.get("period", "").upper()
    if not valid_date(inspection_date):
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


def prepare_admin_photos(files):
    """Validate every image before any Cloudinary uploads take place."""
    allowed_fields = {f"{side}_{slot}" for side in PHOTO_SIDES for slot in PHOTO_SLOTS}
    if not files or any(field not in allowed_fields for field in files):
        raise ValueError("Select at least one front, back, left, or right picture.")
    prepared = []
    for field in files:
        if len(files.getlist(field)) != 1:
            raise ValueError("Choose only one picture for each photo slot.")
        file = files[field]
        content = file.read(MAX_PHOTO_BYTES + 1)
        if not content or len(content) > MAX_PHOTO_BYTES:
            raise ValueError("Each picture must be between 1 byte and 10 MB.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as image:
                    image_format = image.format
                    if image_format not in ("JPEG", "PNG", "WEBP"):
                        raise ValueError("Use JPEG, PNG, or WebP pictures.")
                    if image.width * image.height > 30_000_000:
                        raise ValueError("Each picture must be 30 megapixels or smaller.")
                    image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise ValueError("One of the selected files is not a valid picture.") from error
        side, slot = field.split("_")
        prepared.append((side, slot, content, image_format))
    return prepared


def upload_admin_photo(content, image_format, folder):
    """Use the same Cloudinary account/preset as existing app image uploads."""
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "devyvqaxr")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cloud_name):
        raise RuntimeError("Invalid Cloudinary configuration")
    response = requests.post(
        f"https://api.cloudinary.com/v1_1/{cloud_name}/image/upload",
        files={"file": (f"{uuid.uuid4().hex}.{image_format.lower()}", content,
                        {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image_format])},
        data={"upload_preset": os.getenv("CLOUDINARY_UPLOAD_PRESET", "OLStar"), "folder": folder},
        timeout=45,
    )
    response.raise_for_status()
    result = response.json()
    url, public_id = result.get("secure_url"), result.get("public_id")
    if not isinstance(url, str) or not url.startswith("https://") or not isinstance(public_id, str) or not public_id:
        raise RuntimeError("Cloudinary did not return an uploaded image")
    return {"url": url, "publicId": public_id}


@vehicle_inspections_api.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify({"error": "The selected pictures are too large. Use up to 8 pictures, 10 MB each."}), 413


@vehicle_inspections_api.route(
    "/api/admin/vehicle-inspections/<inspection_date>/<period>/<vehicle_key>/<driver_id>/admin-photos",
    methods=["POST"],
)
@vehicle_inspections_api.route(
    "/api/inspector/vehicle-inspections/<inspection_date>/<period>/<vehicle_key>/<driver_id>/admin-photos",
    methods=["POST"],
)
@inspection_access_required
def submit_admin_photos(inspection_date, period, vehicle_key, driver_id):
    if not valid_date(inspection_date) or period not in ("AM", "PM"):
        return jsonify({"error": "Invalid inspection date or period."}), 400
    if any(not key or len(key.encode("utf-8")) > 768 or re.search(r"[.#$\[\]/\x00-\x1f\x7f]", key)
           for key in (vehicle_key, driver_id)):
        return jsonify({"error": "Invalid vehicle or driver key."}), 400
    try:
        validate_csrf(request.headers.get("X-CSRFToken"))
    except ValidationError:
        return jsonify({"error": "Your form session expired. Refresh the page and try again."}), 400
    if request.content_length is None or request.content_length > MAX_UPLOAD_BYTES:
        return upload_too_large(None)
    try:
        prepared = prepare_admin_photos(request.files)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    try:
        path = f"vehicleInspections/{inspection_date}/{period}/{vehicle_key}/{driver_id}"
        inspection_ref = db.reference(path)
        existing = inspection_ref.get()
        if not isinstance(existing, dict) or not any(key in existing for key in ("photos", "status", "submittedAt")):
            return jsonify({"error": "This inspection no longer exists. Refresh the page."}), 404
    except Exception:
        current_app.logger.exception("Unable to locate inspection for admin pictures")
        return jsonify({"error": "Unable to load this inspection. Please try again."}), 500

    submitted_at = int(datetime.now(MANILA).timestamp() * 1000)
    admin_id = session["uid"]
    admin_name = session.get("full_name") or session.get("email") or admin_id
    updates = {"adminSubmittedAt": submitted_at, "adminSubmittedBy": admin_id, "adminSubmittedByName": admin_name}
    updated = copy.deepcopy(existing)
    if not isinstance(updated.get("adminPhotos"), dict):
        updated["adminPhotos"] = {}
    try:
        def upload_one(item):
            side, slot, content, image_format = item
            return side, slot, upload_admin_photo(content, image_format, f"vehicle_inspections/admin/{inspection_date}")

        # Avoid eight sequential network round trips for a complete picture set.
        with ThreadPoolExecutor(max_workers=min(4, len(prepared))) as pool:
            uploaded = list(pool.map(upload_one, prepared))
        for side, slot, photo in uploaded:
            photo.update(uploadedAt=submitted_at, uploadedBy=admin_id, uploadedByName=admin_name)
            updates[f"adminPhotos/{side}/{slot}"] = photo
            if not isinstance(updated["adminPhotos"].get(side), dict):
                updated["adminPhotos"][side] = {}
            updated["adminPhotos"][side][slot] = photo
    except Exception:
        current_app.logger.exception("Unable to upload admin inspection pictures")
        return jsonify({"error": "Picture upload failed. Inspection records were not changed. Please try again."}), 502

    try:
        # Multi-location update preserves driver photos and all unselected admin slots.
        inspection_ref.update(updates)
    except Exception:
        current_app.logger.exception("Unable to save admin inspection pictures")
        return jsonify({"error": "Unable to confirm the pictures were saved. Refresh the inspection before retrying."}), 500
    updated.update({key: value for key, value in updates.items() if "/" not in key})
    record = flatten_inspections({period: {vehicle_key: {driver_id: updated}}}, inspection_date)[0]
    return jsonify({"message": "Admin pictures saved.", "uploaded": len(prepared), "inspection": record})
