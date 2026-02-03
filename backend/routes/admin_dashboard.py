# backend/routes/admin_dashboard.py
from flask import Blueprint, jsonify
from firebase_admin import db
from decorators import admin_required
from datetime import datetime, timedelta

admin_dashboard_api = Blueprint("admin_dashboard_api", __name__)

# ----------------------
# DASHBOARD METRICS
# ----------------------
@admin_dashboard_api.route("/api/admin/dashboard", methods=["GET"])
@admin_required
def dashboard_metrics():
    try:
        users_ref = db.reference("users")
        users = users_ref.get() or {}

        requests_ref = db.reference("requests")
        requests = requests_ref.get() or {}

        bookings_ref = db.reference("schedules")  # <-- updated to match your schedules node
        all_bookings = bookings_ref.get() or {}

        # Current date in server timezone
        from datetime import datetime
        today = datetime.now().date()

        # Count bookings where date matches today
        bookings_today = [
            b for b in all_bookings.values()
            if "date" in b and datetime.strptime(b["date"], "%Y-%m-%d").date() == today
        ]

        drivers_online = sum(
            1 for u in users.values() if u.get("role") == "driver" and u.get("currentLocation")
        )

        pending_requests = sum(
            1 for r in requests.values() if r.get("status") == "pending"
        )

        active_sessions = sum(1 for u in users.values() if u.get("active"))

        return jsonify({
            "totalUsers": len(users),
            "activeSessions": active_sessions,
            "bookingsToday": len(bookings_today),
            "driversOnline": drivers_online,
            "pendingRequests": pending_requests
        })
    except Exception as e:
        print("Error fetching dashboard metrics:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------
# GET TRANSACTION REQUESTS
# ----------------------
@admin_dashboard_api.route("/api/admin/requests", methods=["GET"])
@admin_required
def get_requests():
    try:
        requests_ref = db.reference("requests")
        requests = requests_ref.get() or {}

        users_ref = db.reference("users")
        users = users_ref.get() or {}

        requests_list = []
        for rid, r in requests.items():
            uid = r.get("requestedBy")
            user = users.get(uid, {})
            name = f"{user.get('firstName','')} {user.get('lastName','')}".strip()
            requests_list.append({
                "id": rid,
                "amount": r.get("amount"),
                "gcashUrl": r.get("gcashUrl"),
                "mileageURL": r.get("mileageURL"),
                "receiptUrl": r.get("receiptUrl"),
                "requestedBy": uid,
                "requestedByName": name or "Unknown",
                "status": r.get("status"),
                "timestamp": r.get("timestamp")
            })

        requests_list.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return jsonify({"requests": requests_list})
    except Exception as e:
        print("Error fetching requests:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------
# DRIVERS ONLINE (for mini map)
# ----------------------
@admin_dashboard_api.route("/api/admin/drivers", methods=["GET"])
@admin_required
def drivers_online():
    try:
        users_ref = db.reference("users")
        users = users_ref.get() or {}

        drivers = []
        for uid, u in users.items():
            if u.get("role") != "driver":
                continue
            loc = u.get("currentLocation")
            if loc:
                drivers.append({
                    "uid": uid,
                    "name": f"{u.get('firstName','')} {u.get('lastName','')}".strip(),
                    "latitude": loc.get("latitude"),
                    "longitude": loc.get("longitude"),
                    "status": u.get("status", "Offline")
                })

        return jsonify({"drivers": drivers})
    except Exception as e:
        print("Error fetching drivers:", e)
        return jsonify({"error": str(e)}), 500

# ----------------------
# DASHBOARD CHARTS
# ----------------------
@admin_dashboard_api.route("/api/admin/dashboard/charts", methods=["GET"])
@admin_required
def dashboard_charts():
    try:
        schedules_ref = db.reference("schedules")
        requests_ref = db.reference("requests")

        schedules = schedules_ref.get() or {}
        requests = requests_ref.get() or {}

        bookings_data = []
        requests_data = []

        today = datetime.now()

        # Last 7 days
        for i in range(7, 0, -1):
            day = today - timedelta(days=i)
            day_start = datetime.combine(day, datetime.min.time())
            day_end = datetime.combine(day, datetime.max.time())

            day_str = day.strftime("%Y-%m-%d")

            # Count bookings for this day
            bookings_count = sum(
                1 for s in schedules.values() if s.get("date") == day_str
            )

            # Count requests for this day based on timestamp
            requests_count = 0
            for r in requests.values():
                ts = r.get("timestamp")
                if not ts:
                    continue
                # If timestamp is in milliseconds, divide by 1000
                if ts > 1e12:  # likely ms
                    ts_dt = datetime.fromtimestamp(ts / 1000)
                else:
                    ts_dt = datetime.fromtimestamp(ts)
                if day_start <= ts_dt <= day_end:
                    requests_count += 1

            bookings_data.append({"date": day_str, "count": bookings_count})
            requests_data.append({"date": day_str, "count": requests_count})

        return jsonify({
            "bookings": bookings_data,
            "requests": requests_data
        })

    except Exception as e:
        print("Error fetching chart data:", e)
        return jsonify({"error": str(e)}), 500
