# flight_tracker.py
import os
import time
import tempfile
import requests
from flask import Blueprint, request, jsonify, send_file
from decorators import admin_required
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import firebase_admin
from firebase_admin import db
import uuid
from datetime import datetime

flight_tracker = Blueprint("flight_tracker", __name__)

# Cloudinary configuration
CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dekdyp7bb/upload"
CLOUDINARY_UPLOAD_PRESET = "OLStar"

class FlightAwareScreenshot:
    def __init__(self):
        self.driver = None
        
    def find_brave_path(self):
        """Find Brave browser installation path on Windows"""
        try:
            # Common Brave installation paths
            common_paths = [
                r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
                os.path.expanduser(r"~\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe")
            ]
            
            for path in common_paths:
                if os.path.exists(path):
                    print(f"Found Brave at: {path}")
                    return path
            
            # Try registry for Brave
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe")
                path, _ = winreg.QueryValueEx(key, "")
                winreg.CloseKey(key)
                if os.path.exists(path):
                    print(f"Found Brave via registry at: {path}")
                    return path
            except:
                pass
                
        except Exception as e:
            print(f"Error finding Brave: {str(e)}")
        
        return None
        
    def setup_driver(self):
        """Setup Brave driver with appropriate options"""
        chrome_options = Options()
        
        # Essential headless options
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--disable-software-rasterizer")
        chrome_options.add_argument("--window-size=1920,1080")
        
        # Find and set Brave binary path
        brave_path = self.find_brave_path()
        if brave_path:
            chrome_options.binary_location = brave_path
            print(f"Using Brave browser at: {brave_path}")
        else:
            # Try default Chrome as fallback
            chrome_options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            print("Brave not found, trying Chrome as fallback")
        
        # SSL and security options
        chrome_options.add_argument("--ignore-certificate-errors")
        chrome_options.add_argument("--ignore-ssl-errors")
        chrome_options.add_argument("--allow-insecure-localhost")
        
        # Performance options
        chrome_options.add_argument("--disable-logging")
        chrome_options.add_argument("--log-level=3")
        chrome_options.add_argument("--silent")
        
        # Exclude switches that cause errors
        chrome_options.add_experimental_option("excludeSwitches", ["enable-logging"])
        
        try:
            # Try using webdriver-manager
            service = Service(ChromeDriverManager().install())
            service.creation_flags = 0
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            print("Brave/Chrome driver initialized successfully")
        except Exception as e:
            print(f"WebDriver manager failed: {str(e)}")
            try:
                # Fallback to default
                self.driver = webdriver.Chrome(options=chrome_options)
            except Exception as e2:
                print(f"Default Chrome failed: {str(e2)}")
                raise Exception("Could not initialize browser driver")
        
        self.driver.implicitly_wait(10)
        self.driver.set_page_load_timeout(30)
        
    def take_screenshot(self, flight_number):
        """
        Take screenshot of FlightAware page for given flight number
        Returns: path to screenshot file or None if failed
        """
        try:
            if not self.driver:
                self.setup_driver()
            
            # Clean flight number
            flight_number = flight_number.replace(" ", "").upper()
            
            # Construct FlightAware URL
            url = f"https://www.flightaware.com/live/flight/{flight_number}"
            
            print(f"Navigating to: {url}")
            
            # Navigate to page
            self.driver.get(url)
            
            # Wait for page to load
            wait = WebDriverWait(self.driver, 15)
            
            # Try to wait for content to load
            try:
                wait.until(lambda driver: driver.execute_script('return document.readyState') == 'complete')
                time.sleep(3)
            except:
                pass
            
            # Create temporary file
            temp_dir = tempfile.gettempdir()
            screenshot_path = os.path.join(temp_dir, f"flight_{flight_number}_{uuid.uuid4().hex}.png")
            
            # Take screenshot
            self.driver.save_screenshot(screenshot_path)
            print(f"Screenshot saved to: {screenshot_path}")
            
            return screenshot_path
            
        except Exception as e:
            print(f"Error taking screenshot: {str(e)}")
            return None
            
    def cleanup(self):
        """Close the driver"""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
            self.driver = None


