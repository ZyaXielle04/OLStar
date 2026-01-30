import os
from flask import Flask, request
from dotenv import load_dotenv
from flask_wtf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from firebase_admin import credentials, initialize_app, _apps
from datetime import timedelta
import tempfile
import json

# -----------------------
# Load environment variables
# -----------------------
load_dotenv()
FLASK_ENV = os.getenv("FLASK_ENV", "development")

# -----------------------
# Create Flask app
# -----------------------
app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "../templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "../static")
)

# -----------------------
# Secret key (REQUIRED)
# -----------------------
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY")
if not app.config["SECRET_KEY"]:
    raise RuntimeError("FLASK_SECRET_KEY must be set in environment")

# -----------------------
# Session & cookie security
# -----------------------
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(FLASK_ENV == "production"),
    PERMANENT_SESSION_LIFETIME=timedelta(hours=1),
)

# -----------------------
# CSRF Configuration
# -----------------------
app.config.update(
    WTF_CSRF_CHECK_DEFAULT=False,  # Disable CSRF globally for APIs
    WTF_CSRF_TIME_LIMIT=None
)
csrf = CSRFProtect(app)

# -----------------------
# Firebase Admin SDK initialization
# -----------------------
db_url = os.getenv("FIREBASE_DATABASE_URL")
firebase_json_env = os.getenv("FIREBASE_ADMIN_JSON")
firebase_file_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")  # local dev

if not db_url:
    raise RuntimeError("FIREBASE_DATABASE_URL must be set")

import os
import json
from firebase_admin import credentials, initialize_app, _apps

db_url = os.getenv("FIREBASE_DATABASE_URL")
firebase_json_env = os.getenv("FIREBASE_ADMIN_JSON")

if not _apps:
    if os.getenv("FLASK_ENV") == "production":
        if not firebase_json_env:
            raise RuntimeError("FIREBASE_ADMIN_JSON must be set in production")
        # Load JSON directly from environment
        cred = credentials.Certificate(json.loads(firebase_json_env))
    else:
        # Local dev: use JSON file
        firebase_file_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not firebase_file_env or not os.path.isfile(firebase_file_env):
            raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS must be a valid file path")
        cred = credentials.Certificate(firebase_file_env)

    initialize_app(cred, {"databaseURL": db_url})

# -----------------------
# Import Blueprints
# -----------------------
from auth import auth_bp, limiter as auth_limiter
from routes.pages import pages_bp
from routes.admin_users import admin_users_api
from routes.schedules import schedules_api

auth_limiter.init_app(app)

# -----------------------
# Register Blueprints
# -----------------------
app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(admin_users_api)
app.register_blueprint(schedules_api)

# -----------------------
# Inject CSRF token cookie for JS
# -----------------------
@app.after_request
def set_csrf_cookie(response):
    from flask_wtf.csrf import generate_csrf
    response.set_cookie(
        "XSRF-TOKEN",
        generate_csrf(),
        secure=(FLASK_ENV == "production"),
        samesite="Lax",
        httponly=False
    )
    return response

# -----------------------
# Example route for WhatsApp messages
# -----------------------
@app.route("/api/receive-message", methods=["POST"])
def receive_message():
    from_number = request.form.get("From")
    body = request.form.get("Body")

    print("Inbound WhatsApp message from:", from_number)
    print("Body:", body)

    # Example reply (needs your Twilio client configured)
    # client.messages.create(
    #     from_=TWILIO_WHATSAPP_NUMBER,
    #     to=from_number,
    #     body="Thanks! Your driver is on the way 🚖"
    # )

    return "OK", 200

# -----------------------
# Health check
# -----------------------
@app.route("/health")
def health():
    return {"status": "ok"}, 200

# -----------------------
# Error handlers
# -----------------------
@app.errorhandler(404)
def not_found(e):
    return "404 - Not Found", 404

@app.errorhandler(500)
def server_error(e):
    return "500 - Internal Server Error", 500

# -----------------------
# Run Flask app
# -----------------------
if __name__ == "__main__":
    app.run(debug=(FLASK_ENV == "development"), host="0.0.0.0", port=5000)
