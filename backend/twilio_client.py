import math
import requests
from datetime import datetime, timedelta, timezone

API_KEY = "e36f3f-e8d272"
BASE_URL = "https://aviation-edge.com/v2/public/flights"

# --- RPLC Coordinates (Clark International Airport) ---
RPLC_COORDS = (15.1860, 120.5600)

def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_flight_data(flight_number):
    params = {"key": API_KEY, "flightIata": flight_number}
    response = requests.get(BASE_URL, params=params)
    
    if response.status_code != 200:
        raise Exception(f"API request failed with status code {response.status_code}")
    
    data = response.json()
    if not data:
        raise Exception("No live data available for this flight number.")
    
    flight = data[0]

    # Safe access
    geography = flight.get("geography")
    speed = flight.get("speed")
    arrival = flight.get("arrival")

    if not geography or not speed:
        raise Exception("Flight hasn't departed yet or live data unavailable.")
    
    # If arrival coordinates missing, set to NAIA
    if arrival is None or arrival.get("latitude") is None or arrival.get("longitude") is None:
        arrival = {"latitude": RPLC_COORDS[0], "longitude": RPLC_COORDS[1]}
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
    eta_local = eta_utc + timedelta(hours=8)  # Philippines
    eta_local = eta_local + timedelta(minutes=5) # Additional buffer

    return distance_km, eta_hours, eta_local

if __name__ == "__main__":
    flight_number = input("Enter flight number (e.g., PR510): ").strip().upper()
    
    try:
        flight = get_flight_data(flight_number)
        distance, eta_hours, eta_local = calculate_eta(flight)

        print(f"Distance to destination: {distance:.2f} km")
        print(f"Estimated time remaining: {eta_hours*60:.2f} minutes")
        print(f"ETA (UTC+8, NAIA): {eta_local.strftime('%Y-%m-%d %H:%M:%S')}")

    except Exception as e:
        print("Error:", e)
