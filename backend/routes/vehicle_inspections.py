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
from itsdangerous import BadSignature, URLSafeTimedSerializer
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge
from wtforms import ValidationError

from decorators import inspection_access_required


vehicle_inspections_api = Blueprint("vehicle_inspections_api", __name__)
MANILA = timezone(timedelta(hours=8))
PHOTO_COUNTS = {"front": 2, "back": 2, "right": 4, "left": 4, "inside": 2}
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 1024 * 1024 * 1024
VIDEO_CHUNK_BYTES = 8 * 1024 * 1024
VIDEO_TOKEN_MAX_AGE = 2 * 60 * 60
MAX_UPLOAD_BYTES = MAX_PHOTO_BYTES * sum(PHOTO_COUNTS.values()) + MAX_VIDEO_BYTES + 1024 * 1024


class InspectionSealedError(Exception):
    pass


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
        for side, count in PHOTO_COUNTS.items() for slot in (f"photo{number}" for number in range(1, count + 1))
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
                        "adminPhotos", "adminVideo", "video", "adminSubmittedAt", "adminSubmittedBy", "adminSubmittedByName",
                        "approved", "approvedAt", "approvedBy", "approvedByName",
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
    allowed_fields = {f"{side}_photo{number}" for side, count in PHOTO_COUNTS.items() for number in range(1, count + 1)} | {"overall_video"}
    if not files or any(field not in allowed_fields for field in files):
        raise ValueError("All 14 pictures and the overall inspection video are required.")
    prepared = []
    for field in files:
        if len(files.getlist(field)) != 1:
            raise ValueError("Choose only one file for each slot.")
        file = files[field]
        if field == "overall_video":
            file.seek(0, 2)
            size = file.tell()
            file.seek(0)
            if not 0 < size <= MAX_VIDEO_BYTES:
                raise ValueError("The inspection video must be between 1 byte and 1 GB.")
            video_format = video_container_format(file.read(4096))
            file.seek(0)
            prepared.append(("video", "overall", file.stream, video_format))
            continue
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


def video_container_format(header):
    # Cloudinary performs the full video decode and video-track validation.
    if len(header) >= 12 and header[4:8] == b"ftyp":
        return "MOV" if header[8:12] == b"qt  " else "MP4"
    if header.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in header:
        return "WEBM"
    raise ValueError("Use an MP4, MOV, or WebM inspection video.")


def cloudinary_video_metadata(result):
    url, public_id = result.get("secure_url"), result.get("public_id")
    if (not isinstance(url, str) or not url.startswith("https://")
            or not isinstance(public_id, str) or not public_id
            or result.get("resource_type") != "video" or not result.get("width") or not result.get("height")):
        raise RuntimeError("Cloudinary did not return an uploaded video with a video track")
    return {"url": url, "publicId": public_id, "format": result.get("format"), "duration": result.get("duration")}


def upload_video_chunk(content, video_format, folder, upload_id, public_id, start, total):
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "devyvqaxr")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cloud_name):
        raise RuntimeError("Invalid Cloudinary configuration")
    response = requests.post(
        f"https://api.cloudinary.com/v1_1/{cloud_name}/video/upload",
        files={"file": (f"{public_id}.{video_format.lower()}", content,
                        {"MP4": "video/mp4", "MOV": "video/quicktime", "WEBM": "video/webm"}[video_format])},
        headers={"X-Unique-Upload-Id": upload_id,
                 "Content-Range": f"bytes {start}-{start + len(content) - 1}/{total}"},
        data={"upload_preset": os.getenv("CLOUDINARY_UPLOAD_PRESET", "OLStar"), "folder": folder, "public_id": public_id},
        timeout=(15, 90),
    )
    response.raise_for_status()
    return response.json()


def upload_admin_video(content, video_format, folder):
    """Stream legacy multipart uploads in bounded chunks, never buffer a 1 GB file."""
    stream = BytesIO(content) if isinstance(content, bytes) else content
    stream.seek(0, 2)
    total = stream.tell()
    stream.seek(0)
    if not 0 < total <= MAX_VIDEO_BYTES:
        raise ValueError("The inspection video must be between 1 byte and 1 GB.")
    upload_id, public_id = uuid.uuid4().hex, uuid.uuid4().hex
    start = 0
    while start < total:
        chunk = stream.read(min(VIDEO_CHUNK_BYTES, total - start))
        if not chunk:
            raise RuntimeError("Video ended before the expected file size")
        result = upload_video_chunk(chunk, video_format, folder, upload_id, public_id, start, total)
        start += len(chunk)
    return cloudinary_video_metadata(result)


def video_tokens():
    return URLSafeTimedSerializer(current_app.secret_key, salt="inspection-video-upload")


def read_video_token(token, inspection_id, kind):
    try:
        data = video_tokens().loads(token, max_age=VIDEO_TOKEN_MAX_AGE)
        if data.get("uid") != session["uid"] or data.get("inspection") != inspection_id or data.get("kind") != kind:
            raise ValueError()
        return data
    except (BadSignature, ValueError, TypeError, AttributeError):
        raise ValueError("The video upload session expired or is invalid. Select the video and try again.") from None


