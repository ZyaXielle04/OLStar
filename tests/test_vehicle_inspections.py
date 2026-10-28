"""Inspection page/API checks using synthetic data and a mocked Firebase client."""

import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from flask import Flask


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
    app.config.update(TESTING=True, SECRET_KEY="inspection-test-secret")
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
