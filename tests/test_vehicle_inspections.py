"""Inspection page/API checks using synthetic data and a mocked Firebase client."""

import importlib.util
import copy
import re
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch
from types import SimpleNamespace

import pytest
from flask import Flask
from flask_wtf import CSRFProtect
from PIL import Image
from werkzeug.datastructures import MultiDict


ROOT = Path(__file__).resolve().parents[1]


def load_routes(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "backend" / "routes" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(ROOT / "backend"))
    try:
        with patch("dotenv.load_dotenv"):
            spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


routes = load_routes("inspection_routes_under_test", "vehicle_inspections.py")
pages = load_routes("inspection_pages_under_test", "pages.py")


def make_app():
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "static"))
    app.config.update(TESTING=True, SECRET_KEY="inspection-test-secret", WTF_CSRF_CHECK_DEFAULT=False)
    CSRFProtect(app)
    app.register_blueprint(pages.pages_bp)
    app.register_blueprint(routes.vehicle_inspections_api)
    return app


@pytest.fixture
def client():
    client = make_app().test_client()
    with client.session_transaction() as session:
        session.update(uid="test-admin", role="admin")
    return client


@pytest.fixture
def inspector_client(client):
    with client.session_transaction() as session:
        session.update(uid="test-inspector", role="inspector")
    return client


@pytest.fixture
def snapshot():
    return {
        "AM": {"NLT1055": {"driver-one": {
            "driverName": "Example Driver", "driverPhone": "09000000000",
            "photos": {"front": "https://example.test/front.jpg"},
            "status": "submitted", "submittedAt": 1793149200000,
            "transportUnit": "Example Van", "source": "mobile",
            "windowStart": "2026-10-28T06:00:00+08:00",
            "windowEnd": "2026-10-28T09:00:00+08:00", "tripId": "trip-example",
        }}},
        "PM": {"NLT1055": {
            "driver-one": {"status": "late", "driverName": "Example Driver"},
            "driver-two": {"status": "submitted", "driverId": "driver-two", "photos": []},
        }},
    }


def test_flatten_keeps_each_period_vehicle_and_driver(snapshot):
    records = routes.flatten_inspections(snapshot, "2026-10-28")
    assert len(records) == 3
    assert len({record["id"] for record in records}) == 3
    record = records[0]
    assert record["id"] == "2026-10-28/AM/NLT1055/driver-one"
    assert record["date"] == "2026-10-28"
    assert record["driverId"] == "driver-one"
    assert record["plateNumber"] == record["vehicleKey"] == "NLT1055"
    for field, value in snapshot["AM"]["NLT1055"]["driver-one"].items():
        assert record[field] == value


def test_all_submission_fields_and_photo_metadata_are_retained(snapshot):
    original = snapshot["AM"]["NLT1055"]["driver-one"]
    original.update(driverId="actual-driver-id", vehicleKey="actual-vehicle-key", plateNumber="NLT 1055")
    original["transportUnit"] = {"name": "Example Van", "unitType": "Van"}
    original["photos"] = [{"downloadURL": "https://example.test/front.jpg", "label": "Front", "takenAt": 123}]
    record = routes.flatten_inspections(snapshot, "2026-10-28", "AM")[0]
    for field, value in original.items():
        assert record[field] == value


@pytest.mark.parametrize("snapshot", [None, [], "invalid", {"AM": None}, {"AM": {"vehicle": None}}, {"PM": {"vehicle": {"driver": None, "other": {"unrelated": True}}}}])
def test_empty_or_malformed_branches_do_not_create_phantom_records(snapshot):
    assert routes.flatten_inspections(snapshot, "2026-10-28") == []


def test_api_reads_only_requested_date(client, snapshot):
    with patch.object(routes.db, "reference") as reference:
        reference.return_value.child.return_value.get.return_value = snapshot
        response = client.get("/api/admin/vehicle-inspections?date=2026-10-28")
    assert response.status_code == 200
    assert response.json["count"] == 3
    assert response.headers["Cache-Control"] == "no-store"
    reference.assert_called_once_with("vehicleInspections")
    reference.return_value.child.assert_called_once_with("2026-10-28")


def test_period_filter(client, snapshot):
    with patch.object(routes.db, "reference") as reference:
        reference.return_value.child.return_value.get.return_value = snapshot
        response = client.get("/api/admin/vehicle-inspections?date=2026-10-28&period=pm")
    assert response.status_code == 200
    assert response.json["count"] == 2
    assert all(record["period"] == "PM" for record in response.json["inspections"])


@pytest.mark.parametrize("query", ["date=bad", "date=2026-02-30", "date=20261028", "date=2026-W44-3", "date=../users", "date=", "date=2026-10-28&period=night"])
def test_invalid_queries_do_not_reach_database(client, query):
    with patch.object(routes.db, "reference") as reference:
        response = client.get(f"/api/admin/vehicle-inspections?{query}")
    assert response.status_code == 400
    reference.assert_not_called()


@pytest.mark.parametrize("role", [None, "driver", "demo"])
def test_unauthorized_users_cannot_read_inspections(client, role):
    with client.session_transaction() as session:
        session.clear()
        if role:
            session.update(uid="other-user", role=role)
    with patch.object(routes.db, "reference") as reference:
        assert client.get("/api/admin/vehicle-inspections?date=2026-10-28").status_code == 302
        assert client.get("/admin/vehicle-inspections").status_code == 302
    reference.assert_not_called()