def video_upload_access(inspection_date, period, vehicle_key, driver_id):
    if session.get("role") != "inspector":
        return jsonify({"error": "Only inspectors can upload inspection videos."}), 403
    if not valid_date(inspection_date) or period not in ("AM", "PM") or any(
        not key or len(key.encode("utf-8")) > 768 or re.search(r"[.#$\[\]/\x00-\x1f\x7f]", key)
        for key in (vehicle_key, driver_id)
    ):
        return jsonify({"error": "Invalid inspection path."}), 400
    try:
        validate_csrf(request.headers.get("X-CSRFToken"))
    except ValidationError:
        return jsonify({"error": "Your form session expired. Refresh the page and try again."}), 400
    try:
        existing = db.reference(f"vehicleInspections/{inspection_date}/{period}/{vehicle_key}/{driver_id}").get()
        if not isinstance(existing, dict) or not any(key in existing for key in ("photos", "status", "submittedAt")):
            return jsonify({"error": "This inspection no longer exists. Refresh the page."}), 404
        if existing.get("approved") is True:
            return jsonify({"error": "This inspection is approved and sealed.", "code": "INSPECTION_SEALED"}), 409
    except Exception:
        current_app.logger.exception("Unable to load inspection for video upload")
        return jsonify({"error": "Unable to load this inspection. Please try again."}), 500
    return None


@vehicle_inspections_api.route(
    "/api/inspector/vehicle-inspections/<inspection_date>/<period>/<vehicle_key>/<driver_id>/video-upload", methods=["POST"],
)
@inspection_access_required
def begin_video_upload(inspection_date, period, vehicle_key, driver_id):
    if request.content_length is None or request.content_length > 4096:
        return jsonify({"error": "Invalid video upload request."}), 400
    error = video_upload_access(inspection_date, period, vehicle_key, driver_id)
    if error is not None:
        return error
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid video upload request."}), 400
    size, video_format = data.get("size"), data.get("format")
    if type(size) is not int or not 0 < size <= MAX_VIDEO_BYTES:
        return jsonify({"error": "The inspection video must be between 1 byte and 1 GB."}), 400
    if video_format not in ("MP4", "MOV", "WEBM"):
        return jsonify({"error": "Use an MP4, MOV, or WebM inspection video."}), 400
    state = {"kind": "chunk", "uid": session["uid"], "inspection": f"{inspection_date}/{period}/{vehicle_key}/{driver_id}",
             "size": size, "format": video_format, "offset": 0, "uploadId": uuid.uuid4().hex, "publicId": uuid.uuid4().hex}
    return jsonify({"token": video_tokens().dumps(state), "chunkSize": VIDEO_CHUNK_BYTES})


@vehicle_inspections_api.route(
    "/api/inspector/vehicle-inspections/<inspection_date>/<period>/<vehicle_key>/<driver_id>/video-upload/chunk", methods=["POST"],
)
@inspection_access_required
def receive_video_chunk(inspection_date, period, vehicle_key, driver_id):
    if request.content_length is None or request.content_length > VIDEO_CHUNK_BYTES + 64 * 1024:
        return jsonify({"error": "The video chunk is too large."}), 413
    error = video_upload_access(inspection_date, period, vehicle_key, driver_id)
    if error is not None:
        return error
    try:
        state = read_video_token(request.form.get("token"), f"{inspection_date}/{period}/{vehicle_key}/{driver_id}", "chunk")
        if set(request.files) != {"chunk"} or len(request.files.getlist("chunk")) != 1:
            raise ValueError("Choose one video chunk.")
        chunk = request.files["chunk"].read(VIDEO_CHUNK_BYTES + 1)
        expected = min(VIDEO_CHUNK_BYTES, state["size"] - state["offset"])
        if not chunk or len(chunk) != expected:
            raise ValueError("The video chunk has an invalid size. Try uploading again.")
        if state["offset"] == 0 and video_container_format(chunk[:4096]) != state["format"]:
            raise ValueError("The video format does not match the selected file.")
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    try:
        result = upload_video_chunk(chunk, state["format"], f"vehicle_inspections/admin/{inspection_date}",
                                    state["uploadId"], state["publicId"], state["offset"], state["size"])
        state["offset"] += len(chunk)
        if state["offset"] == state["size"]:
            state = {"kind": "complete", "uid": state["uid"], "inspection": state["inspection"],
                     "video": cloudinary_video_metadata(result)}
            return jsonify({"done": True, "videoToken": video_tokens().dumps(state)})
        return jsonify({"done": False, "token": video_tokens().dumps(state)})
    except Exception:
        current_app.logger.exception("Unable to upload inspection video chunk")
        return jsonify({"error": "Video upload failed. Check your connection and the Cloudinary video size limit, then try again."}), 502


