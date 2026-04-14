from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
import datetime
import calendar
from decorators import superadmin_required
import firebase_admin
from firebase_admin import db
import traceback

gl_overview_bp = Blueprint('gl_overview', __name__)

# Helper functions
def get_users_ref():
    return db.reference('users')

def get_admins_ref():
    return db.reference('admins')

def get_schedules_ref():
    return db.reference('schedules')

def get_driver_salary_records_ref():
    return db.reference('driverSalaryRecords')

def get_admin_salary_records_ref():
    return db.reference('salaryRecords')

def get_deductions_ref():
    return db.reference('deductions')

def get_advances_ref():
    return db.reference('advances')

# UPDATED: Gas is from /requests
def get_gas_transactions_ref():
    return db.reference('requests')

# UPDATED: RFID is from /rfidBalanceHistory
def get_rfid_transactions_ref():
    return db.reference('rfidBalanceHistory')

# UPDATED: Maintenance is from /maintenanceRecords
def get_maintenance_records_ref():
    return db.reference('maintenanceRecords')

# UPDATED: Driver net pay is from /driverDTRRecords
def get_driver_dtr_records_ref():
    return db.reference('driverDTRRecords')

def safe_float(value, default=0):
    """Safely convert to float"""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default

def safe_int(value, default=0):
    """Safely convert to int"""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default

