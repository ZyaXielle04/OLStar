import os
import time
import json
from datetime import datetime, timedelta, timezone
import requests
import firebase_admin
from firebase_admin import credentials, db
from dotenv import load_dotenv

load_dotenv()

# ----------------------------
# Config / Environment
# ----------------------------
PH_TZ = timezone(timedelta(hours=8))  # Philippine time
CHECK_INTERVAL_SECONDS = 60  # how often to check schedules

# Firebase setup
db_url = os.getenv("FIREBASE_DATABASE_URL")
firebase_json_env = os.getenv("FIREBASE_ADMIN_JSON")  # prod
firebase_file_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")  # local dev

if not db_url:
    raise RuntimeError("FIREBASE_DATABASE_URL must be set")

if not firebase_admin._apps:
    if firebase_json_env:
        cred_dict = json.loads(firebase_json_env)
        cred = credentials.Certificate(cred_dict)
    elif firebase_file_env and os.path.isfile(firebase_file_env):
        cred = credentials.Certificate(firebase_file_env)
    else:
        raise RuntimeError("Firebase credentials not found")
    firebase_admin.initialize_app(cred, {"databaseURL": db_url})

# ----------------------------
# AviationEdge API Config
# ----------------------------
API_KEY = os.getenv("AVIATIONEDGE_KEY")  # Your API key
BASE_URL = "https://aviation-edge.com/v2/public/flights"

# ----------------------------
# NAIA / Clark default coordinates
# ----------------------------
AIRPORT_COORDS = {
    "RPLL": (14.5086, 121.019),
    "RPLC": (15.1869, 120.5604)
}

# ----------------------------
# Haversine formula
# ----------------------------
import math
def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# ----------------------------
# Flight ETA calculation
# ----------------------------
def get_flight_data(flight_number, airport_icao):
    params = {"key": API_KEY, "flightIata": flight_number}
    response = requests.get(BASE_URL, params=params)
    if response.status_code != 200:
        raise Exception(f"AviationEdge error {response.status_code}")

    data = response.json()
    if not data:
        raise Exception("No live data available")

    flight = data[0]

    # Safe access
    geography = flight.get("geography")
    speed = flight.get("speed")
    arrival = flight.get("arrival")

    if not geography or not speed:
        raise Exception("Flight not yet departed or no live data")

    # If arrival missing, use airport coords
    if arrival is None or arrival.get("latitude") is None or arrival.get("longitude") is None:
        arrival = {"latitude": AIRPORT_COORDS.get(airport_icao, (0, 0))[0],
                   "longitude": AIRPORT_COORDS.get(airport_icao, (0, 0))[1]}
        flight["arrival"] = arrival

    return flight

def calculate_eta(flight):
    lat1 = flight["geography"]["latitude"]
    lon1 = flight["geography"]["longitude"]
    speed_kmh = flight["speed"]["horizontal"]
    lat2 = flight["arrival"]["latitude"]
    lon2 = flight["arrival"]["longitude"]

    distance_km = haversine(lat1, lon1, lat2, lon2)
    eta_hours = distance_km / speed_kmh

    current_utc = datetime.now(timezone.utc)
    eta_utc = current_utc + timedelta(hours=eta_hours)
    eta_local = eta_utc.astimezone(PH_TZ)
    eta_local += timedelta(minutes=5)  # buffer

    return distance_km, eta_hours, eta_local

# ----------------------------
# Helper functions
# ----------------------------
def get_active_schedules():
    ref = db.reference("/schedules")
    all_schedules = ref.get() or {}
    active = []

    today_str = datetime.now(PH_TZ).strftime("%Y-%m-%d")  # YYYY-MM-DD

    for tripId, trip in all_schedules.items():
        # Only Arrival trips, not completed/cancelled, and scheduled for today
        if (
            trip.get("tripType") == "Arrival" and
            trip.get("status") not in ("Completed", "Cancelled") and
            trip.get("date") == today_str
        ):
            trip["tripId"] = tripId
            active.append(trip)
    return active

def get_airport_from_pickup(pickup):
    if "(MNL)" in pickup:
        return "RPLL"
    if "(CRK)" in pickup:
        return "RPLC"
    return None

def parse_trip_time(time_str):
    now = datetime.now(PH_TZ)
    # parse time like "2:30PM" or "12:05AM"
    trip_time = datetime.strptime(time_str, "%I:%M%p")
    return now.replace(hour=trip_time.hour, minute=trip_time.minute, second=0, microsecond=0)


def should_run_eta(trip):
    trip_time = parse_trip_time(trip["time"])
    now = datetime.now(PH_TZ)
    return trip_time - timedelta(hours=1) <= now <= trip_time

def store_eta(trip_id, eta_datetime):
    ref = db.reference(f"/schedules/{trip_id}/ETA")
    ref.set({
        "est": eta_datetime.strftime("%Y-%m-%d %H:%M:%S"),
        "timestamp": int(datetime.utcnow().timestamp() * 1000)  # milliseconds
    })

# ----------------------------
# Scheduler loop
# ----------------------------
def eta_worker_loop():
    print("ETA Worker started")
    while True:
        now = datetime.now(PH_TZ)
        schedules = get_active_schedules()

        for trip in schedules:
            if not should_run_eta(trip):
                continue

            if now.minute % 15 != 0:  # 15-min interval
                continue

            airport = get_airport_from_pickup(trip["pickup"])
            if not airport:
                continue

            try:
                flight = get_flight_data(trip["flightNumber"], airport)
                distance, eta_hours, eta_local = calculate_eta(flight)
                store_eta(trip["tripId"], eta_local)
                print(f"[{now.strftime('%H:%M')}] ETA updated for trip {trip['tripId']}")
            except Exception as e:
                print(f"[{now.strftime('%H:%M')}] Error updating ETA for {trip['tripId']}: {e}")

        time.sleep(CHECK_INTERVAL_SECONDS)

# ----------------------------
# Main entry
# ----------------------------
if __name__ == "__main__":
    eta_worker_loop()
