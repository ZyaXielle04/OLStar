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

        bookings_ref = db.reference("schedules")
        all_bookings = bookings_ref.get() or {}

        # Current date in server timezone
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
# CALENDAR SCHEDULES - WITH CLIENTNAME
# ----------------------
@admin_dashboard_api.route("/api/admin/calendar/schedules", methods=["GET"])
@admin_required
def get_calendar_schedules():
    try:
        # Get all schedules
        schedules_ref = db.reference("schedules")
        schedules = schedules_ref.get() or {}
        
        print(f"Found {len(schedules)} schedules in database")
        
        # Optional: Get users for additional info if needed
        users_ref = db.reference("users")
        users = users_ref.get() or {}

        schedules_list = []
        for sid, schedule in schedules.items():
            # Debug: print first few schedules to see structure
            if len(schedules_list) < 3:
                print(f"Schedule {sid} data:", schedule)
            
            # Create schedule object with all fields including clientName
            schedule_data = {
                "id": sid,
                "date": schedule.get("date"),
                "time": schedule.get("time"),
                "flightNumber": schedule.get("flightNumber"),
                "luggage": schedule.get("luggage", "0"),
                "note": schedule.get("note", schedule.get("notes", "")),
                "pax": schedule.get("pax", "1"),
                "pickup": schedule.get("pickup", schedule.get("pickupLocation")),
                "plateNumber": schedule.get("plateNumber"),
                "status": schedule.get("status", "Pending"),
                "transactionID": schedule.get("transactionID"),
                "transportUnit": schedule.get("transportUnit"),
                "tripType": schedule.get("tripType"),
                "unitType": schedule.get("unitType"),
                "amount": schedule.get("amount"),
                "driverId": schedule.get("driverId"),
                "passengerId": schedule.get("passengerId"),
                "dropoffLocation": schedule.get("dropoffLocation"),
                "endTime": schedule.get("endTime"),
                # Add clientName explicitly
                "clientName": schedule.get("clientName", schedule.get("passengerName", "")),
                "passengerName": schedule.get("passengerName", schedule.get("clientName", ""))
            }
            
            # If clientName is in a nested object or different path, handle it
            if not schedule_data["clientName"] and schedule.get("client"):
                if isinstance(schedule.get("client"), dict):
                    schedule_data["clientName"] = schedule["client"].get("name", "")
                else:
                    schedule_data["clientName"] = schedule.get("client", "")
            
            schedules_list.append(schedule_data)

        # Sort by date and time
        schedules_list.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))

        print(f"Returning {len(schedules_list)} schedules with clientName")
        
        return jsonify({
            "schedules": schedules_list,
            "count": len(schedules_list)
        })
        
    except Exception as e:
        print("Error fetching calendar schedules:", e)
        return jsonify({"error": str(e)}), 500