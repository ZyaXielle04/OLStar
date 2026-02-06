import os
import sys
import json
import tempfile
from datetime import timedelta
from flask import Flask, request
from dotenv import load_dotenv
from flask_wtf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from firebase_admin import credentials, initialize_app, _apps

# -----------------------
# Add /backend and /root to Python path
# -----------------------
sys.path.append(os.path.dirname(__file__))  # /backend
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))  # /root, for /routes

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
firebase_json_env = os.getenv("FIREBASE_ADMIN_JSON")  # production
firebase_file_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")  # local dev

if not db_url:
    raise RuntimeError("FIREBASE_DATABASE_URL must be set")

if not _apps:  # Initialize only if Firebase not already initialized
    if FLASK_ENV == "production":
        if not firebase_json_env:
            raise RuntimeError("FIREBASE_ADMIN_JSON must be set in production")
        # Load JSON directly from environment variable
        try:
            cred_dict = json.loads(firebase_json_env)
            cred = credentials.Certificate(cred_dict)
        except Exception as e:
            raise RuntimeError(f"Failed to load Firebase JSON from env: {e}")
    else:
        # Local dev: load from JSON file
        if not firebase_file_env or not os.path.isfile(firebase_file_env):
            raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS must be a valid file path")
        cred = credentials.Certificate(firebase_file_env)

    initialize_app(cred, {"databaseURL": db_url})

# -----------------------
# Import Blueprints
# -----------------------
try:
    from auth import auth_bp, limiter as auth_limiter
except ModuleNotFoundError:
    raise RuntimeError("auth.py not found in /backend")

try:
    from routes.pages import pages_bp
    from routes.admin_users import admin_users_api
    from routes.schedules import schedules_api
    from routes.admin_requests import admin_requests_api
    from routes.admin_dashboard import admin_dashboard_api
    from backend.routes.admin_transport_units import admin_transport_units
except ModuleNotFoundError:
    raise RuntimeError("routes modules not found in /routes")

# -----------------------
# Initialize Flask-Limiter for auth
# -----------------------
auth_limiter.init_app(app)

# -----------------------
# Register Blueprints
# -----------------------
app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(admin_users_api)
app.register_blueprint(schedules_api)
app.register_blueprint(admin_requests_api)
app.register_blueprint(admin_dashboard_api)
app.register_blueprint(admin_transport_units)

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
