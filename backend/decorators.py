# /OLStar/backend/decorators.py
from functools import wraps
from flask import session, redirect, url_for, abort, current_app, flash, request
from firebase_admin import auth

def login_required(f):
    """Ensure the user is logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "uid" not in session:
            flash("Please log in to access this page.", "info")
            return redirect(url_for("pages.login_page"))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    """Ensure the user is an admin (or demo account for demo pages)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = session.get("uid")
        if not uid:
            flash("Please log in to access this page.", "info")
            return redirect(url_for("pages.login_page"))

        # Check role in session
        role = session.get("role")
        
        # Allow demo accounts to access demo pages
        if role == "demo":
            # Check if this is a demo route
            request_path = request.path if hasattr(request, 'path') else ''
            if '/demo/' in request_path:
                return f(*args, **kwargs)
            else:
                flash("Demo accounts can only access demo pages.", "warning")
                return redirect(url_for("pages.demo_page"))
        
        # Regular admin check
        if role != "admin":
            flash("You need administrator privileges to access this page.", "warning")
            return redirect(url_for("pages.login_page"))

        return f(*args, **kwargs)
    return decorated

def demo_account_required(f):
    """Ensure the user is a demo account."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = session.get("uid")
        if not uid:
            flash("Please log in to access this page.", "info")
            return redirect(url_for("pages.demo_page"))

        # Check role in session
        role = session.get("role")
        if role != "demo":
            flash("This page is only accessible to demo accounts.", "warning")
            return redirect(url_for("pages.admin_dashboard"))

        return f(*args, **kwargs)
    return decorated

def superadmin_required(f):
    """Ensure the user is a superadmin (admin role + specific emails)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = session.get("uid")
        if not uid:
            flash("Please log in to access this page.", "info")
            return redirect(url_for("pages.login_page"))

        # Check role in session first
        role = session.get("role")
        if role != "admin":
            flash("You need top administrator privileges to access this page.", "warning")
            return redirect(url_for("pages.admin_dashboard"))

        # Get user email from session or fetch from Firebase
        email = session.get("email")
        
        # If email not in session, fetch it from Firebase Auth
        if not email:
            try:
                user = auth.get_user(uid)
                email = user.email
                # Store in session for future requests
                session["email"] = email
            except Exception as e:
                current_app.logger.error(f"Error fetching user email: {e}")
                flash("Unable to verify your credentials. Please try again.", "error")
                return redirect(url_for("pages.admin_dashboard"))

        # Define superadmin emails
        superadmin_emails = [
            "zyacodesservices@gmail.com",
            "olstaropc@gmail.com",
            "far.ana@gmail.com",
        ]

        # Check if user's email is in superadmin list
        if email not in superadmin_emails:
            flash("This area is restricted to superadmins only.", "warning")
            return redirect(url_for("pages.admin_dashboard"))

        return f(*args, **kwargs)
    return decorated

def superadmin_required_with_config(superadmin_emails=None):
    """
    Factory function to create superadmin decorator with custom email list.
    
    Args:
        superadmin_emails: List of email addresses that have superadmin access
                          If None, uses default list from app config
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            uid = session.get("uid")
            if not uid:
                flash("Please log in to access this page.", "info")
                return redirect(url_for("pages.login_page"))

            # Check role in session first
            role = session.get("role")
            if role != "admin":
                flash("You need administrator privileges to access this page.", "warning")
                return redirect(url_for("pages.admin_dashboard"))

            # Get user email from session or fetch from Firebase
            email = session.get("email")
            
            if not email:
                try:
                    user = auth.get_user(uid)
                    email = user.email
                    session["email"] = email
                except Exception as e:
                    current_app.logger.error(f"Error fetching user email: {e}")
                    flash("Unable to verify your credentials. Please try again.", "error")
                    return redirect(url_for("pages.admin_dashboard"))

            # Determine which email list to use
            emails_to_check = superadmin_emails
            if emails_to_check is None:
                # Try to get from app config
                emails_to_check = current_app.config.get('SUPERADMIN_EMAILS', [])
            
            # If no emails configured, deny access
            if not emails_to_check:
                current_app.logger.warning("No superadmin emails configured")
                flash("Superadmin access is not configured properly.", "error")
                return redirect(url_for("pages.admin_dashboard"))

            # Check if user's email is in superadmin list
            if email not in emails_to_check:
                flash("This area is restricted to superadmins only.", "warning")
                return redirect(url_for("pages.admin_dashboard"))

            return f(*args, **kwargs)
        return decorated
    return decorator