def test_empty_date_returns_empty_collection(client):
    with patch.object(routes.db, "reference") as reference:
        reference.return_value.child.return_value.get.return_value = None
        response = client.get("/api/admin/vehicle-inspections?date=2026-10-28")
    assert response.status_code == 200
    assert response.json["inspections"] == []


def test_database_failure_returns_useful_error_without_internal_details(client):
    with patch.object(routes.db, "reference", side_effect=RuntimeError("private-internal-details")):
        response = client.get("/api/admin/vehicle-inspections?date=2026-10-28")
    assert response.status_code == 500
    assert "Unable to load inspections" in response.json["error"]
    assert "private-internal-details" not in response.get_data(as_text=True)


def test_admin_page_renders_and_all_admin_sidebars_link_to_it(client):
    response = client.get("/admin/vehicle-inspections")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "vehicle_inspections.js" in html
    assert 'aria-current="page"' in html
    for template in (ROOT / "templates").glob("*.html"):
        source = template.read_text(encoding="utf-8")
        if "pages.admin_transport_units" in source:
            assert "pages.vehicle_inspections" in source, template.name


UPLOAD_PATH = "/api/inspector/vehicle-inspections/2026-10-28/PM/NLT1055/driver-one/admin-photos"


@pytest.fixture
def nested_submission():
    return {
        "date": "2026-10-28", "period": "PM", "vehicleKey": "NLT1055",
        "plateNumber": "NLT 1055", "driverId": "driver-one",
        "driverName": "Example Driver", "driverPhone": "09000000000",
        "status": "complete", "source": "camera", "transportUnit": "Example Van",
        "tripId": "EXAMPLE1", "submittedAt": 1793178442299,
        "windowStart": 1793160000000, "windowEnd": 1793185200000,
        "photos": {
            side: {slot: {"capturedAt": 1793178442000, "publicId": f"driver/{side}/{slot}",
                          "url": f"https://example.test/driver/{side}/{slot}.jpg"}
                   for slot in ("photo1", "photo2")}
            for side in ("front", "back", "left", "right")
        },
        "adminPhotos": {"front": {"photo2": {"url": "https://example.test/admin/existing.jpg", "publicId": "admin/existing"}}},
    }


def csrf_headers(client):
    with client.session_transaction() as session:
        portal = "inspector" if session.get("role") == "inspector" else "admin"
    page = client.get(f"/{portal}/vehicle-inspections").get_data(as_text=True)
    token = re.search(r'<meta name="csrf-token" content="([^"]+)"', page)[1]
    return {"X-CSRFToken": token}


def picture(image_format="PNG"):
    image = BytesIO()
    Image.new("RGB", (5, 5), (32, 64, 128)).save(image, format=image_format)
    image.seek(0)
    return image


def required_submission(client, overrides=None):
    files = {f"{side}_photo{number}": (picture(), "photo.png")
             for side, count in routes.PHOTO_COUNTS.items() for number in range(1, count + 1)}
    with client.session_transaction() as session:
        uid = session["uid"]
    with client.application.app_context():
        files["overall_video_token"] = routes.video_tokens().dumps({
            "kind": "complete", "uid": uid, "inspection": "2026-10-28/PM/NLT1055/driver-one",
            "video": {"url": "https://example.test/video.mp4", "publicId": "inspection/video"},
        })
    if overrides:
        if "overall_video" in overrides:
            files.pop("overall_video_token")
        files.update(overrides)
    return files


def test_exact_nested_driver_photo_schema_and_millisecond_times(nested_submission):
    original = copy.deepcopy(nested_submission)
    records = routes.flatten_inspections({"PM": {"NLT1055": {"driver-one": nested_submission}}}, "2026-10-28")
    record = records[0]
    assert record["photos"] == original["photos"]
    assert record["adminPhotos"] == original["adminPhotos"]
    assert record["submittedAt"] == 1793178442299
    assert record["windowStart"] == 1793160000000
    assert record["windowEnd"] == 1793185200000
    assert len(record["photoPairs"]) == 14
    for pair in record["photoPairs"]:
        assert pair["driverPhoto"] == original["photos"].get(pair["side"], {}).get(pair["slot"])
    front_two = next(pair for pair in record["photoPairs"] if pair["side"] == "front" and pair["slot"] == "photo2")
    assert front_two["adminPhoto"] == original["adminPhotos"]["front"]["photo2"]
    assert nested_submission == original


