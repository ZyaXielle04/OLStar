import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Blueprint, render_template, redirect, url_for, session
from decorators import login_required, admin_required, superadmin_required
from dotenv import load_dotenv

load_dotenv()

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

@pages_bp.route("/admin/transport_units")
@login_required
@admin_required
def admin_transport_units():
    return render_template("transport_units.html")

@pages_bp.route("/admin/schedules")
@login_required
@admin_required
def bookings_schedules():
    return render_template("schedules.html")

@pages_bp.route("/admin/track-drivers")
@login_required
@admin_required
def bookings_track_drivers():
    google_maps_api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    return render_template(
        "track_drivers.html",
        GOOGLE_MAPS_API_KEY=google_maps_api_key
    )

@pages_bp.route("/admin/transactions/gas")
@login_required
@superadmin_required
def gas_transactions():
    """Gas Transactions"""
    return render_template("transactions_gas.html")

@pages_bp.route("/admin/transactions/rfid")
@login_required
@superadmin_required  # Since it has the superadmin badge
def rfid_transactions():
    """RFID Balance Management page - Superadmin only"""
    return render_template("transactions_rfid.html")

@pages_bp.route("/admin/transactions/maintenance")
@login_required
@superadmin_required
def maintenance_transactions():
    """Maintenance Transactions - Superadmin only"""
    return render_template("transactions_maintenance.html")

@pages_bp.route("/admin/transactions/gl-overview")
@login_required
@superadmin_required
def gl_overview():
    """General Ledger Overview - Superadmin only"""
    return render_template("gl_overview.html")

@pages_bp.route("/admin/transactions/gl-admin-salary")
@login_required
@superadmin_required
def gl_admin_salary():
    """Admin Salary - Superadmin only"""
    return render_template("gl_admin_salary.html")

@pages_bp.route("/admin/transactions/gl-drivers-salary")
@login_required
@superadmin_required
def gl_drivers_salary():
    """Drivers Salary - Superadmin only"""
    return render_template("gl_drivers_salary.html")

@pages_bp.route("/admin/transactions/gl-advances")
@login_required
@superadmin_required
def gl_advances():
    """Advances - Superadmin only"""
    return render_template("gl_advances.html")

@pages_bp.route("/admin/transactions/gl-deductions")
@login_required
@superadmin_required
def gl_deductions():
    """Deductions - Superadmin only"""
    return render_template("gl_deductions.html")

@pages_bp.route("/admin/settings")
@login_required
@admin_required
def admin_settings():
    return render_template("settings.html")

@pages_bp.route("/admin/logout")
@login_required
def admin_logout():
    session.clear()
    return redirect(url_for("pages.login_page"))