def upload_to_cloudinary(file_path, flight_number):
    """
    Upload file to Cloudinary using upload preset
    Returns: public URL of uploaded file
    """
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        with open(file_path, 'rb') as file:
            files = {
                'file': (f"flight_{flight_number}_{timestamp}.png", file, 'image/png')
            }
            
            data = {
                'upload_preset': CLOUDINARY_UPLOAD_PRESET,
                'folder': 'flight_screenshots',
                'public_id': f"flight_{flight_number}_{timestamp}",
                'tags': f"flightaware,{flight_number}"
            }
            
            response = requests.post(CLOUDINARY_URL, files=files, data=data, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            print(f"Uploaded to Cloudinary: {result.get('secure_url')}")
            return result.get("secure_url")
        
    except Exception as e:
        print(f"Error uploading to Cloudinary: {str(e)}")
        return None


@admin_required
@flight_tracker.route("/api/flight/screenshot/<flight_number>", methods=["GET"])
def get_flight_screenshot(flight_number):
    """
    Take screenshot of FlightAware page for a flight number
    Returns: JSON with screenshot URL or error
    """
    tracker = FlightAwareScreenshot()
    
    try:
        screenshot_path = tracker.take_screenshot(flight_number)
        
        if not screenshot_path or not os.path.exists(screenshot_path):
            return jsonify({
                "success": False,
                "error": "Failed to capture screenshot"
            }), 500
            
        public_url = upload_to_cloudinary(screenshot_path, flight_number)
        
        try:
            os.remove(screenshot_path)
        except:
            pass
            
        if public_url:
            return jsonify({
                "success": True,
                "flight_number": flight_number,
                "screenshot_url": public_url
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to upload screenshot to Cloudinary"
            }), 500
            
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
        
    finally:
        tracker.cleanup()


@admin_required
@flight_tracker.route("/api/flight/screenshot/<transaction_id>/<flight_number>", methods=["GET"])
def get_and_save_flight_screenshot(transaction_id, flight_number):
    """
    Take screenshot and save directly to schedule's photoUrl/flightAwareUrl
    """
    tracker = FlightAwareScreenshot()
    
    try:
        screenshot_path = tracker.take_screenshot(flight_number)
        
        if not screenshot_path or not os.path.exists(screenshot_path):
            return jsonify({
                "success": False,
                "error": "Failed to capture screenshot"
            }), 500
            
        public_url = upload_to_cloudinary(screenshot_path, flight_number)
        
        try:
            os.remove(screenshot_path)
        except:
            pass
            
        if public_url:
            try:
                ref = db.reference(f"schedules/{transaction_id}")
                schedule = ref.get()
                
                if schedule:
                    photo_url_ref = ref.child("PhotoUrl")
                    existing_photo_url = photo_url_ref.get() or {}
                    
                    existing_photo_url["flightAwareUrl"] = public_url
                    
                    if "flightScreenshots" not in existing_photo_url:
                        existing_photo_url["flightScreenshots"] = {}
                    
                    screenshot_id = datetime.now().strftime("%Y%m%d_%H%M%S")
                    existing_photo_url["flightScreenshots"][screenshot_id] = {
                        "url": public_url,
                        "timestamp": datetime.now().isoformat(),
                        "flight_number": flight_number
                    }
                    
                    photo_url_ref.set(existing_photo_url)
                    print(f"Saved screenshot URL to schedule {transaction_id}")
                    
            except Exception as e:
                print(f"Error saving to schedule: {str(e)}")
                
            return jsonify({
                "success": True,
                "transaction_id": transaction_id,
                "flight_number": flight_number,
                "screenshot_url": public_url,
                "storage_path": "/photoUrl/flightAwareUrl"
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Failed to upload screenshot to Cloudinary"
            }), 500
            
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
        
    finally:
        tracker.cleanup()