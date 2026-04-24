import os
import time
import tempfile
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, send_file, session
from message_template import build_message
from decorators import admin_required
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from functools import wraps
import logging
import requests
import zipfile
import re
from io import BytesIO

schedules_api = Blueprint("schedules_api", __name__)

EDITABLE_FIELDS = {
    "date", "time", "clientName", "contactNumber",
    "pickup", "dropOff", "pax", "flightNumber", "note",
    "unitType", "amount", "driverRate", "company",
    "bookingType", "transportUnit", "color",
    "plateNumber", "luggage", "tripType"
}

# =======================
# CACHING SYSTEM
# =======================
class ScheduleCache:
    def __init__(self):
        self.cache = {}
        self.cache_time = {}
        self.default_ttl = 5  # 5 seconds default cache
    
    def get(self, key):
        """Get cached data if not expired"""
        if key in self.cache and key in self.cache_time:
            age = (datetime.now() - self.cache_time[key]).total_seconds()
            ttl = self.cache.get(f"{key}_ttl", self.default_ttl)
            if age < ttl:
                return self.cache[key]
        return None
    
    def set(self, key, value, ttl=5):
        """Cache data with TTL in seconds"""
        self.cache[key] = value
        self.cache_time[key] = datetime.now()
        self.cache[f"{key}_ttl"] = ttl
    
    def clear(self, pattern=None):
        """Clear cache"""
        if pattern:
            keys_to_delete = [k for k in self.cache.keys() if pattern in k]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.cache_time.pop(key, None)
        else:
            self.cache.clear()
            self.cache_time.clear()

# Initialize cache
schedule_cache = ScheduleCache()

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
        user_id = request.headers.get('X-User-ID', request.remote_addr)
        if not rate_limiter.is_allowed(user_id):
            return jsonify({"error": "Rate limit exceeded"}), 429
        return f(*args, **kwargs)
    return decorated_function

def normalize_phone(number: str) -> str:
    """Convert phone number to standard format"""
    if not number:
        return ""
    number = number.strip()
    if "-" in number:
        country, rest = number.split("-", 1)
        return f"+{country}{rest}"
    if number.startswith("+"):
        return number
    return f"+{number}"

# =======================
# OPTIMIZED: GET TRANSPORT UNITS
# =======================
@admin_required
@schedules_api.route("/api/transportUnits", methods=["GET"])
@rate_limit
def get_transport_units():
    """Fetch all transport units with caching"""
    from firebase_admin import db
    
    try:
        # Check cache
        cached_data = schedule_cache.get("transport_units")
        if cached_data:
            return jsonify(cached_data)
        
        ref = db.reference("transportUnits")
        data = ref.get() or {}
        
        # Convert to list efficiently
        transport_units = []
        for key, unit in data.items():
            if unit:
                transport_units.append({
                    "transportUnit": unit.get("transportUnit", ""),
                    "unitType": unit.get("unitType", ""),
                    "color": unit.get("color", ""),
                    "plateNumber": unit.get("plateNumber", "")
                })
        
        response = {"success": True, "transportUnits": transport_units}
        
        # Cache for 1 hour (transport units rarely change)
        schedule_cache.set("transport_units", response, ttl=3600)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching transport units: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED: GET SCHEDULES
# =======================
@admin_required
@schedules_api.route("/api/schedules", methods=["GET"])
@rate_limit
def get_schedules():
    """Get all schedules with caching"""
    from firebase_admin import db
    
    try:
        # Check cache
        cached_data = schedule_cache.get("all_schedules")
        if cached_data:
            return jsonify(cached_data)
        
        ref = db.reference("schedules")
        data = ref.get() or {}
        
        schedules = []
        for transaction_id, schedule in data.items():
            if not schedule:
                continue
                
            schedule["transactionID"] = transaction_id
            current = schedule.get("current") or {}
            schedule["current"] = {
                "driverName": current.get("driverName", ""),
                "cellPhone": current.get("cellPhone", "")
            }
            if "history" not in schedule:
                schedule["history"] = []
            schedules.append(schedule)
        
        response = {"success": True, "schedules": schedules}
        
        # Cache for 5 seconds (schedules change frequently)
        schedule_cache.set("all_schedules", response, ttl=5)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching schedules: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED: CREATE SCHEDULE