def test_inspector_submission_updates_all_slots_and_preserves_driver_photos(inspector_client, nested_submission):
    original = copy.deepcopy(nested_submission)
    headers = csrf_headers(inspector_client)
    with inspector_client.session_transaction() as session:
        session["full_name"] = "Example Inspector"
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        reference.return_value.transaction.side_effect = lambda callback: callback(copy.deepcopy(nested_submission))
        upload.return_value = {"url": "https://example.test/admin/new.jpg", "publicId": "admin/new"}
        response = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, {"front_photo1": (picture(), "front.png")}), headers=headers)
    assert response.status_code == 200
    reference.assert_called_once_with("vehicleInspections/2026-10-28/PM/NLT1055/driver-one")
    updates = response.json["inspection"]
    reference.return_value.update.assert_not_called()
    assert updates["adminSubmittedBy"] == "test-inspector"
    assert updates["adminSubmittedByName"] == "Example Inspector"
    assert updates["adminPhotos"]["front"]["photo1"]["uploadedBy"] == "test-inspector"
    assert isinstance(updates["adminSubmittedAt"], int)
    saved = response.json["inspection"]
    assert saved["photos"] == original["photos"]
    assert saved["adminPhotos"]["front"]["photo2"]["url"] == "https://example.test/admin/new.jpg"
    assert saved["adminPhotos"]["front"]["photo1"]["url"] == "https://example.test/admin/new.jpg"
    assert saved["status"] == "complete"
    assert saved["driverId"] == "driver-one"
    assert nested_submission == original


def test_upload_all_fourteen_side_slot_pictures(inspector_client, nested_submission):
    headers = csrf_headers(inspector_client)
    files = {f"{side}_{slot}": (picture(), "image.png") for side, count in routes.PHOTO_COUNTS.items() for slot in (f"photo{number}" for number in range(1, count + 1))}
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        reference.return_value.transaction.side_effect = lambda callback: callback(copy.deepcopy(nested_submission))
        upload.return_value = {"url": "https://example.test/new.png", "publicId": "new"}
        response = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, files), headers=headers)
    assert response.status_code == 200
    assert response.json["uploaded"] == 15
    assert upload.call_count == 14
    saved = response.json["inspection"]["adminPhotos"]
    assert sum(len(slots) for slots in saved.values()) == 14


def test_invalid_csrf_prevents_database_or_cloud_access(inspector_client):
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        response = inspector_client.post(UPLOAD_PATH, data={"front_photo1": (picture(), "photo.png")}, headers={"X-CSRFToken": "invalid"})
    assert response.status_code == 400
    reference.assert_not_called()
    upload.assert_not_called()


@pytest.mark.parametrize("role", [None, "driver", "demo"])
def test_unauthorized_users_cannot_upload_admin_pictures(client, role):
    with client.session_transaction() as session:
        session.clear()
        if role:
            session.update(uid="other-user", role=role)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        response = client.post(UPLOAD_PATH, data={"front_photo1": (picture(), "photo.png")})
    assert response.status_code == 302
    reference.assert_not_called()
    upload.assert_not_called()


@pytest.mark.parametrize("suffix", [
    "bad/PM/NLT1055/driver-one", "2026-10-28/NIGHT/NLT1055/driver-one",
    "2026-10-28/PM/bad.key/driver-one", "2026-10-28/PM/NLT1055/bad%24key",
])
def test_invalid_record_paths_cannot_be_written(inspector_client, suffix):
    with patch.object(routes.db, "reference") as reference:
        response = inspector_client.post(f"/api/inspector/vehicle-inspections/{suffix}/admin-photos")
    assert response.status_code == 400
    reference.assert_not_called()


@pytest.mark.parametrize("case", ["empty", "unknown-slot", "duplicate", "not-image", "gif", "large-file", "large-request"])
def test_invalid_files_are_rejected_before_any_upload(inspector_client, case):
    headers = csrf_headers(inspector_client)
    data = {"front_photo1": (picture(), "photo.png")}
    if case == "empty":
        data = {"unused": "nothing"}
    elif case == "unknown-slot":
        data = {"roof_photo1": (picture(), "photo.png")}
    elif case == "duplicate":
        data = MultiDict([("front_photo1", (picture(), "one.png")), ("front_photo1", (picture(), "two.png"))])
    elif case == "not-image":
        data = {"front_photo1": (BytesIO(b"This is not a picture"), "fake.png")}
    elif case == "gif":
        data = {"front_photo1": (picture("GIF"), "animated.gif")}
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        with patch.object(routes, "MAX_PHOTO_BYTES", 10 if case == "large-file" else routes.MAX_PHOTO_BYTES), patch.object(routes, "MAX_UPLOAD_BYTES", 1 if case == "large-request" else routes.MAX_UPLOAD_BYTES):
            response = inspector_client.post(UPLOAD_PATH, data=data, headers=headers)
    assert response.status_code == (413 if case == "large-request" else 400)
    reference.assert_not_called()
    upload.assert_not_called()


def test_deleted_inspection_does_not_create_a_new_record(inspector_client):
    headers = csrf_headers(inspector_client)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = None
        response = inspector_client.post(UPLOAD_PATH, data={"front_photo1": (picture(), "photo.png")}, headers=headers)
    assert response.status_code == 404
    reference.return_value.update.assert_not_called()
    upload.assert_not_called()


def test_partial_cloud_upload_failure_does_not_change_inspection(inspector_client, nested_submission):
    headers = csrf_headers(inspector_client)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        upload.side_effect = [{"url": "https://example.test/first.png", "publicId": "first"}, RuntimeError("synthetic failure")]
        response = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, {"front_photo1": (picture(), "front.png"), "back_photo1": (picture(), "back.png")}), headers=headers)
    assert response.status_code == 502
    reference.return_value.update.assert_not_called()
    assert "synthetic failure" not in response.get_data(as_text=True)


