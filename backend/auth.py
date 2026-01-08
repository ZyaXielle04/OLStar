# /OLStar/backend/auth.py
import os
import requests
from flask import Blueprint, request, jsonify, session
from firebase_admin import auth, db
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Blueprint
auth_bp = Blueprint("auth", __name__, url_prefix="/admin")

# Local limiter for auth routes
limiter = Limiter(key_func=get_remote_address)

FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY")
SIGNIN_URL = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"

@auth_bp.route("/login", methods=["POST"])
@limiter.limit("5 per minute")
def admin_login():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "Login failed"}), 400

    try:
        # Firebase sign-in
        resp = requests.post(
            SIGNIN_URL,
            json={
                "email": email,
                "password": password,
                "returnSecureToken": True
            },
            timeout=10
        )

        if resp.status_code != 200:
            return jsonify({"error": "Login failed"}), 401

        uid = resp.json().get("localId")
        if not uid:
            return jsonify({"error": "Login failed"}), 401

        # Email verified
        user = auth.get_user(uid)
        if not user.email_verified:
            return jsonify({"error": "Login failed"}), 403

        # Admin role check
        role = db.reference(f"/users/{uid}/role").get()
        if role != "admin":
            return jsonify({"error": "Login failed"}), 403

        # Session
        session.clear()
        session.permanent = True
        session["uid"] = uid
        session["email"] = email
        session["role"] = "admin"

        return jsonify({"status": "success", "redirect": "/admin/dashboard"})

    except Exception:
        return jsonify({"error": "Login failed"}), 500