def parse_date(date_str):
    """Parse date string to datetime object"""
    if not date_str:
        return None
    try:
        return datetime.datetime.strptime(str(date_str), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None

def epoch_to_date(timestamp_ms):
    """Convert epoch timestamp (milliseconds) to date object"""
    if not timestamp_ms:
        return None
    try:
        return datetime.datetime.fromtimestamp(timestamp_ms / 1000).date()
    except (ValueError, TypeError):
        return None

def parse_iso_date(date_str):
    """Parse ISO format date string"""
    if not date_str:
        return None
    try:
        # Handle format like "2026-04-15T00:07:46.831907"
        return datetime.datetime.fromisoformat(date_str.split('T')[0]).date()
    except (ValueError, TypeError):
        return None

def get_date_range(range_type, start_date=None, end_date=None):
    """Get start and end dates based on range type"""
    today = datetime.datetime.now().date()
    
    if range_type == 'today':
        start = today
        end = today
    elif range_type == 'week':
        start = today - datetime.timedelta(days=today.weekday())
        end = start + datetime.timedelta(days=6)
    elif range_type == 'month':
        start = today.replace(day=1)
        next_month = today.replace(day=28) + datetime.timedelta(days=4)
        end = next_month - datetime.timedelta(days=next_month.day)
    elif range_type == 'quarter':
        quarter = (today.month - 1) // 3 + 1
        start = today.replace(month=3*quarter-2, day=1)
        if quarter == 4:
            end = today.replace(month=12, day=31)
        else:
            end = today.replace(month=3*quarter+1, day=1) - datetime.timedelta(days=1)
    elif range_type == 'year':
        start = today.replace(month=1, day=1)
        end = today.replace(month=12, day=31)
    elif range_type == 'custom' and start_date and end_date:
        start = parse_date(start_date)
        end = parse_date(end_date)
    else:
        start = today.replace(day=1)
        end = today
    
    return start, end

# Get overview summary
@gl_overview_bp.route('/api/gl-overview/summary', methods=['GET'])
@superadmin_required
def get_summary():
    try:
        range_type = request.args.get('range', 'month')
        start_date_str = request.args.get('startDate', '')
        end_date_str = request.args.get('endDate', '')
        
        start_date, end_date = get_date_range(range_type, start_date_str, end_date_str)
        
        if not start_date or not end_date:
            return jsonify({'success': False, 'error': 'Invalid date range'}), 400
        
        print(f"Fetching summary for period: {start_date} to {end_date}")
        
        # Get all data
        schedules = get_schedules_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        advances = get_advances_ref().get() or {}
        deductions = get_deductions_ref().get() or {}
        
        # UPDATED: Get from correct nodes
        gas_requests = get_gas_transactions_ref().get() or {}      # /requests
        rfid_history = get_rfid_transactions_ref().get() or {}     # /rfidBalanceHistory
        maintenance_records = get_maintenance_records_ref().get() or {}  # /maintenanceRecords
        driver_dtr_records = get_driver_dtr_records_ref().get() or {}     # /driverDTRRecords
        
        # Initialize counters
        total_trips = 0
        trip_income = 0
        driver_payout = 0
        admin_salaries_total = 0
        driver_salaries_total = 0
        gas_expenses = 0
        rfid_expenses = 0
        maintenance_expenses = 0
        advances_total = 0
        advances_paid = 0
        advances_outstanding = 0
        pending_advances = 0
        deductions_sss = 0
        deductions_philhealth = 0
        deductions_pagibig = 0
        deductions_tax = 0
        deductions_total = 0
        
        # ========== INCOME: Process completed trips from schedules ==========
        for sched_id, sched in schedules.items():
            if not sched or not isinstance(sched, dict):
                continue
            
            sched_date = parse_date(sched.get('date'))
            if sched.get('status') == 'Completed' and sched_date and start_date <= sched_date <= end_date:
                total_trips += 1
                amount = safe_float(sched.get('amount'))
                driver_rate = safe_float(sched.get('driverRate'))
                trip_income += amount
                driver_payout += driver_rate
        
        # ========== EXPENSE: Gas from /requests (status = 'paid') ==========
        gas_count = 0
        for req_id, req in gas_requests.items():
            if not req or not isinstance(req, dict):
                continue
            
            # Only include paid gas requests
            if req.get('status') != 'paid':
                continue
            
            # Convert epoch timestamp to date
            timestamp_ms = req.get('timestamp')
            req_date = epoch_to_date(timestamp_ms)
            
            if req_date and start_date <= req_date <= end_date:
                gas_expenses += safe_float(req.get('amount'))
                gas_count += 1
        
        print(f"Gas expenses: ₱{gas_expenses:,.2f} from {gas_count} paid requests")
        
        # ========== EXPENSE: RFID from /rfidBalanceHistory ==========
        rfid_count = 0
        for hist_id, hist in rfid_history.items():
            if not hist or not isinstance(hist, dict):
                continue
            
            # Convert epoch timestamp to date
            timestamp_ms = hist.get('timestamp')
            hist_date = epoch_to_date(timestamp_ms)
            
            if hist_date and start_date <= hist_date <= end_date:
                rfid_expenses += safe_float(hist.get('amount'))
                rfid_count += 1
        
        print(f"RFID expenses: ₱{rfid_expenses:,.2f} from {rfid_count} transactions")
        
        # ========== EXPENSE: Maintenance from /maintenanceRecords (status = 'completed') ==========
        maint_count = 0
        for rec_id, rec in maintenance_records.items():
            if not rec or not isinstance(rec, dict):
                continue
            
            # Only include completed maintenance
            if rec.get('status') != 'completed':
                continue
            
            # Parse ISO date string
            created_at = rec.get('createdAt')
            rec_date = parse_iso_date(created_at) if created_at else None
            
            if rec_date and start_date <= rec_date <= end_date:
                maintenance_expenses += safe_float(rec.get('cost'))
                maint_count += 1
        
        print(f"Maintenance expenses: ₱{maintenance_expenses:,.2f} from {maint_count} records")
        
        # ========== EXPENSE: Driver Net Pay from /driverDTRRecords (status = 'paid') ==========
        driver_dtr_count = 0
        for dtr_id, dtr in driver_dtr_records.items():
            if not dtr or not isinstance(dtr, dict):
                continue
            
            # Only include paid DTR records
            if dtr.get('status') != 'paid':
                continue
            
            # Check if cutoff date falls within the period
            cutoff = dtr.get('cutoff', '')
            # Parse cutoff like "March 2026 - 1st Half" or "March 2026 - 2nd Half"
            try:
                if ' - ' in cutoff:
                    month_year_part = cutoff.split(' - ')[0]
                    month_name = month_year_part.split()[0]
                    year = int(month_year_part.split()[1])
                    half = cutoff.split(' - ')[1]
                    
                    months = ['January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December']
                    month_num = months.index(month_name) + 1
                    
                    if '1st Half' in half:
                        cutoff_end_date = datetime.date(year, month_num, 15)
                    else:
                        last_day = calendar.monthrange(year, month_num)[1]
                        cutoff_end_date = datetime.date(year, month_num, last_day)
                    
                    # Include if the cutoff end date is within our period
                    if start_date <= cutoff_end_date <= end_date:
                        driver_salaries_total += safe_float(dtr.get('netTotal'))
                        driver_dtr_count += 1
            except Exception as e:
                print(f"Error parsing cutoff '{cutoff}': {e}")
                # If can't parse, include if created recently
                continue
        
        print(f"Driver salaries (net): ₱{driver_salaries_total:,.2f} from {driver_dtr_count} paid DTR records")
        
        # ========== EXPENSE: Admin Salaries from /salaryRecords (paymentStatus = 'paid') ==========
        admin_count = 0
        for sal_id, sal in admin_salaries.items():
            if not sal or not isinstance(sal, dict):
                continue
            
            if sal.get('paymentStatus') in ['paid', 'processing']:
                admin_salaries_total += safe_float(sal.get('netPay'))
                admin_count += 1
        
        print(f"Admin salaries (net): ₱{admin_salaries_total:,.2f} from {admin_count} paid records")
        
        # ========== Advances (for display only) ==========
        for adv_id, adv in advances.items():
            if not adv or not isinstance(adv, dict):
                continue
            
            amount = safe_float(adv.get('amount'))
            paid = safe_float(adv.get('paidAmount'))
            remaining = safe_float(adv.get('remainingBalance'))
            status = adv.get('status')
            
            advances_total += amount
            advances_paid += paid
            
            if status == 'approved' or status == 'partially-paid':
                advances_outstanding += remaining
            elif status == 'pending':
                pending_advances += 1
        
        # ========== Deductions (for display only) ==========
        for ded_id, ded in deductions.items():
            if not ded or not isinstance(ded, dict):
                continue
            
            amount = safe_float(ded.get('amount'))
            ded_type = ded.get('type')
            status = ded.get('status')
            
            if status == 'applied' or status == 'pending':
                if ded_type == 'sss':
                    deductions_sss += amount
                elif ded_type == 'philhealth':
                    deductions_philhealth += amount
                elif ded_type == 'pagibig':
                    deductions_pagibig += amount
                elif ded_type == 'tax':
                    deductions_tax += amount
                deductions_total += amount
        
        # ========== CALCULATE TOTALS ==========
        operating_expenses = gas_expenses + rfid_expenses + maintenance_expenses
        total_salaries = driver_salaries_total + admin_salaries_total
        total_expenses = total_salaries + operating_expenses
        
        # Calculate profit
        net_profit = trip_income - total_expenses
        
        # Cash flow calculation
        cash_flow = trip_income - driver_payout - total_salaries - operating_expenses
        
        print(f"\n{'='*60}")
        print(f"SUMMARY FOR {start_date} to {end_date}")
        print(f"INCOME: ₱{trip_income:,.2f}")
        print(f"EXPENSES:")
        print(f"  - Driver Salaries (net): ₱{driver_salaries_total:,.2f}")
        print(f"  - Admin Salaries (net): ₱{admin_salaries_total:,.2f}")
        print(f"  - Gas: ₱{gas_expenses:,.2f}")
        print(f"  - RFID: ₱{rfid_expenses:,.2f}")
        print(f"  - Maintenance: ₱{maintenance_expenses:,.2f}")
        print(f"  - Operating Total: ₱{operating_expenses:,.2f}")
        print(f"  - Total Salaries: ₱{total_salaries:,.2f}")
        print(f"  - TOTAL EXPENSES: ₱{total_expenses:,.2f}")
        print(f"NET PROFIT: ₱{net_profit:,.2f}")
        print(f"{'='*60}\n")
        
        summary = {
            'grossIncome': trip_income,
            'totalExpenses': total_expenses,
            'netProfit': net_profit,
            'cashFlow': cash_flow,
            'totalTrips': total_trips,
            'tripIncome': trip_income,
            'driverPayout': driver_payout,
            'tripNetIncome': trip_income - driver_payout,
            'adminSalaries': admin_salaries_total,
            'driverSalaries': driver_salaries_total,
            'totalSalaries': total_salaries,
            'gasExpenses': gas_expenses,
            'rfidExpenses': rfid_expenses,
            'maintenanceExpenses': maintenance_expenses,
            'operatingExpenses': operating_expenses,
            'totalAdvanced': advances_total,
            'advancePaid': advances_paid,
            'advanceOutstanding': advances_outstanding,
            'pendingAdvances': pending_advances,
            'deductionsSSS': deductions_sss,
            'deductionsPhilHealth': deductions_philhealth,
            'deductionsPagIBIG': deductions_pagibig,
            'deductionsTax': deductions_tax,
            'totalDeductions': deductions_total
        }
        
        return jsonify({'success': True, 'data': summary})
        
    except Exception as e:
        print(f"Error in get_summary: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get category totals
@gl_overview_bp.route('/api/gl-overview/categories', methods=['GET'])
@superadmin_required
def get_categories():
    try:
        range_type = request.args.get('range', 'month')
        start_date_str = request.args.get('startDate', '')
        end_date_str = request.args.get('endDate', '')
        
        start_date, end_date = get_date_range(range_type, start_date_str, end_date_str)
        
        # Get from correct nodes
        gas_requests = get_gas_transactions_ref().get() or {}
        rfid_history = get_rfid_transactions_ref().get() or {}
        maintenance_records = get_maintenance_records_ref().get() or {}
        advances = get_advances_ref().get() or {}
        driver_dtr_records = get_driver_dtr_records_ref().get() or {}
        
        gas_total = 0
        gas_count = 0
        rfid_total = 0
        rfid_count = 0
        maintenance_total = 0
        maintenance_count = 0
        active_advances_total = 0
        active_advances_count = 0
        driver_payroll_total = 0
        driver_payroll_count = 0
        
        # Process gas from /requests (paid only)
        for req_id, req in gas_requests.items():
            if req and isinstance(req, dict) and req.get('status') == 'paid':
                timestamp_ms = req.get('timestamp')
                req_date = epoch_to_date(timestamp_ms)
                if req_date and start_date <= req_date <= end_date:
                    gas_total += safe_float(req.get('amount'))
                    gas_count += 1
        
        # Process RFID from /rfidBalanceHistory
        for hist_id, hist in rfid_history.items():
            if hist and isinstance(hist, dict):
                timestamp_ms = hist.get('timestamp')
                hist_date = epoch_to_date(timestamp_ms)
                if hist_date and start_date <= hist_date <= end_date:
                    rfid_total += safe_float(hist.get('amount'))
                    rfid_count += 1
        
        # Process maintenance from /maintenanceRecords (completed only)
        for rec_id, rec in maintenance_records.items():
            if rec and isinstance(rec, dict) and rec.get('status') == 'completed':
                created_at = rec.get('createdAt')
                rec_date = parse_iso_date(created_at) if created_at else None
                if rec_date and start_date <= rec_date <= end_date:
                    maintenance_total += safe_float(rec.get('cost'))
                    maintenance_count += 1
        
        # Process active advances
        for adv_id, adv in advances.items():
            if adv and isinstance(adv, dict):
                status = adv.get('status')
                if status in ['approved', 'partially-paid']:
                    active_advances_total += safe_float(adv.get('remainingBalance'))
                    active_advances_count += 1
        
        # Process driver payroll from /driverDTRRecords (paid only)
        unique_drivers = set()
        for dtr_id, dtr in driver_dtr_records.items():
            if dtr and isinstance(dtr, dict) and dtr.get('status') == 'paid':
                driver_payroll_total += safe_float(dtr.get('netTotal'))
                driver_id = dtr.get('driverId')
                if driver_id:
                    unique_drivers.add(driver_id)
        driver_payroll_count = len(unique_drivers)
        
        categories = {
            'gasTotal': gas_total,
            'gasCount': gas_count,
            'rfidTotal': rfid_total,
            'rfidCount': rfid_count,
            'maintenanceTotal': maintenance_total,
            'maintenanceCount': maintenance_count,
            'adminPayrollTotal': 0,  # From admin DTR system
            'adminPayrollCount': 0,
            'driverPayrollTotal': driver_payroll_total,
            'driverPayrollCount': driver_payroll_count,
            'activeAdvancesTotal': active_advances_total,
            'activeAdvancesCount': active_advances_count
        }
        
        return jsonify({'success': True, 'data': categories})
        
    except Exception as e:
        print(f"Error in get_categories: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get recent items
@gl_overview_bp.route('/api/gl-overview/recent', methods=['GET'])
@superadmin_required
def get_recent():
    try:
        range_type = request.args.get('range', 'month')
        start_date_str = request.args.get('startDate', '')
        end_date_str = request.args.get('endDate', '')
        
        start_date, end_date = get_date_range(range_type, start_date_str, end_date_str)
        
        # Get recent completed trips
        schedules = get_schedules_ref().get() or {}
        
        recent_trips = []
        for sched_id, sched in schedules.items():
            if sched and isinstance(sched, dict) and sched.get('status') == 'Completed':
                sched_date = parse_date(sched.get('date'))
                if sched_date and start_date <= sched_date <= end_date:
                    current = sched.get('current', {})
                    if not isinstance(current, dict):
                        current = {}
                    
                    driver_name = current.get('driverName', 'Unknown')
                    
                    recent_trips.append({
                        'date': sched.get('date', ''),
                        'time': sched.get('time', ''),
                        'driverName': driver_name,
                        'amount': safe_float(sched.get('amount'))
                    })
        
        recent_trips.sort(key=lambda x: x.get('date', ''), reverse=True)
        recent_trips = recent_trips[:10]
        
        # Get recent gas expenses (paid requests)
        gas_requests = get_gas_transactions_ref().get() or {}
        recent_expenses = []
        
        for req_id, req in gas_requests.items():
            if req and isinstance(req, dict) and req.get('status') == 'paid':
                timestamp_ms = req.get('timestamp')
                req_date = epoch_to_date(timestamp_ms)
                if req_date and start_date <= req_date <= end_date:
                    recent_expenses.append({
                        'date': req_date.isoformat(),
                        'type': 'gas',
                        'description': 'Gas Request',
                        'amount': safe_float(req.get('amount'))
                    })
        
        # Get recent RFID expenses
        rfid_history = get_rfid_transactions_ref().get() or {}
        for hist_id, hist in rfid_history.items():
            if hist and isinstance(hist, dict):
                timestamp_ms = hist.get('timestamp')
                hist_date = epoch_to_date(timestamp_ms)
                if hist_date and start_date <= hist_date <= end_date:
                    recent_expenses.append({
                        'date': hist_date.isoformat(),
                        'type': 'rfid',
                        'description': 'RFID Transaction',
                        'amount': safe_float(hist.get('amount'))
                    })
        
        # Get recent maintenance expenses (completed)
        maintenance_records = get_maintenance_records_ref().get() or {}
        for rec_id, rec in maintenance_records.items():
            if rec and isinstance(rec, dict) and rec.get('status') == 'completed':
                created_at = rec.get('createdAt')
                rec_date = parse_iso_date(created_at) if created_at else None
                if rec_date and start_date <= rec_date <= end_date:
                    recent_expenses.append({
                        'date': rec_date.isoformat(),
                        'type': 'maintenance',
                        'description': rec.get('serviceType', 'Maintenance'),
                        'amount': safe_float(rec.get('cost'))
                    })
        
        recent_expenses.sort(key=lambda x: x.get('date', ''), reverse=True)
        recent_expenses = recent_expenses[:10]
        
        # Get top drivers by earnings (from driverDTRRecords)
        driver_dtr_records = get_driver_dtr_records_ref().get() or {}
        users = get_users_ref().get() or {}
        driver_earnings = {}
        
        for dtr_id, dtr in driver_dtr_records.items():
            if dtr and isinstance(dtr, dict) and dtr.get('status') == 'paid':
                driver_id = dtr.get('driverId')
                if driver_id:
                    if driver_id not in driver_earnings:
                        driver_earnings[driver_id] = {
                            'earnings': 0,
                            'trips': 0
                        }
                    driver_earnings[driver_id]['earnings'] += safe_float(dtr.get('netTotal'))
                    driver_earnings[driver_id]['trips'] += dtr.get('summary', {}).get('totalTrips', 0)
        
        top_drivers = []
        for driver_id, data in sorted(driver_earnings.items(), key=lambda x: x[1]['earnings'], reverse=True)[:5]:
            driver_name = 'Unknown'
            if driver_id in users:
                driver = users[driver_id]
                first = driver.get('firstName', '')
                middle = driver.get('middleName', '')
                last = driver.get('lastName', '')
                name_parts = [first]
                if middle:
                    name_parts.append(middle)
                if last:
                    name_parts.append(last)
                driver_name = ' '.join(name_parts).strip()
            
            top_drivers.append({
                'name': driver_name,
                'earnings': data['earnings'],
                'trips': data['trips']
            })
        
        # Get pending counts
        advances = get_advances_ref().get() or {}
        pending_advances = 0
        for adv_id, adv in advances.items():
            if adv and isinstance(adv, dict) and adv.get('status') == 'pending':
                pending_advances += 1
        
        deductions = get_deductions_ref().get() or {}
        pending_deductions = 0
        for ded_id, ded in deductions.items():
            if ded and isinstance(ded, dict) and ded.get('status') == 'pending':
                pending_deductions += 1
        
        admin_salaries = get_admin_salary_records_ref().get() or {}
        unpaid_salaries = 0
        for sal_id, sal in admin_salaries.items():
            if sal and isinstance(sal, dict) and sal.get('paymentStatus') == 'pending':
                unpaid_salaries += safe_float(sal.get('netPay'))
        
        recent_data = {
            'recentTrips': recent_trips,
            'recentExpenses': recent_expenses,
            'topDrivers': top_drivers,
            'pendingAdvances': pending_advances,
            'pendingDeductions': pending_deductions,
            'unpaidSalaries': unpaid_salaries
        }
        
        return jsonify({'success': True, 'data': recent_data})
        
    except Exception as e:
        print(f"Error in get_recent: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get monthly breakdown
@gl_overview_bp.route('/api/gl-overview/monthly', methods=['GET'])
@superadmin_required
def get_monthly():
    try:
        year = int(request.args.get('year', datetime.datetime.now().year))
        
        schedules = get_schedules_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        gas_requests = get_gas_transactions_ref().get() or {}
        rfid_history = get_rfid_transactions_ref().get() or {}
        maintenance_records = get_maintenance_records_ref().get() or {}
        driver_dtr_records = get_driver_dtr_records_ref().get() or {}
        
        monthly_data = []
        
        for month in range(1, 13):
            month_name = calendar.month_name[month]
            start_date = datetime.date(year, month, 1)
            if month == 12:
                end_date = datetime.date(year, 12, 31)
            else:
                end_date = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
            
            month_income = 0
            month_operating_expenses = 0
            month_salaries = 0
            
            # Process completed trips for this month
            for sched_id, sched in schedules.items():
                if not sched or not isinstance(sched, dict):
                    continue
                
                sched_date = parse_date(sched.get('date'))
                if sched.get('status') == 'Completed' and sched_date and start_date <= sched_date <= end_date:
                    month_income += safe_float(sched.get('amount'))
            
            # Process gas expenses (paid requests)
            for req_id, req in gas_requests.items():
                if not req or not isinstance(req, dict):
                    continue
                if req.get('status') != 'paid':
                    continue
                timestamp_ms = req.get('timestamp')
                req_date = epoch_to_date(timestamp_ms)
                if req_date and start_date <= req_date <= end_date:
                    month_operating_expenses += safe_float(req.get('amount'))
            
            # Process RFID expenses
            for hist_id, hist in rfid_history.items():
                if not hist or not isinstance(hist, dict):
                    continue
                timestamp_ms = hist.get('timestamp')
                hist_date = epoch_to_date(timestamp_ms)
                if hist_date and start_date <= hist_date <= end_date:
                    month_operating_expenses += safe_float(hist.get('amount'))
            
            # Process maintenance expenses (completed)
            for rec_id, rec in maintenance_records.items():
                if not rec or not isinstance(rec, dict):
                    continue
                if rec.get('status') != 'completed':
                    continue
                created_at = rec.get('createdAt')
                rec_date = parse_iso_date(created_at) if created_at else None
                if rec_date and start_date <= rec_date <= end_date:
                    month_operating_expenses += safe_float(rec.get('cost'))
            
            # Process driver salaries from DTR (paid)
            for dtr_id, dtr in driver_dtr_records.items():
                if not dtr or not isinstance(dtr, dict):
                    continue
                if dtr.get('status') != 'paid':
                    continue
                
                # Check cutoff period
                cutoff = dtr.get('cutoff', '')
                try:
                    if ' - ' in cutoff:
                        month_year_part = cutoff.split(' - ')[0]
                        cutoff_month_name = month_year_part.split()[0]
                        cutoff_year = int(month_year_part.split()[1])
                        
                        months = ['January', 'February', 'March', 'April', 'May', 'June',
                                  'July', 'August', 'September', 'October', 'November', 'December']
                        cutoff_month_num = months.index(cutoff_month_name) + 1
                        
                        if cutoff_year == year and cutoff_month_num == month:
                            month_salaries += safe_float(dtr.get('netTotal'))
                except:
                    pass
            
            # Process admin salaries (paid)
            for sal_id, sal in admin_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                if sal.get('paymentStatus') == 'paid':
                    # Approximate by created date
                    created_at = sal.get('createdAt')
                    if created_at:
                        try:
                            sal_date = datetime.datetime.fromisoformat(created_at.split('T')[0]).date()
                            if start_date <= sal_date <= end_date:
                                month_salaries += safe_float(sal.get('netPay'))
                        except:
                            pass
            
            total_expenses = month_operating_expenses + month_salaries
            net_profit = month_income - total_expenses
            
            monthly_data.append({
                'month': month_name,
                'income': month_income,
                'operatingExpenses': month_operating_expenses,
                'salaries': month_salaries,
                'totalExpenses': total_expenses,
                'netProfit': net_profit
            })
        
        return jsonify({'success': True, 'data': monthly_data})
        
    except Exception as e:
        print(f"Error in get_monthly: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get chart data
@gl_overview_bp.route('/api/gl-overview/chart-data', methods=['GET'])
@superadmin_required
def get_chart_data():
    try:
        year = datetime.datetime.now().year
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        income_data = []
        expenses_data = []
        profit_data = []
        
        schedules = get_schedules_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        gas_requests = get_gas_transactions_ref().get() or {}
        rfid_history = get_rfid_transactions_ref().get() or {}
        maintenance_records = get_maintenance_records_ref().get() or {}
        driver_dtr_records = get_driver_dtr_records_ref().get() or {}
        
        for month in range(1, 13):
            start_date = datetime.date(year, month, 1)
            if month == 12:
                end_date = datetime.date(year, 12, 31)
            else:
                end_date = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
            
            month_income = 0
            month_expenses = 0
            
            # Income from trips
            for sched_id, sched in schedules.items():
                if not sched or not isinstance(sched, dict):
                    continue
                sched_date = parse_date(sched.get('date'))
                if sched.get('status') == 'Completed' and sched_date and start_date <= sched_date <= end_date:
                    month_income += safe_float(sched.get('amount'))
            
            # Gas expenses
            for req_id, req in gas_requests.items():
                if not req or not isinstance(req, dict):
                    continue
                if req.get('status') == 'paid':
                    timestamp_ms = req.get('timestamp')
                    req_date = epoch_to_date(timestamp_ms)
                    if req_date and start_date <= req_date <= end_date:
                        month_expenses += safe_float(req.get('amount'))
            
            # RFID expenses
            for hist_id, hist in rfid_history.items():
                if not hist or not isinstance(hist, dict):
                    continue
                timestamp_ms = hist.get('timestamp')
                hist_date = epoch_to_date(timestamp_ms)
                if hist_date and start_date <= hist_date <= end_date:
                    month_expenses += safe_float(hist.get('amount'))
            
            # Maintenance expenses
            for rec_id, rec in maintenance_records.items():
                if not rec or not isinstance(rec, dict):
                    continue
                if rec.get('status') == 'completed':
                    created_at = rec.get('createdAt')
                    rec_date = parse_iso_date(created_at) if created_at else None
                    if rec_date and start_date <= rec_date <= end_date:
                        month_expenses += safe_float(rec.get('cost'))
            
            # Driver salaries
            for dtr_id, dtr in driver_dtr_records.items():
                if not dtr or not isinstance(dtr, dict):
                    continue
                if dtr.get('status') == 'paid':
                    # Approximate by cutoff
                    cutoff = dtr.get('cutoff', '')
                    try:
                        if ' - ' in cutoff:
                            month_year_part = cutoff.split(' - ')[0]
                            cutoff_month_name = month_year_part.split()[0]
                            cutoff_year = int(month_year_part.split()[1])
                            
                            months_list = ['January', 'February', 'March', 'April', 'May', 'June',
                                           'July', 'August', 'September', 'October', 'November', 'December']
                            cutoff_month_num = months_list.index(cutoff_month_name) + 1
                            
                            if cutoff_year == year and cutoff_month_num == month:
                                month_expenses += safe_float(dtr.get('netTotal'))
                    except:
                        pass
            
            # Admin salaries
            for sal_id, sal in admin_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                if sal.get('paymentStatus') == 'paid':
                    created_at = sal.get('createdAt')
                    if created_at:
                        try:
                            sal_date = datetime.datetime.fromisoformat(created_at.split('T')[0]).date()
                            if start_date <= sal_date <= end_date:
                                month_expenses += safe_float(sal.get('netPay'))
                        except:
                            pass
            
            income_data.append(month_income)
            expenses_data.append(month_expenses)
            profit_data.append(month_income - month_expenses)
        
        chart_data = {
            'labels': months,
            'income': income_data,
            'expenses': expenses_data,
            'profit': profit_data
        }
        
        return jsonify({'success': True, 'data': chart_data})
        
    except Exception as e:
        print(f"Error in get_chart_data: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500