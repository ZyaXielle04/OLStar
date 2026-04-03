from flask import Blueprint, jsonify, request
from firebase_admin import db
from decorators import admin_required
from datetime import datetime, timedelta
import logging
from functools import wraps
import time
import traceback

admin_dashboard_api = Blueprint("admin_dashboard_api", __name__)

# =======================
# CACHING SYSTEM
# =======================
class DashboardCache:
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.default_ttl = 10  # 10 seconds default cache
    
    def get(self, key):
        """Get cached data if not expired"""
        if key in self.cache and key in self.cache_time:
            age = (datetime.now() - self.cache_time[key]).total_seconds()
            ttl = self.cache.get(f"{key}_ttl", self.default_ttl)
            if age < ttl:
                return self.cache[key]
        return None
    
    def set(self, key, value, ttl=10):
        """Cache data with TTL in seconds"""
        self.cache[key] = value
        self.cache_time[key] = datetime.now()
        self.cache[f"{key}_ttl"] = ttl
    
    def clear(self, pattern=None):
        """Clear cache optionally by pattern"""
        if pattern:
            keys_to_delete = [k for k in self.cache.keys() if pattern in k]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.cache_time.pop(key, None)
        else:
            self.cache.clear()
            self.cache_time.clear()

# Initialize cache
dashboard_cache = DashboardCache()

# =======================
# RATE LIMITING
# =======================
class RateLimiter:
    def __init__(self, max_requests=30, time_window=60):
        self.max_requests = max_requests
        self.time_window = time_window
        self.requests = {}
    
    def is_allowed(self, user_id):
        """Check if user is within rate limit"""
        now = time.time()
        if user_id not in self.requests:
            self.requests[user_id] = []
        
        # Clean old requests
        self.requests[user_id] = [req_time for req_time in self.requests[user_id] 
                                   if now - req_time < self.time_window]
        
        if len(self.requests[user_id]) >= self.max_requests:
            return False
        
        self.requests[user_id].append(now)
        return True

rate_limiter = RateLimiter(max_requests=30, time_window=60)