# =======================
@admin_required
@schedules_api.route("/api/schedules", methods=["POST"])
@rate_limit
def create_schedule():
    from firebase_admin import db

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    if isinstance(data, dict):
        data = [data]

    saved_ids = []
    
    # Get user info
    user_email = request.cookies.get("user_email", "system")
    user_full_name = request.cookies.get("user_full_name", "System")
    user_first_name = request.cookies.get("user_first_name", "")
    user_last_name = request.cookies.get("user_last_name", "")
    
    if not user_full_name and user_first_name and user_last_name:
        user_full_name = f"{user_first_name} {user_last_name}".strip()
    elif not user_full_name and user_first_name:
        user_full_name = user_first_name
    else:
        user_full_name = user_full_name or "System"

    try:
        for item in data:
            transaction_id = item.get("transactionID")
            if not transaction_id:
                return jsonify({"error": "transactionID is required"}), 400

            item["status"] = item.get("status", "Pending")
            
            if "history" not in item:
                item["history"] = []
            
            item["history"].append({
                "timestamp": datetime.now().isoformat(),
                "action": "created",
                "user": user_full_name,
                "user_email": user_email,
                "changes": [{"field": "initial", "old": None, "new": "Schedule created"}]
            })

            ref = db.reference(f"schedules/{transaction_id}")
            ref.set(item)
            saved_ids.append(transaction_id)
        
        # Clear cache
        schedule_cache.clear("all_schedules")
        
        return jsonify({"success": True, "transactionIDs": saved_ids}), 200

    except Exception as e:
        logging.error(f"Error creating schedule: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED: UPDATE SCHEDULE
# =======================
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>", methods=["PATCH", "PUT"])
@rate_limit
def update_schedule(transaction_id):
    from firebase_admin import db

    data = request.get_json() or {}
    
    user_email = request.cookies.get("user_email", "unknown")
    user_full_name = request.cookies.get("user_full_name", "Unknown")
    user_first_name = request.cookies.get("user_first_name", "")
    user_last_name = request.cookies.get("user_last_name", "")
    
    if not user_full_name and user_first_name and user_last_name:
        user_full_name = f"{user_first_name} {user_last_name}".strip()
    elif not user_full_name and user_first_name:
        user_full_name = user_first_name
    else:
        user_full_name = user_full_name or "Unknown"

    ref = db.reference(f"schedules/{transaction_id}")
    existing = ref.get()
    if not existing:
        return jsonify({"error": "Schedule not found"}), 404

    changes = []
    
    # Track driver assignment changes
    if "current" in data:
        current = data.get("current") or {}
        old_driver = existing.get("current", {}).get("driverName", "")
        new_driver = current.get("driverName", "")
        old_phone = existing.get("current", {}).get("cellPhone", "")
        new_phone = current.get("cellPhone", "")
        
        if old_driver != new_driver:
            changes.append({"field": "driverName", "old": old_driver, "new": new_driver})
        
        if old_phone != new_phone:
            changes.append({"field": "cellPhone", "old": old_phone, "new": new_phone})
        
        if old_driver and new_driver and old_driver != new_driver:
            changes.append({
                "field": "driver_transfer",
                "old": f"Driver {old_driver}",
                "new": f"Driver {new_driver}",
                "note": "Driver Transfer"
            })
        
        ref.child("current").update({
            "driverName": new_driver,
            "cellPhone": new_phone
        })

    # Track other field changes
    updates = {}
    for k, v in data.items():
        if k in EDITABLE_FIELDS:
            old_val = existing.get(k, "")
            if str(old_val) != str(v):
                changes.append({"field": k, "old": old_val, "new": v})
                updates[k] = v

    if updates:
        ref.update(updates)

    # Save history if there were changes
    if changes:
        history_entry = {
            "timestamp": datetime.now().isoformat(),
            "action": "updated",
            "user": user_full_name,
            "user_email": user_email,
            "changes": changes
        }
        
        history = existing.get("history", [])
        history.append(history_entry)
        ref.child("history").set(history)
    
    # Clear cache
    schedule_cache.clear("all_schedules")
    
    return jsonify({"success": True, "transactionID": transaction_id, "changes": changes}), 200

# =======================
# OPTIMIZED: DELETE SCHEDULE
# =======================
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>", methods=["DELETE"])
@rate_limit
def delete_schedule(transaction_id):
    from firebase_admin import db

    try:
        ref = db.reference(f"schedules/{transaction_id}")
        if not ref.get():
            return jsonify({"error": "Schedule not found"}), 404

        ref.delete()
        
        # Clear cache
        schedule_cache.clear("all_schedules")
        
        return jsonify({"success": True, "transactionID": transaction_id}), 200
    except Exception as e:
        logging.error(f"Error deleting schedule: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# OPTIMIZED: GET SCHEDULE HISTORY
# =======================
@admin_required
@schedules_api.route("/api/schedules/<transaction_id>/history", methods=["GET"])
@rate_limit
def get_schedule_history(transaction_id):
    from firebase_admin import db
    
    try:
        # Check cache for history
        cache_key = f"history_{transaction_id}"
        cached_data = schedule_cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)
        
        ref = db.reference(f"schedules/{transaction_id}")
        schedule = ref.get()
        
        if not schedule:
            return jsonify({"error": "Schedule not found"}), 404
        
        history = schedule.get("history", [])
        
        response = {
            "success": True,
            "transactionID": transaction_id,
            "history": history
        }
        
        # Cache history for 1 minute (history rarely changes)
        schedule_cache.set(cache_key, response, ttl=60)
        return jsonify(response)
        
    except Exception as e:
        logging.error(f"Error fetching history: {e}")
        return jsonify({"error": str(e)}), 500

# =======================
# STRUCTURED DOWNLOAD FOR SCHEDULES - PRODUCTION FIX
# =======================
@admin_required
@schedules_api.route("/api/schedules/download-structured", methods=["POST"])
@rate_limit
def download_structured():
    """Download image and send directly to client browser"""
    try:
        data = request.json
        image_url = data.get('imageUrl')
        date_folder = data.get('dateFolder')  # e.g., "2026-04-12"
        time_folder = data.get('timeFolder')  # e.g., "0030"
        filename = data.get('filename')       # e.g., "flight_1.jpg"
        schedule_id = data.get('scheduleId')
        image_type = data.get('imageType')
        
        if not image_url:
            return jsonify({'success': False, 'error': 'No image URL provided'}), 400
        
        # Fix Cloudinary URLs
        if 'cloudinary.com' in image_url:
            # URL encode spaces
            image_url = image_url.replace(' ', '%20')
        
        # Determine content type
        if image_url.lower().endswith('.png'):
            content_type = 'image/png'
            extension = 'png'
        elif image_url.lower().endswith('.gif'):
            content_type = 'image/gif'
            extension = 'gif'
        else:
            content_type = 'image/jpeg'
            extension = 'jpg'
        
        # Ensure filename has correct extension
        if not filename.endswith(f'.{extension}'):
            base = filename.rsplit('.', 1)[0] if '.' in filename else filename
            filename = f"{base}.{extension}"
        
        # Create folder path for download name (browser will handle folder structure)
        folder_path = f"{date_folder}/{time_folder}"
        full_download_name = f"{folder_path}/{filename}"
        
        # Download image from Cloudinary with proper headers
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        # Use timeout to avoid hanging
        response = requests.get(image_url, headers=headers, timeout=30)
        
        if response.status_code != 200:
            logging.error(f"Failed to download image: HTTP {response.status_code} from {image_url}")
            return jsonify({
                'success': False, 
                'error': f'Failed to download image: HTTP {response.status_code}'
            }), 400
        
        # Get the image data
        image_data = response.content
        
        # Create BytesIO object
        from io import BytesIO
        image_io = BytesIO(image_data)
        
        # Send file directly to client browser
        return send_file(
            image_io,
            mimetype=content_type,
            as_attachment=True,
            download_name=full_download_name
        )
        
    except requests.exceptions.Timeout:
        logging.error("Download timeout")
        return jsonify({'success': False, 'error': 'Download timeout - please try again'}), 408
    except requests.exceptions.ConnectionError as e:
        logging.error(f"Connection error: {str(e)}")
        return jsonify({'success': False, 'error': 'Cannot connect to image server'}), 500
    except Exception as e:
        logging.error(f"Error in download_structured: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# =======================
# FLIGHTAWARE SCREENSHOT (Legacy - kept for compatibility)
# =======================
@admin_required
@schedules_api.route("/api/flightaware/screenshot/<flight_number>", methods=["GET"])
@rate_limit
def get_flightaware_screenshot(flight_number):
    """Capture a screenshot of FlightAware for the given flight number"""
    temp_file = None
    driver = None
    
    try:
        flight_number = flight_number.replace(" ", "").upper()
        
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        url = f"https://www.flightaware.com/live/flight/{flight_number}"
        driver.get(url)
        
        wait = WebDriverWait(driver, 15)
        try:
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".flightPageCard")))
        except:
            time.sleep(3)
        
        temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        driver.save_screenshot(temp_file.name)
        temp_file.close()
        
        return send_file(
            temp_file.name,
            mimetype='image/png',
            as_attachment=True,
            download_name=f'flight_{flight_number}.png'
        )
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
    finally:
        if driver:
            driver.quit()
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except:
                pass