def test_database_save_failure_is_not_reported_as_success(inspector_client, nested_submission):
    headers = csrf_headers(inspector_client)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        reference.return_value.transaction.side_effect = RuntimeError("synthetic failure")
        upload.return_value = {"url": "https://example.test/new.png", "publicId": "new"}
        response = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, {"front_photo1": (picture(), "front.png")}), headers=headers)
    assert response.status_code == 500
    assert "Refresh the inspection" in response.json["error"]


def test_cloudinary_helper_uses_image_upload_and_validates_result():
    with patch.object(routes.requests, "post") as post:
        post.return_value.json.return_value = {"secure_url": "https://example.test/photo.png", "public_id": "inspection/photo"}
        assert routes.upload_admin_photo(b"image", "PNG", "vehicle_inspections/admin/2026-10-28") == {
            "url": "https://example.test/photo.png", "publicId": "inspection/photo"}
        assert post.call_args.args[0].endswith("/image/upload")
        assert post.call_args.kwargs["files"]["file"][2] == "image/png"
        assert post.call_args.kwargs["data"]["folder"] == "vehicle_inspections/admin/2026-10-28"
        post.return_value.json.return_value = {"secure_url": "javascript:alert(1)", "public_id": "bad"}
        with pytest.raises(RuntimeError):
            routes.upload_admin_photo(b"image", "PNG", "folder")


@pytest.mark.parametrize("role,destination", [
    ("admin", "/admin/dashboard"), ("demo", "/demo/track-drivers"),
    ("inspector", "/inspector/vehicle-inspections"), ("driver", None), (None, None),
])
def test_login_redirects_verified_accounts_by_role(role, destination):
    auth_routes = load_routes("auth_under_test", "../auth.py")
    app = make_app()
    app.config["RATELIMIT_ENABLED"] = False
    auth_routes.limiter.init_app(app)
    app.register_blueprint(auth_routes.auth_bp)
    with patch.object(auth_routes.requests, "post") as sign_in, patch.object(auth_routes.auth, "get_user") as user, patch.object(auth_routes.db, "reference") as reference:
        sign_in.return_value.status_code = 200
        sign_in.return_value.json.return_value = {"localId": "example-user", "idToken": "example-token"}
        user.return_value = SimpleNamespace(email_verified=True)
        reference.return_value.get.side_effect = [role, {"firstName": "Example", "lastName": "User"}]
        client = app.test_client()
        response = client.post("/admin/login", json={"email": "example@example.test", "password": "example"})
    if destination:
        assert response.status_code == 200
        assert response.json["redirect"] == destination
        with client.session_transaction() as session:
            assert session["role"] == role
            assert session["uid"] == "example-user"
    else:
        assert response.status_code == 403
        with client.session_transaction() as session:
            assert "uid" not in session


def test_inspector_page_and_inspection_read_access(client, snapshot):
    with client.session_transaction() as session:
        session.update(uid="example-inspector", role="inspector")
    page = client.get("/inspector/vehicle-inspections")
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    assert "Inspector Portal" in html
    assert 'data-inspection-api="/api/inspector/vehicle-inspections"' in html
    assert 'href="/admin/users"' not in html
    assert 'href="/admin/dashboard"' not in html
    with patch.object(routes.db, "reference") as reference:
        reference.return_value.child.return_value.get.return_value = snapshot
        assert client.get("/api/inspector/vehicle-inspections?date=2026-10-28").json["count"] == 3
    assert client.get("/api/admin/vehicle-inspections").status_code == 403
    assert client.get("/admin/dashboard").status_code == 302
    assert client.get("/admin/users").status_code == 302
    assert client.get("/admin/vehicle-inspections").status_code == 302


def test_inspector_can_submit_pictures_using_inspector_endpoint(client, nested_submission):
    with client.session_transaction() as session:
        session.update(uid="example-inspector", role="inspector", full_name="Example Inspector")
    html = client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    token = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)[1]
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        upload.return_value = {"url": "https://example.test/inspector.png", "publicId": "inspection/example"}
        reference.return_value.transaction.side_effect = lambda callback: callback(copy.deepcopy(nested_submission))
        response = client.post(UPLOAD_PATH.replace("/api/admin/", "/api/inspector/"), data=required_submission(client, {"front_photo1": (picture(), "front.png")}), headers={"X-CSRFToken": token})
        assert response.status_code == 200
        assert response.json["inspection"]["adminSubmittedBy"] == "example-inspector"
    with patch.object(routes.db, "reference") as reference:
        assert client.post(UPLOAD_PATH.replace("/api/inspector/", "/api/admin/")).status_code == 403
        reference.assert_not_called()


@pytest.mark.parametrize("role", [None, "driver", "demo", "admin"])
def test_inspector_page_requires_inspector_role(client, role):
    with client.session_transaction() as session:
        session.clear()
        if role:
            session.update(uid="other-user", role=role)
    assert client.get("/inspector/vehicle-inspections").status_code == (403 if role else 302)
    if role != "admin":
        with patch.object(routes.db, "reference") as reference:
            assert client.get("/api/inspector/vehicle-inspections").status_code == 302
            reference.assert_not_called()