@vehicle_inspections_api.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify({"error": "The selected files are too large. Use up to 14 pictures (10 MB each) and one video (1 GB)."}), 413


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
    if session.get("role") != "inspector":
        return jsonify({"error": "Only inspectors can submit inspection pictures."}), 403
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
        video_token = request.form.get("overall_video_token")
        completed_video = None
        if video_token:
            if len(request.form.getlist("overall_video_token")) != 1 or "overall_video" in request.files:
                raise ValueError("Choose only one overall inspection video.")
            completed_video = read_video_token(video_token, f"{inspection_date}/{period}/{vehicle_key}/{driver_id}", "complete")["video"]
        prepared = prepare_admin_photos(request.files) if request.files or not completed_video else []
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    try:
        path = f"vehicleInspections/{inspection_date}/{period}/{vehicle_key}/{driver_id}"
        inspection_ref = db.reference(path)
        existing = inspection_ref.get()
        if not isinstance(existing, dict) or not any(key in existing for key in ("photos", "status", "submittedAt")):
            return jsonify({"error": "This inspection no longer exists. Refresh the page."}), 404
        if existing.get("approved") is True and session["role"] == "inspector":
            return jsonify({"error": "This inspection is approved and sealed.", "code": "INSPECTION_SEALED"}), 409
    except Exception:
        current_app.logger.exception("Unable to locate inspection for admin pictures")
        return jsonify({"error": "Unable to load this inspection. Please try again."}), 500

    required_photos = {f"{side}_photo{number}" for side, count in PHOTO_COUNTS.items() for number in range(1, count + 1)}
    submitted_photos = {f"{side}_{slot}" for side, slot, *_ in prepared if side != "video"}
    missing = sorted(required_photos - submitted_photos)
    if not completed_video and not any(side == "video" for side, *_ in prepared):
        missing.append("overall_video")
    if missing:
        labels = [slot.replace("_", " ").replace("photo", "photo ").capitalize() for slot in missing]
        return jsonify({"error": "All 14 pictures and the overall inspection video are required. Missing: " + ", ".join(labels) + ".",
                        "missing": missing}), 400

    submitted_at = int(datetime.now(MANILA).timestamp() * 1000)
    admin_id = session["uid"]
    admin_name = session.get("full_name") or session.get("email") or admin_id
    updates = {"adminSubmittedAt": submitted_at, "adminSubmittedBy": admin_id, "adminSubmittedByName": admin_name}
    if completed_video:
        completed_video.update(uploadedAt=submitted_at, uploadedBy=admin_id, uploadedByName=admin_name)
        updates["adminVideo"] = completed_video
    updated = copy.deepcopy(existing)
    if not isinstance(updated.get("adminPhotos"), dict):
        updated["adminPhotos"] = {}
    try:
        def upload_one(item):
            side, slot, content, image_format = item
            upload = upload_admin_video if side == "video" else upload_admin_photo
            return side, slot, upload(content, image_format, f"vehicle_inspections/admin/{inspection_date}")

        # Upload independent media files concurrently.
        uploaded = []
        if prepared:
            with ThreadPoolExecutor(max_workers=min(4, len(prepared))) as pool:
                uploaded = list(pool.map(upload_one, prepared))
        for side, slot, photo in uploaded:
            photo.update(uploadedAt=submitted_at, uploadedBy=admin_id, uploadedByName=admin_name)
            if side == "video":
                updates["adminVideo"] = photo
                continue
            updates[f"adminPhotos/{side}/{slot}"] = photo
            if not isinstance(updated["adminPhotos"].get(side), dict):
                updated["adminPhotos"][side] = {}
            updated["adminPhotos"][side][slot] = photo
    except Exception:
        current_app.logger.exception("Unable to upload admin inspection pictures")
        return jsonify({"error": "Media upload failed. Inspection records were not changed. Please try again."}), 502

    try:
        # Multi-location update preserves driver photos and all unselected admin slots.
        if session["role"] == "inspector":
            def save_if_open(current):
                if not isinstance(current, dict) or current.get("approved") is True:
                    raise InspectionSealedError()
                merged = copy.deepcopy(current)
                for key, value in updates.items():
                    parent = merged
                    parts = key.split("/")
                    for part in parts[:-1]:
                        if not isinstance(parent.get(part), dict):
                            parent[part] = {}
                        parent = parent[part]
                    parent[parts[-1]] = value
                return merged
            updated = inspection_ref.transaction(save_if_open)
        else:
            inspection_ref.update(updates)
    except InspectionSealedError:
        return jsonify({"error": "This inspection was sealed before your pictures could be saved. Refresh the case.", "code": "INSPECTION_SEALED"}), 409
    except Exception:
        current_app.logger.exception("Unable to save admin inspection pictures")
        return jsonify({"error": "Unable to confirm the pictures were saved. Refresh the inspection before retrying."}), 500
    updated.update({key: value for key, value in updates.items() if "/" not in key})
    record = flatten_inspections({period: {vehicle_key: {driver_id: updated}}}, inspection_date)[0]
    return jsonify({"message": "Inspection pictures and video saved.", "uploaded": len(prepared) + (1 if completed_video else 0), "inspection": record})
