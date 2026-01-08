#/OLStar/backend/routes.py
from flask import Blueprint, render_template, redirect, url_for, session
from decorators import login_required, admin_required

# -----------------------
# Pages Blueprint
# -----------------------
pages_bp = Blueprint("pages", __name__)

# -----------------------
# Page routes
# -----------------------
@pages_bp.route("/")
def login_page():
    """Render login page."""
    return render_template("index.html")


@pages_bp.route("/admin/dashboard")
@login_required
@admin_required
def admin_dashboard():
    """Render admin dashboard page."""
    return render_template("dashboard.html")


@pages_bp.route("/admin/users")
@login_required
@admin_required
def admin_users():
    """Render users management page (placeholder)."""
    return render_template("users.html")


@pages_bp.route("/admin/bookings/schedules")
@login_required
@admin_required
def bookings_schedules():
    """Render bookings schedules page (placeholder)."""
    return render_template("bookings_schedules.html")


@pages_bp.route("/admin/bookings/track-drivers")
@login_required
@admin_required
def bookings_track_drivers():
    """Render bookings track drivers page (placeholder)."""
    return render_template("bookings_track_drivers.html")


@pages_bp.route("/admin/bookings/transactions")
@login_required
@admin_required
def bookings_transactions():
    """Render bookings transaction history page (placeholder)."""
    return render_template("bookings_transactions.html")


@pages_bp.route("/admin/settings")
@login_required
@admin_required
def admin_settings():
    """Render settings page (placeholder)."""
    return render_template("settings.html")


@pages_bp.route("/admin/logout")
@login_required
def admin_logout():
    """Clear session and redirect to login."""
    session.clear()
    return redirect(url_for("pages.login_page"))