def test_inspector_logout_clears_session(client):
    with client.session_transaction() as session:
        session.update(uid="example-inspector", role="inspector")
    assert client.get("/inspector/logout").status_code == 302
    with client.session_transaction() as session:
        assert "uid" not in session


@pytest.mark.parametrize("role", ["driver", "inspector", "admin"])
def test_admin_users_creation_role_and_email_verification(role):
    users = load_routes("users_creation_test", "admin_users.py")
    app = make_app()
    app.register_blueprint(users.admin_users_api)
    client = app.test_client()
    with client.session_transaction() as session:
        session.update(uid="admin-example", role="admin")
    payload = dict(email="example@example.test", phone="09000000000", firstName="Example", lastName="User", role=role)
    if role == "driver":
        payload["driverType"] = "main"
    with patch.object(users.auth, "create_user") as create, patch.object(users.db, "reference") as reference:
        create.return_value = SimpleNamespace(uid="created-user")
        response = client.post("/api/admin/users", json=payload)
        if role == "admin":
            assert response.status_code == 400
            create.assert_not_called()
            return
        assert response.status_code == 201
        assert create.call_args.kwargs["email_verified"] is True
        saved = reference.return_value.set.call_args.args[0]
        assert saved["role"] == role
        assert ("driverType" in saved) == (role == "driver")
        assert ("defaultTransportUnit" in saved) == (role == "driver")


def test_admin_user_list_includes_inspectors_without_driver_type():
    users = load_routes("users_listing_test", "admin_users.py")
    app = make_app()
    app.register_blueprint(users.admin_users_api)
    client = app.test_client()
    with client.session_transaction() as session:
        session.update(uid="admin-example", role="admin")
    with patch.object(users.db, "reference") as reference, patch.object(users.auth, "get_users") as auth_users:
        reference.return_value.get.return_value = {
            "inspector-example": {"role": "inspector", "firstName": "Example", "lastName": "Inspector"},
            "admin-example": {"role": "admin", "firstName": "Admin"},
        }
        auth_users.return_value = SimpleNamespace(users=[])
        response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert [user["role"] for user in response.json["users"]] == ["inspector"]


@pytest.mark.parametrize("role,environment,verified,expected", [
    ("inspector", "development", False, 200),
    (" Inspector ", "development", False, 200),
    ("inspector", "production", False, 403),
    ("inspector", "production", True, 200),
    ("admin", "development", False, 403),
    (None, "development", True, 403),
])
def test_inspector_development_verification_and_role_errors(role, environment, verified, expected):
    auth_routes = load_routes("auth_policy_test", "../auth.py")
    app = make_app()
    app.config["RATELIMIT_ENABLED"] = False
    auth_routes.limiter.init_app(app)
    app.register_blueprint(auth_routes.auth_bp)
    with patch.dict(auth_routes.os.environ, {"FLASK_ENV": environment}), patch.object(auth_routes.requests, "post") as sign_in, patch.object(auth_routes.auth, "get_user") as user, patch.object(auth_routes.db, "reference") as reference:
        sign_in.return_value.status_code = 200
        sign_in.return_value.json.return_value = {"localId": "example-user", "idToken": "example-token"}
        user.return_value = SimpleNamespace(email_verified=verified)
        reference.return_value.get.side_effect = [role, {"firstName": "Example"}]
        response = app.test_client().post("/admin/login", json={"email": "example@example.test", "password": "example"})
    assert response.status_code == expected
    if expected == 200:
        assert response.json["redirect"] == "/inspector/vehicle-inspections"
    else:
        assert response.json["code"] == ("PORTAL_ROLE_REQUIRED" if role is None else "EMAIL_NOT_VERIFIED")




def test_inspector_cannot_upload_sealed_case(client, nested_submission):
    with client.session_transaction() as session:
        session.update(uid="inspector-example", role="inspector")
    html = client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    assert 'id="approveInspection"' not in html
    token = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)[1]
    headers = {"X-CSRFToken": token}
    nested_submission["approved"] = True
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        response = client.post(UPLOAD_PATH.replace("/api/admin/", "/api/inspector/"), data={"front_photo1": (picture(), "front.png")}, headers=headers)
        assert response.status_code == 409
        assert response.json["code"] == "INSPECTION_SEALED"
        upload.assert_not_called()
        reference.return_value.transaction.assert_not_called()


def test_approval_during_upload_blocks_final_inspector_save(client, nested_submission):
    with client.session_transaction() as session:
        session.update(uid="inspector-example", role="inspector")
    html = client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    token = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)[1]
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        reference.return_value.get.return_value = nested_submission
        upload.return_value = {"url": "https://example.test/new.png", "publicId": "new"}
        reference.return_value.transaction.side_effect = lambda callback: callback({**nested_submission, "approved": True})
        response = client.post(UPLOAD_PATH.replace("/api/admin/", "/api/inspector/"), data=required_submission(client, {"front_photo1": (picture(), "front.png")}), headers={"X-CSRFToken": token})
        assert response.status_code == 409
        reference.return_value.update.assert_not_called()




@pytest.mark.parametrize("portal", ["admin", "inspector"])
@pytest.mark.parametrize("action", ["admin-photos"])
def test_admin_cannot_modify_inspections(client, portal, action):
    headers = csrf_headers(client)
    url = UPLOAD_PATH.replace("/api/inspector/", f"/api/{portal}/").replace("/admin-photos", f"/{action}")
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        assert client.post(url, headers=headers).status_code == 403
        reference.assert_not_called()
        upload.assert_not_called()