def rate_limit(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get user ID from request
        user_id = request.headers.get('X-User-ID', request.remote_addr)
        if not rate_limiter.is_allowed(user_id):
            return jsonify({"error": "Rate limit exceeded. Please wait before making more requests."}), 429
        return f(*args, **kwargs)
    return decorated_function

# =======================
# OPTIMIZED DASHBOARD ENDPOINT
# =======================
@admin_dashboard_api.route("/api/admin/dashboard-data", methods=["GET"])
@admin_required
@rate_limit
def get_dashboard_data():
    """Single optimized endpoint for all dashboard data"""
    try:
        # Check cache first
        cache_key = f"dashboard_{request.args.get('include_requests', 'false')}_{request.args.get('include_drivers', 'false')}"
        cached_data = dashboard_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        # Get total users count
        users_ref = db.reference("users")
        users_snapshot = users_ref.get()
        total_users = len(users_snapshot) if users_snapshot else 0
        
        # Get active sessions count
        active_sessions = 0
        if users_snapshot:
            for uid, user in users_snapshot.items():
                if user and user.get("active") == True:
                    active_sessions += 1
        
        # Get today's bookings count
        today = datetime.now().date()
        today_str = today.strftime("%Y-%m-%d")
        schedules_ref = db.reference("schedules")
        all_schedules = schedules_ref.get()
        
        bookings_today = 0
        if all_schedules:
            for sid, schedule in all_schedules.items():
                if schedule and schedule.get("date") == today_str:
                    bookings_today += 1
        
        # Get drivers online count
        drivers_online = 0
        drivers_list = []
        
        if users_snapshot:
            for uid, user in users_snapshot.items():
                if user and user.get("role") == "driver":
                    if user.get("currentLocation") and user.get("status") == "Online":
                        drivers_online += 1
                        # Only collect driver data if requested
                        if request.args.get('include_drivers') == 'true':
                            drivers_list.append({
                                "uid": uid,
                                "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip(),
                                "latitude": user.get("currentLocation", {}).get("latitude"),
                                "longitude": user.get("currentLocation", {}).get("longitude"),
                                "status": user.get("status", "Offline"),
                                "vehicle": user.get("vehicleType", "N/A")
                            })
        
        # Get pending requests count
        requests_ref = db.reference("requests")
        all_requests = requests_ref.get()
        
        pending_requests = 0
        if all_requests:
            for rid, req in all_requests.items():
                if req and req.get("status") == "pending":
                    pending_requests += 1
        
        # Get recent requests (paginated)
        recent_requests = []
        if request.args.get('include_requests') == 'true':
            limit = min(int(request.args.get('limit', 10)), 50)
            
            if all_requests:
                # Convert to list and sort by timestamp
                requests_list = []
                for rid, req in all_requests.items():
                    if req:
                        requests_list.append({
                            "id": rid,
                            "req": req
                        })
                
                # Sort by timestamp descending
                requests_list.sort(key=lambda x: x["req"].get("timestamp", 0), reverse=True)
                
                # Take only the limit
                for item in requests_list[:limit]:
                    req = item["req"]
                    uid = req.get("requestedBy")
                    
                    # Get user name if available
                    user_name = "Unknown"
                    if uid and users_snapshot and uid in users_snapshot:
                        user = users_snapshot[uid]
                        user_name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                        if not user_name:
                            user_name = "Unknown"
                    
                    recent_requests.append({
                        "id": item["id"],
                        "amount": req.get("amount", 0),
                        "gcashUrl": req.get("gcashUrl", ""),
                        "mileageURL": req.get("mileageURL", ""),
                        "receiptUrl": req.get("receiptUrl", ""),
                        "requestedBy": uid,
                        "requestedByName": user_name,
                        "status": req.get("status", "pending"),
                        "timestamp": req.get("timestamp")
                    })
        
        response_data = {
            "totalUsers": total_users,
            "activeSessions": active_sessions,
            "bookingsToday": bookings_today,
            "driversOnline": drivers_online,
            "pendingRequests": pending_requests,
            "drivers": drivers_list if request.args.get('include_drivers') == 'true' else [],
            "recentRequests": recent_requests if request.args.get('include_requests') == 'true' else [],
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache the response (5 seconds TTL)
        dashboard_cache.set(cache_key, response_data, ttl=5)
        return jsonify(response_data)
        
    except Exception as e:
        logging.error(f"Error fetching dashboard data: {e}")
        logging.error(traceback.format_exc())
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500

# =======================
# OPTIMIZED CALENDAR SCHEDULES
# =======================
@admin_dashboard_api.route("/api/admin/calendar/schedules", methods=["GET"])
@admin_required
@rate_limit
def get_calendar_schedules():
    """Optimized calendar endpoint with date range filtering"""
    try:
        # Parse date range parameters
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        limit = min(int(request.args.get('limit', 100)), 200)
        
        # Check cache for the same query
        cache_key = f"calendar_{start_date}_{end_date}_{limit}"
        cached_data = dashboard_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        schedules_ref = db.reference("schedules")
        all_schedules = schedules_ref.get()
        
        if not all_schedules:
            response = {"schedules": [], "count": 0}
            dashboard_cache.set(cache_key, response, ttl=30)
            return jsonify(response)
        
        # Parse dates for filtering
        today = datetime.now().date()
        if start_date and end_date:
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            # Default: last 30 days to next 60 days
            start_date_obj = today - timedelta(days=30)
            end_date_obj = today + timedelta(days=60)
        
        # Filter and transform schedules
        schedules_list = []
        for sid, schedule in all_schedules.items():
            if not schedule:
                continue
            
            # Filter by date range
            schedule_date_str = schedule.get("date")
            if not schedule_date_str:
                continue
                
            try:
                schedule_date = datetime.strptime(schedule_date_str, "%Y-%m-%d").date()
                if schedule_date < start_date_obj or schedule_date > end_date_obj:
                    continue
            except:
                continue
            
            # Extract only the fields needed for calendar display
            schedule_data = {
                "id": sid,
                "date": schedule.get("date"),
                "time": schedule.get("time"),
                "clientName": schedule.get("clientName") or schedule.get("passengerName") or "",
                "flightNumber": schedule.get("flightNumber", ""),
                "pax": schedule.get("pax", "1"),
                "luggage": schedule.get("luggage", "0"),
                "pickup": schedule.get("pickup") or schedule.get("pickupLocation") or "",
                "unitType": schedule.get("unitType", "Vehicle"),
                "transportUnit": schedule.get("transportUnit", ""),
                "plateNumber": schedule.get("plateNumber", ""),
                "status": schedule.get("status", "Pending"),
                "tripType": schedule.get("tripType", ""),
                "transactionID": schedule.get("transactionID", ""),
                "note": schedule.get("note") or schedule.get("notes") or "",
                "amount": schedule.get("amount", 0),
                "driverId": schedule.get("driverId", ""),
                "passengerId": schedule.get("passengerId", "")
            }
            schedules_list.append(schedule_data)
            
            # Apply limit
            if len(schedules_list) >= limit:
                break
        
        # Sort by date and time
        schedules_list.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
        
        response = {
            "schedules": schedules_list,
            "count": len(schedules_list)
        }
        
        # Cache for 30 seconds
        dashboard_cache.set(cache_key, response, ttl=30)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching calendar schedules: {e}")
        logging.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

# =======================
# LEGACY ENDPOINTS (for backward compatibility)
# =======================
@admin_dashboard_api.route("/api/admin/dashboard", methods=["GET"])
@admin_required
def dashboard_metrics_deprecated():
    """Deprecated: Use /api/admin/dashboard-data instead"""
    return get_dashboard_data()

@admin_dashboard_api.route("/api/admin/requests", methods=["GET"])
@admin_required
def get_requests_deprecated():
    """Deprecated: Use /api/admin/dashboard-data?include_requests=true instead"""
    return get_dashboard_data()

@admin_dashboard_api.route("/api/admin/drivers", methods=["GET"])
@admin_required
def drivers_online_deprecated():
    """Deprecated: Use /api/admin/dashboard-data?include_drivers=true instead"""
    return get_dashboard_data()

# =======================
# ADMIN CLEAR CACHE (optional)
# =======================
@admin_dashboard_api.route("/api/admin/clear-cache", methods=["POST"])
@admin_required
def clear_cache():
    """Manually clear the dashboard cache"""
    dashboard_cache.clear()
    return jsonify({"message": "Cache cleared successfully"})