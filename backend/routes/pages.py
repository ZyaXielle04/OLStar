#/OLStar/backend/pages.py
from flask import Blueprint, render_template, redirect, url_for, session
from decorators import login_required, admin_required

pages_bp = Blueprint("pages", __name__)

@pages_bp.route("/")
def login_page():
    return render_template("index.html")

@pages_bp.route("/admin/dashboard")
@login_required
@admin_required
def admin_dashboard():
    return render_template("dashboard.html")

@pages_bp.route("/admin/users")
@login_required
@admin_required
def admin_users():
    return render_template("users.html")

@pages_bp.route("/admin/operations/schedules")
@login_required
@admin_required
def bookings_schedules():
    return render_template("operations_schedules.html")

@pages_bp.route("/admin/operations/track-drivers")
@login_required
@admin_required
def bookings_track_drivers():
    return render_template("operations_track_drivers.html")

@pages_bp.route("/admin/operations/transactions")
@login_required
@admin_required
def bookings_transactions():
    return render_template("operations_transactions.html")

@pages_bp.route("/admin/settings")
@login_required
@admin_required
def admin_settings():
    return render_template("settings.html")

@pages_bp.route("/admin/transport_units")
@login_required
@admin_required
def admin_transport_units():
    return render_template("transport_units.html")

@pages_bp.route("/admin/logout")
@login_required
def admin_logout():
    session.clear()
    return redirect(url_for("pages.login_page"))