def test_mutation_controls_are_only_on_inspector_page(client, inspector_client):
    html = inspector_client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    for control in ("openAdminPhotoForm", "adminPhotoForm"):
        assert f'id="{control}"' in html
    assert 'id="approveInspection"' not in html
    with client.session_transaction() as session:
        session.update(uid="test-admin", role="admin")
    html = client.get("/admin/vehicle-inspections").get_data(as_text=True)
    for control in ("openAdminPhotoForm", "adminPhotoForm", "approveInspection"):
        assert f'id="{control}"' not in html


@pytest.mark.parametrize("role", ["admin", "inspector"])
@pytest.mark.parametrize("portal", ["admin", "inspector"])
def test_approval_is_unavailable(client, role, portal):
    with client.session_transaction() as session:
        session.update(uid="test-user", role=role)
    url = UPLOAD_PATH.replace("/api/inspector/", f"/api/{portal}/").replace("/admin-photos", "/approve")
    with patch.object(routes.db, "reference") as reference:
        assert client.post(url, headers=csrf_headers(client)).status_code == 404
        reference.assert_not_called()


def inspection_video():
    # Minimal MP4 container header; actual decoding is checked by Cloudinary.
    return BytesIO(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42")


@pytest.mark.parametrize("with_pictures", [False, True])
def test_inspector_uploads_overall_video_and_preserves_existing_media(inspector_client, nested_submission, with_pictures):
    original = copy.deepcopy(nested_submission)
    files = {"overall_video": (inspection_video(), "walkthrough.mp4")}
    if with_pictures:
        files.update({f"{side}_photo{number}": (picture(), "photo.png")
                      for side, count in routes.PHOTO_COUNTS.items() for number in range(1, count + 1)})
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as photo, patch.object(routes, "upload_admin_video") as video:
        reference.return_value.get.return_value = nested_submission
        reference.return_value.transaction.side_effect = lambda callback: callback(copy.deepcopy(nested_submission))
        photo.return_value = {"url": "https://example.test/new.png", "publicId": "photo/new"}
        video.return_value = {"url": "https://example.test/walkthrough.mp4", "publicId": "video/new", "duration": 12}
        response = inspector_client.post(UPLOAD_PATH, data=files, headers=csrf_headers(inspector_client))
        if not with_pictures:
            assert response.status_code == 400
            assert len(response.json["missing"]) == 14
            photo.assert_not_called()
            video.assert_not_called()
            reference.return_value.transaction.assert_not_called()
            return
        assert response.status_code == 200
        assert response.json["uploaded"] == 15
        assert photo.call_count == (14 if with_pictures else 0)
        video.assert_called_once()
        saved = response.json["inspection"]
        assert saved["adminVideo"]["url"] == "https://example.test/walkthrough.mp4"
        assert saved["adminVideo"]["uploadedBy"] == "test-inspector"
        assert saved["photos"] == original["photos"]
        if not with_pictures:
            assert saved["adminPhotos"] == original["adminPhotos"]
        assert nested_submission == original


@pytest.mark.parametrize("field", ["front_photo3", "back_photo3", "left_photo5", "right_photo5", "inside_photo3"])
def test_extra_photo_slots_are_rejected(inspector_client, field):
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as upload:
        response = inspector_client.post(UPLOAD_PATH, data={field: (picture(), "extra.png")}, headers=csrf_headers(inspector_client))
        assert response.status_code == 400
        reference.assert_not_called()
        upload.assert_not_called()


@pytest.mark.parametrize("case", ["not-video", "empty", "oversize", "duplicate"])
def test_invalid_video_rejected_before_any_upload(inspector_client, case):
    files = {"overall_video": (inspection_video(), "walkthrough.mp4")}
    if case == "not-video":
        files = {"overall_video": (picture(), "fake.mp4")}
    elif case == "empty":
        files = {"overall_video": (BytesIO(), "empty.mp4")}
    elif case == "duplicate":
        files = MultiDict([("overall_video", (inspection_video(), "one.mp4")), ("overall_video", (inspection_video(), "two.mp4"))])
    with patch.object(routes, "MAX_VIDEO_BYTES", 10 if case == "oversize" else routes.MAX_VIDEO_BYTES), patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_video") as upload:
        response = inspector_client.post(UPLOAD_PATH, data=files, headers=csrf_headers(inspector_client))
        assert response.status_code == 400
        reference.assert_not_called()
        upload.assert_not_called()


def test_cloudinary_video_helper_requires_video_track():
    with patch.object(routes.requests, "post") as post:
        post.return_value.json.return_value = {"secure_url": "https://example.test/video.mp4", "public_id": "inspection/video", "resource_type": "video", "width": 1280, "height": 720, "duration": 12}
        assert routes.upload_admin_video(b"video", "MP4", "inspection/folder")["duration"] == 12
        assert post.call_args.args[0].endswith("/video/upload")
        assert post.call_args.kwargs["files"]["file"][2] == "video/mp4"
        post.return_value.json.return_value = {"secure_url": "https://example.test/audio.mp4", "public_id": "audio", "resource_type": "video"}
        with pytest.raises(RuntimeError):
            routes.upload_admin_video(b"audio", "MP4", "inspection/folder")


def test_video_upload_failure_preserves_record(inspector_client, nested_submission):
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_video") as upload, patch.object(routes, "upload_admin_photo") as photo:
        reference.return_value.get.return_value = nested_submission
        photo.return_value = {"url": "https://example.test/photo.png", "publicId": "photo"}
        upload.side_effect = RuntimeError("synthetic video failure")
        response = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, {"overall_video": (inspection_video(), "walkthrough.mp4")}), headers=csrf_headers(inspector_client))
        assert response.status_code == 502
        reference.return_value.transaction.assert_not_called()
        reference.return_value.update.assert_not_called()
        assert "synthetic video failure" not in response.get_data(as_text=True)


