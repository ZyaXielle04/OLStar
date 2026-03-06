import os
import time
import tempfile
from flask import Blueprint, request, jsonify, send_file
from message_template import build_message
from decorators import admin_required
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

schedules_api = Blueprint("schedules_api", __name__)

EDITABLE_FIELDS = {
    "date", "time", "clientName", "contactNumber",
    "pickup", "dropOff", "pax", "flightNumber", "note",
    "unitType", "amount", "driverRate", "company",
    "bookingType", "transportUnit", "color",
    "plateNumber", "luggage", "tripType"
}

def normalize_phone(number: str) -> str:
    """
    Convert "63-9171234567" → "+639171234567"
    """
    if not number:
        return ""

    number = number.strip()

    if "-" in number:
        country, rest = number.split("-", 1)
        return f"+{country}{rest}"

    if number.startswith("+"):
        return number

    return f"+{number}"


# ---------------- FLIGHTAWARE SCREENSHOT ----------------
@admin_required
@schedules_api.route("/api/flightaware/screenshot/<flight_number>", methods=["GET"])
def get_flightaware_screenshot(flight_number):
    """
    Capture a screenshot of FlightAware for the given flight number
    """
    temp_file = None
    driver = None
    
    try:
        # Clean flight number
        flight_number = flight_number.replace(" ", "").upper()
        
        # Set up Chrome options for headless browsing
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")  # Run in headless mode
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        
        # Initialize the driver
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Navigate to FlightAware
        url = f"https://www.flightaware.com/live/flight/{flight_number}"
        driver.get(url)
        
        # Wait for the page to load
        wait = WebDriverWait(driver, 15)
        
        # Wait for flight status card to appear
        try:
            # Try to wait for the flight status card
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".flightPageCard")))
        except:
            # If not found, try alternative selectors
            try:
                wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='flightPageCard']")))
            except:
                # Wait a bit more and continue anyway
                time.sleep(3)
        
        # Additional wait for any dynamic content
        time.sleep(2)
        
        # Take screenshot
        temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        driver.save_screenshot(temp_file.name)
        temp_file.close()
        
        # Return the screenshot
        return send_file(
            temp_file.name,
            mimetype='image/png',
            as_attachment=True,
            download_name=f'flight_{flight_number}.png'
        )
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    finally:
        # Clean up
        if driver:
            driver.quit()
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except:
                pass


# ---------------- CREATE ----------------
@admin_required
@schedules_api.route("/api/schedules", methods=["POST"])
def create_schedule():
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    if isinstance(data, dict):
        data = [data]

    saved_ids = []

    try:
        for item in data:
            transaction_id = item.get("transactionID")
            if not transaction_id:
                return jsonify({"error": "transactionID is required"}), 400

            item["status"] = item.get("status", "Pending")

            ref = db.reference(f"schedules/{transaction_id}")
            ref.set(item)

            saved_ids.append(transaction_id)

        return jsonify({
            "success": True,
            "transactionIDs": saved_ids
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- READ ----------------
@admin_required
@schedules_api.route("/api/schedules", methods=["GET"])
def get_schedules():
    from firebase_admin import db
    try:
        ref = db.reference("schedules")
        data = ref.get() or {}

        schedules = []
        for transaction_id, schedule in data.items():
            schedule["transactionID"] = transaction_id
            current = schedule.get("current") or {}
            schedule["current"] = {
                "driverName": current.get("driverName", ""),
                "cellPhone": current.get("cellPhone", "")
            }
            schedules.append(schedule)

        return jsonify({"success": True, "schedules": schedules}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- UPDATE ----------------
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>", methods=["PATCH", "PUT"])
def update_schedule(transaction_id):
    from firebase_admin import db

    data = request.get_json() or {}

    ref = db.reference(f"schedules/{transaction_id}")
    existing = ref.get()
    if not existing:
        return jsonify({"error": "Schedule not found"}), 404

    # Handle driver assignment ONLY here
    if "current" in data:
        current = data.get("current") or {}
        ref.child("current").update({
            "driverName": current.get("driverName", ""),
            "cellPhone": current.get("cellPhone", "")
        })

    # Allow-list update only
    updates = {
        k: v for k, v in data.items()
        if k in EDITABLE_FIELDS
    }

    if updates:
        ref.update(updates)

    return jsonify({
        "success": True,
        "transactionID": transaction_id
    }), 200


# ---------------- DELETE ----------------
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>", methods=["DELETE"])
def delete_schedule(transaction_id):
    from firebase_admin import db

    try:
        ref = db.reference(f"schedules/{transaction_id}")
        if not ref.get():
            return jsonify({"error": "Schedule not found"}), 404

        ref.delete()
        return jsonify({"success": True, "transactionID": transaction_id}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- TRANSPORT UNITS ----------------
@admin_required
@schedules_api.route("/api/transportUnits", methods=["GET"])
def get_transport_units():
    """
    Fetch all transport units from Firebase Realtime Database
    """
    from firebase_admin import db

    try:
        ref = db.reference("transportUnits")
        data = ref.get() or {}

        # Convert to list
        transport_units = []
        for key, unit in data.items():
            transport_units.append({
                "transportUnit": unit.get("transportUnit", ""),
                "unitType": unit.get("unitType", ""),
                "color": unit.get("color", ""),
                "plateNumber": unit.get("plateNumber", "")
            })

        return jsonify({"success": True, "transportUnits": transport_units}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500