# /OLStar/backend/decorators.py
from functools import wraps
from flask import session, redirect, url_for, abort

def login_required(f):
    """Ensure the user is logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "uid" not in session:
            return redirect(url_for("pages.login_page"))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    """Ensure the user is an admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = session.get("uid")
        if not uid:
            return redirect(url_for("pages.login_page"))

        # Check role in session first
        role = session.get("role")
        if role != "admin":
            abort(403)

        return f(*args, **kwargs)
    return decorated