# =======================
# CLEAR CACHE ENDPOINT
# =======================
@admin_required
@schedules_api.route("/api/schedules/clear-cache", methods=["POST"])
@rate_limit
def clear_schedule_cache():
    """Manually clear the schedule cache"""
    schedule_cache.clear()
    return jsonify({"message": "Schedule cache cleared successfully"})

# =======================
# ZIP DOWNLOAD FOR SCHEDULES - PRODUCTION FIX
# =======================
@admin_required
@schedules_api.route("/api/schedules/download-all-zip", methods=["POST"])
@rate_limit
def download_all_as_zip():
    """Download all images for a date as a ZIP file with folder structure"""
    try:
        data = request.json
        date = data.get('date')
        images = data.get('images', [])
        
        if not date:
            return jsonify({'success': False, 'error': 'Date is required'}), 400
        
        if not images:
            return jsonify({'success': False, 'error': 'No images to download'}), 400
        
        logging.info(f"Creating ZIP for date {date} with {len(images)} images")
        
        # Create ZIP in memory
        zip_buffer = BytesIO()
        success_count = 0
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for idx, img in enumerate(images):
                try:
                    # Get schedule info
                    schedule = img.get('schedule', {})
                    time_str = schedule.get('time', '')
                    transaction_id = schedule.get('transactionID', 'unknown')
                    img_type = img.get('type', 'image')
                    img_url = img.get('url', '')
                    
                    if not img_url:
                        logging.warning(f"Skipping image {idx}: No URL")
                        continue
                    
                    # Format time folder (e.g., "10:30 AM" -> "1030")
                    time_folder = format_time_for_folder(time_str)
                    
                    # Create filename and path
                    filename = f"{img_type}_{transaction_id}.jpg"
                    folder_path = f"{date}/{time_folder}"
                    full_path = f"{folder_path}/{filename}"
                    
                    logging.info(f"Downloading {full_path} from {img_url[:100]}...")
                    
                    # Download image from Cloudinary
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                    
                    # Fix URL encoding
                    if 'cloudinary.com' in img_url:
                        img_url = img_url.replace(' ', '%20')
                    
                    response = requests.get(img_url, headers=headers, timeout=30)
                    
                    if response.status_code == 200:
                        # Add to ZIP with folder structure
                        zip_file.writestr(full_path, response.content)
                        success_count += 1
                        logging.info(f"✓ Added {full_path} to ZIP ({success_count}/{len(images)})")
                    else:
                        logging.warning(f"✗ Failed to download {img_url}: HTTP {response.status_code}")
                        
                except requests.exceptions.Timeout:
                    logging.error(f"Timeout downloading image {idx}")
                    continue
                except Exception as e:
                    logging.error(f"Error downloading image {idx}: {str(e)}")
                    continue
        
        zip_buffer.seek(0)
        
        if success_count == 0:
            return jsonify({'success': False, 'error': 'No images could be downloaded'}), 400
        
        logging.info(f"ZIP created successfully with {success_count} images")
        
        # Send ZIP file to client
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f"{date}_schedules_images.zip"
        )
        
    except Exception as e:
        logging.error(f"Error creating ZIP: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# =======================
# HELPER FUNCTION: FORMAT TIME FOR FOLDER
# =======================
def format_time_for_folder(time_str):
    """Convert time like '10:30 AM' to '1030' for folder name"""
    if not time_str:
        return "0000"
    
    # Try to match time pattern like "10:30 AM" or "2:45 PM" or "10:30AM" (no space)
    match = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM)?', time_str.strip(), re.I)
    if not match:
        # If no match, just remove non-digits
        digits = re.sub(r'[^0-9]', '', time_str)
        return digits[:4] if len(digits) >= 4 else digits.ljust(4, '0')
    
    hour = int(match.group(1))
    minute = match.group(2)
    period = match.group(3).upper() if match.group(3) else None
    
    # Convert to 24-hour format if period is provided
    if period:
        if period == 'PM' and hour != 12:
            hour += 12
        if period == 'AM' and hour == 12:
            hour = 0
    
    return f"{hour:02d}{minute}"

# =======================
# HELPER FUNCTION: FORCE REFRESH CACHE (for debugging)
# =======================
@admin_required
@schedules_api.route("/api/schedules/force-refresh", methods=["POST"])
@rate_limit
def force_refresh_cache():
    """Force refresh all caches"""
    schedule_cache.clear()
    return jsonify({"message": "All caches cleared and will refresh on next request"}), 200