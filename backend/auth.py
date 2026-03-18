# /OLStar/backend/auth.py
import os
import requests
from flask import Blueprint, request, jsonify, session, make_response
from firebase_admin import auth, db
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import timedelta

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

        resp_data = resp.json()
        uid = resp_data.get("localId")
        id_token = resp_data.get("idToken")
        
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

        # Get user's firstName and lastName from Firebase Realtime Database
        user_ref = db.reference(f"/users/{uid}")
        user_data = user_ref.get() or {}
        
        first_name = user_data.get("firstName", "")
        last_name = user_data.get("lastName", "")
        
        # Construct full name from firstName and lastName
        if first_name and last_name:
            full_name = f"{first_name} {last_name}".strip()
        elif first_name:
            full_name = first_name
        elif last_name:
            full_name = last_name
        else:
            # Fallback to email prefix if no name found in database
            email_prefix = email.split('@')[0]
            full_name = ' '.join(word.capitalize() for word in email_prefix.replace('.', ' ').replace('_', ' ').split())
        
        print(f"Login - User data from DB: first_name={first_name}, last_name={last_name}, full_name={full_name}")
        
        # Clear existing session
        session.clear()
        
        # Set session with user data including firstName and lastName
        session.permanent = True
        session.permanent_session_lifetime = timedelta(days=7)
        session["uid"] = uid
        session["email"] = email
        session["role"] = "admin"
        session["first_name"] = first_name
        session["last_name"] = last_name
        session["full_name"] = full_name
        session["id_token"] = id_token

        # Create response
        response = make_response(jsonify({
            "status": "success", 
            "redirect": "/admin/dashboard",
            "user": {
                "email": email,
                "firstName": first_name,
                "lastName": last_name,
                "fullName": full_name,
                "uid": uid
            }
        }))

        # Set HTTP-only cookie for user email (used by schedules_api)
        response.set_cookie(
            "user_email",
            email,
            max_age=60*60*24*7,  # 7 days
            httponly=True,        # Prevents JavaScript access (more secure)
            secure=True,          # Only send over HTTPS (set to False for local development)
            samesite="Lax",
            path="/"              # Available on all routes
        )
        
        # Set HTTP-only cookie with user's full name (for history tracking in schedules_api)
        response.set_cookie(
            "user_full_name",
            full_name,
            max_age=60*60*24*7,
            httponly=True,        # HTTP-only for security
            secure=True,          # Set to False for local development
            samesite="Lax",
            path="/"
        )
        
        # Set HTTP-only cookies for firstName and lastName
        response.set_cookie(
            "user_first_name",
            first_name,
            max_age=60*60*24*7,
            httponly=True,
            secure=True,          # Set to False for local development
            samesite="Lax",
            path="/"
        )
        
        response.set_cookie(
            "user_last_name",
            last_name,
            max_age=60*60*24*7,
            httponly=True,
            secure=True,          # Set to False for local development
            samesite="Lax",
            path="/"
        )
        
        # Set non-HTTP-only cookie for frontend display
        response.set_cookie(
            "user_display_name",
            full_name,
            max_age=60*60*24*7,
            httponly=False,       # Allow JavaScript to read this
            secure=True,          # Set to False for local development
            samesite="Lax",
            path="/"
        )

        print(f"Cookies set - user_email: {email}, user_full_name: {full_name}, user_first_name: {first_name}, user_last_name: {last_name}")
        
        return response

    except requests.exceptions.RequestException as e:
        print(f"Request error during login: {e}")
        return jsonify({"error": "Login failed"}), 500
    except Exception as e:
        print(f"Unexpected error during login: {e}")
        return jsonify({"error": "Login failed"}), 500


@auth_bp.route("/logout", methods=["POST"])
def admin_logout():
    try:
        # Clear session
        session.clear()
        
        # Create response
        response = make_response(jsonify({"status": "success"}))
        
        # Clear all cookies
        response.set_cookie("user_email", "", expires=0, path="/")
        response.set_cookie("user_full_name", "", expires=0, path="/")
        response.set_cookie("user_display_name", "", expires=0, path="/")
        response.set_cookie("user_first_name", "", expires=0, path="/")
        response.set_cookie("user_last_name", "", expires=0, path="/")
        response.set_cookie("session", "", expires=0, path="/")
        
        return response
    except Exception as e:
        print(f"Error during logout: {e}")
        return jsonify({"error": "Logout failed"}), 500


@auth_bp.route("/current-user", methods=["GET"])
def get_current_user():
    """Get the currently logged in user with firstName and lastName"""
    try:
        # Check session first
        uid = session.get("uid")
        email = session.get("email")
        first_name = session.get("first_name", "")
        last_name = session.get("last_name", "")
        full_name = session.get("full_name", "")
        
        print(f"Current user from session - first_name: {first_name}, last_name: {last_name}, full_name: {full_name}")
        
        # If not in session, check cookies
        if not email:
            email = request.cookies.get("user_email")
            full_name = request.cookies.get("user_full_name")
            first_name = request.cookies.get("user_first_name", "")
            last_name = request.cookies.get("user_last_name", "")
            print(f"Current user from cookies - first_name: {first_name}, last_name: {last_name}, full_name: {full_name}")
        
        if not email:
            return jsonify({
                "success": False,
                "authenticated": False
            }), 401
        
        # If we have uid but no names, try to fetch from Firebase
        if uid and (not first_name or not last_name):
            try:
                user_ref = db.reference(f"/users/{uid}")
                user_data = user_ref.get() or {}
                first_name = user_data.get("firstName", first_name)
                last_name = user_data.get("lastName", last_name)
                
                # Reconstruct full name
                if first_name and last_name:
                    full_name = f"{first_name} {last_name}".strip()
                elif first_name:
                    full_name = first_name
                elif last_name:
                    full_name = last_name
                    
                print(f"Fetched from Firebase - first_name: {first_name}, last_name: {last_name}")
            except Exception as e:
                print(f"Error fetching user data: {e}")
        
        # If we still don't have full name, construct from what we have
        if not full_name:
            if first_name and last_name:
                full_name = f"{first_name} {last_name}".strip()
            elif first_name:
                full_name = first_name
            elif last_name:
                full_name = last_name
            else:
                # Ultimate fallback to email prefix
                email_prefix = email.split('@')[0]
                full_name = ' '.join(word.capitalize() for word in email_prefix.replace('.', ' ').replace('_', ' ').split())
        
        return jsonify({
            "success": True,
            "authenticated": True,
            "user": {
                "email": email,
                "firstName": first_name,
                "lastName": last_name,
                "fullName": full_name,
                "uid": uid
            }
        })
        
    except Exception as e:
        print(f"Error getting current user: {e}")
        return jsonify({
            "success": False,
            "authenticated": False
        }), 500