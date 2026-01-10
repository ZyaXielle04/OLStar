# /backend/app.py
import os
from flask import Flask, request
from dotenv import load_dotenv
from flask_wtf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from firebase_admin import credentials, initialize_app, _apps, db
from datetime import timedelta

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
# CSRF Configuration (IMPORTANT)
# -----------------------
app.config.update(
    WTF_CSRF_CHECK_DEFAULT=False,     # We'll validate manually for APIs
    WTF_CSRF_TIME_LIMIT=None,         # Prevent token expiration issues
)

csrf = CSRFProtect(app)

# -----------------------
# Rate Limiting
# -----------------------
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100 per hour"]
)
limiter.init_app(app)

# -----------------------
# Firebase Admin SDK initialization
# -----------------------
cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
db_url = os.getenv("FIREBASE_DATABASE_URL")

if not cred_path or not os.path.isfile(cred_path):
    raise RuntimeError("Invalid or missing GOOGLE_APPLICATION_CREDENTIALS")
if not db_url:
    raise RuntimeError("FIREBASE_DATABASE_URL must be set")

if not _apps:
    cred = credentials.Certificate(cred_path)
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
# Health check (optional)
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
    app.run(
        debug=(FLASK_ENV == "development"),
        host="0.0.0.0",
        port=5000
    )