def test_upload_form_has_exact_media_slots(inspector_client):
    html = inspector_client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    names = re.findall(r'<input type="file"[^>]*name="([^"]+)"', html)
    expected = {f"{side}_photo{number}" for side, count in routes.PHOTO_COUNTS.items() for number in range(1, count + 1)} | {"overall_video"}
    assert len(names) == 15
    assert set(names) == expected
    assert 'id="approveInspection"' not in html


VIDEO_PATH = UPLOAD_PATH.replace("/admin-photos", "/video-upload")


@pytest.mark.parametrize("size,expected", [(1024 ** 3, 200), (1024 ** 3 + 1, 400), (0, 400), (-1, 400), (True, 400)])
def test_video_upload_accepts_up_to_one_gb(inspector_client, nested_submission, size, expected):
    assert routes.MAX_VIDEO_BYTES == 1024 ** 3
    with patch.object(routes.db, "reference") as reference:
        reference.return_value.get.return_value = nested_submission
        response = inspector_client.post(VIDEO_PATH, json={"size": size, "format": "MP4"}, headers=csrf_headers(inspector_client))
        assert response.status_code == expected
        if expected == 200:
            assert response.json["chunkSize"] == 8 * 1024 * 1024
        reference.return_value.transaction.assert_not_called()


def test_legacy_video_preparation_does_not_read_a_gigabyte():
    from werkzeug.datastructures import FileStorage
    stream = Mock()
    stream.tell.return_value = 1024 ** 3
    stream.read.return_value = inspection_video().getvalue()
    file = FileStorage(stream=stream, filename="large.mp4")
    prepared = routes.prepare_admin_photos(MultiDict([("overall_video", file)]))
    assert prepared[0][2] is stream
    stream.read.assert_called_once_with(4096)


def test_video_stream_uses_contiguous_chunks_and_one_upload_id():
    result = {"secure_url": "https://example.test/video.mp4", "public_id": "inspection/video", "resource_type": "video", "width": 1280, "height": 720}
    with patch.object(routes, "VIDEO_CHUNK_BYTES", 10), patch.object(routes.requests, "post") as post:
        post.return_value.json.side_effect = [{"done": False}, {"done": False}, result]
        assert routes.upload_admin_video(BytesIO(b"x" * 25), "MP4", "inspection/folder")["url"] == result["secure_url"]
        calls = post.call_args_list
        assert [call.kwargs["headers"]["Content-Range"] for call in calls] == ["bytes 0-9/25", "bytes 10-19/25", "bytes 20-24/25"]
        assert len({call.kwargs["headers"]["X-Unique-Upload-Id"] for call in calls}) == 1
        assert len({call.kwargs["data"]["public_id"] for call in calls}) == 1
        assert [len(call.kwargs["files"]["file"][1]) for call in calls] == [10, 10, 5]


def test_chunked_video_is_saved_only_after_completion(inspector_client, nested_submission):
    content = inspection_video().getvalue()
    headers = csrf_headers(inspector_client)
    with patch.object(routes, "VIDEO_CHUNK_BYTES", 16), patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_video_chunk") as upload, patch.object(routes, "upload_admin_photo") as photo:
        reference.return_value.get.return_value = nested_submission
        photo.return_value = {"url": "https://example.test/new.png", "publicId": "photo"}
        reference.return_value.transaction.side_effect = lambda callback: callback(copy.deepcopy(nested_submission))
        started = inspector_client.post(VIDEO_PATH, json={"size": len(content), "format": "MP4"}, headers=headers)
        token = started.json["token"]
        # An unfinished upload cannot be attached to the inspection.
        assert inspector_client.post(UPLOAD_PATH, data={"overall_video_token": token}, headers=headers).status_code == 400
        reference.return_value.transaction.assert_not_called()
        upload.return_value = {"done": False}
        first = inspector_client.post(VIDEO_PATH + "/chunk", data={"token": token, "chunk": (BytesIO(content[:16]), "part.mp4")}, headers=headers)
        assert first.status_code == 200
        assert first.json["done"] is False
        reference.return_value.transaction.assert_not_called()
        upload.return_value = {"secure_url": "https://example.test/video.mp4", "public_id": "inspection/video", "resource_type": "video", "width": 1280, "height": 720}
        last = inspector_client.post(VIDEO_PATH + "/chunk", data={"token": first.json["token"], "chunk": (BytesIO(content[16:]), "part.mp4")}, headers=headers)
        assert last.status_code == 200
        assert last.json["done"] is True
        reference.return_value.transaction.assert_not_called()
        saved = inspector_client.post(UPLOAD_PATH, data=required_submission(inspector_client, {"overall_video_token": last.json["videoToken"]}), headers=headers)
        assert saved.status_code == 200
        assert saved.json["uploaded"] == 15
        assert saved.json["inspection"]["adminVideo"]["url"] == "https://example.test/video.mp4"
        assert saved.json["inspection"]["photos"] == nested_submission["photos"]
        assert len(saved.json["inspection"]["photoPairs"]) == 14
        assert upload.call_args_list[0].args[5:] == (0, len(content))
        assert upload.call_args_list[1].args[5:] == (16, len(content))


@pytest.mark.parametrize("case", ["tampered", "wrong-user", "wrong-record", "wrong-size", "bad-video", "sealed"])
def test_chunk_validation_prevents_upload(inspector_client, nested_submission, case):
    content = inspection_video().getvalue()
    headers = csrf_headers(inspector_client)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_video_chunk") as upload:
        reference.return_value.get.return_value = nested_submission
        started = inspector_client.post(VIDEO_PATH, json={"size": len(content), "format": "MP4"}, headers=headers)
        token = started.json["token"]
        url = VIDEO_PATH + "/chunk"
        if case == "tampered":
            token += "invalid"
        elif case == "wrong-user":
            with inspector_client.session_transaction() as session:
                session["uid"] = "another-inspector"
        elif case == "wrong-record":
            url = url.replace("driver-one", "driver-two")
        elif case == "wrong-size":
            content = content[:-1]
        elif case == "bad-video":
            content = b"x" * len(content)
        elif case == "sealed":
            reference.return_value.get.return_value = {**nested_submission, "approved": True}
        response = inspector_client.post(url, data={"token": token, "chunk": (BytesIO(content), "part.mp4")}, headers=headers)
        assert response.status_code == (409 if case == "sealed" else 400)
        upload.assert_not_called()
        reference.return_value.transaction.assert_not_called()


@pytest.mark.parametrize("suffix", ["", "/chunk"])
def test_video_chunk_endpoints_require_csrf_and_inspector_role(client, inspector_client, nested_submission, suffix):
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_video_chunk") as upload:
        assert inspector_client.post(VIDEO_PATH + suffix, data={"token": "invalid"}).status_code == 400
        reference.assert_not_called()
        with client.session_transaction() as session:
            session.update(uid="test-admin", role="admin")
        assert client.post(VIDEO_PATH + suffix, data={"token": "invalid"}, headers=csrf_headers(client)).status_code == 403
        reference.assert_not_called()
        upload.assert_not_called()


def test_video_chunk_cloud_failure_does_not_change_inspection(inspector_client, nested_submission):
    content = inspection_video().getvalue()
    headers = csrf_headers(inspector_client)
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_video_chunk") as upload:
        reference.return_value.get.return_value = nested_submission
        started = inspector_client.post(VIDEO_PATH, json={"size": len(content), "format": "MP4"}, headers=headers)
        upload.side_effect = RuntimeError("synthetic failure")
        response = inspector_client.post(VIDEO_PATH + "/chunk", data={"token": started.json["token"], "chunk": (BytesIO(content), "part.mp4")}, headers=headers)
        assert response.status_code == 502
        assert "synthetic failure" not in response.get_data(as_text=True)
        reference.return_value.transaction.assert_not_called()


@pytest.mark.parametrize("missing", [f"{side}_photo{number}" for side, count in routes.PHOTO_COUNTS.items() for number in range(1, count + 1)] + ["overall_video_token"])
def test_every_picture_and_video_is_mandatory(inspector_client, nested_submission, missing):
    files = required_submission(inspector_client)
    del files[missing]
    # Saved files do not excuse a missing upload in a new mandatory submission.
    nested_submission["adminPhotos"] = {side: {f"photo{number}": {"url": "https://example.test/existing.png"}
        for number in range(1, count + 1)} for side, count in routes.PHOTO_COUNTS.items()}
    nested_submission["adminVideo"] = {"url": "https://example.test/existing.mp4"}
    with patch.object(routes.db, "reference") as reference, patch.object(routes, "upload_admin_photo") as photo, patch.object(routes, "upload_admin_video") as video:
        reference.return_value.get.return_value = nested_submission
        response = inspector_client.post(UPLOAD_PATH, data=files, headers=csrf_headers(inspector_client))
        assert response.status_code == 400
        assert response.json["missing"] == (["overall_video"] if missing == "overall_video_token" else [missing])
        photo.assert_not_called()
        video.assert_not_called()
        reference.return_value.transaction.assert_not_called()
        reference.return_value.update.assert_not_called()


def test_all_upload_inputs_are_required(inspector_client):
    html = inspector_client.get("/inspector/vehicle-inspections").get_data(as_text=True)
    inputs = re.findall(r'<input type="file"[^>]*>', html)
    assert len(inputs) == 15
    assert all(re.search(r"\brequired\b", input_tag) for input_tag in inputs)
    assert "Optional" not in html
    assert "All 14 pictures and the overall inspection video are required" in html
