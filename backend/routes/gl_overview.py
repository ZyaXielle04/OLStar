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

def get_gas_transactions_ref():
    return db.reference('gasTransactions')  # Adjust based on your actual structure

def get_rfid_transactions_ref():
    return db.reference('rfidTransactions')  # Adjust based on your actual structure

def get_maintenance_records_ref():
    return db.reference('maintenance')  # Adjust based on your actual structure

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
        driver_salaries = get_driver_salary_records_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        advances = get_advances_ref().get() or {}
        deductions = get_deductions_ref().get() or {}
        
        # Initialize counters
        total_trips = 0
        trip_income = 0
        driver_payout = 0
        admin_salaries_total = 0
        driver_salaries_total = 0
        advances_total = 0
        advances_paid = 0
        advances_outstanding = 0
        pending_advances = 0
        deductions_sss = 0
        deductions_philhealth = 0
        deductions_pagibig = 0
        deductions_tax = 0
        deductions_total = 0
        
        # In get_summary function, update the trip processing section:
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
        
        # Optional: You could also track driver names here if needed
        # current = sched.get('current', {})
        # driver_name = current.get('driverName', 'Unknown') if isinstance(current, dict) else 'Unknown'
        
        # Process driver salaries (Expense)
        for sal_id, sal in driver_salaries.items():
            if not sal or not isinstance(sal, dict):
                continue
            
            # Driver salaries are already paid out, but we track them separately
            pay_period = sal.get('payPeriod', '')
            # This is more complex - would need to parse period to date
            # For now, we'll just sum all
            if sal.get('paymentStatus') in ['paid', 'processing']:
                driver_salaries_total += safe_float(sal.get('netPay'))
        
        # Process admin salaries (Expense)
        for sal_id, sal in admin_salaries.items():
            if not sal or not isinstance(sal, dict):
                continue
            
            if sal.get('paymentStatus') in ['paid', 'processing']:
                admin_salaries_total += safe_float(sal.get('netPay'))
        
        # Process advances
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
        
        # Process deductions
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
                else:
                    # Other deductions - add to total but not categorized
                    pass
                deductions_total += amount
        
        # Calculate totals
        total_expenses = driver_salaries_total + admin_salaries_total + deductions_total
        net_profit = trip_income - total_expenses
        cash_flow = trip_income - driver_payout - admin_salaries_total - deductions_total
        
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
            'totalSalaries': admin_salaries_total + driver_salaries_total,
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
        
        # Get all transaction data
        gas_ref = get_gas_transactions_ref()
        rfid_ref = get_rfid_transactions_ref()
        maintenance_ref = get_maintenance_records_ref()
        admin_salaries = get_admin_salary_records_ref().get() or {}
        driver_salaries = get_driver_salary_records_ref().get() or {}
        advances = get_advances_ref().get() or {}
        
        gas_total = 0
        gas_count = 0
        rfid_total = 0
        rfid_count = 0
        maintenance_total = 0
        maintenance_count = 0
        admin_payroll_total = 0
        admin_payroll_count = 0
        driver_payroll_total = 0
        driver_payroll_count = 0
        active_advances_total = 0
        active_advances_count = 0
        
        # Process gas transactions
        gas_data = gas_ref.get() or {}
        for trans_id, trans in gas_data.items():
            if trans and isinstance(trans, dict):
                # Add date filtering logic here based on your gas transaction structure
                gas_total += safe_float(trans.get('amount'))
                gas_count += 1
        
        # Process RFID transactions
        rfid_data = rfid_ref.get() or {}
        for trans_id, trans in rfid_data.items():
            if trans and isinstance(trans, dict):
                rfid_total += safe_float(trans.get('amount'))
                rfid_count += 1
        
        # Process maintenance records
        maint_data = maintenance_ref.get() or {}
        for rec_id, rec in maint_data.items():
            if rec and isinstance(rec, dict):
                maintenance_total += safe_float(rec.get('cost'))
                maintenance_count += 1
        
        # Process admin salaries
        for sal_id, sal in admin_salaries.items():
            if sal and isinstance(sal, dict) and sal.get('paymentStatus') == 'paid':
                admin_payroll_total += safe_float(sal.get('netPay'))
                admin_payroll_count += 1
        
        # Process driver salaries
        unique_drivers = set()
        for sal_id, sal in driver_salaries.items():
            if sal and isinstance(sal, dict) and sal.get('paymentStatus') == 'paid':
                driver_payroll_total += safe_float(sal.get('netPay'))
                driver_id = sal.get('driverId')
                if driver_id:
                    unique_drivers.add(driver_id)
        driver_payroll_count = len(unique_drivers)
        
        # Process active advances
        for adv_id, adv in advances.items():
            if adv and isinstance(adv, dict):
                status = adv.get('status')
                if status in ['approved', 'partially-paid']:
                    active_advances_total += safe_float(adv.get('remainingBalance'))
                    active_advances_count += 1
        
        categories = {
            'gasTotal': gas_total,
            'gasCount': gas_count,
            'rfidTotal': rfid_total,
            'rfidCount': rfid_count,
            'maintenanceTotal': maintenance_total,
            'maintenanceCount': maintenance_count,
            'adminPayrollTotal': admin_payroll_total,
            'adminPayrollCount': admin_payroll_count,
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
        # Get recent completed trips - FIXED to use current.driverName
        schedules = get_schedules_ref().get() or {}
        
        recent_trips = []
        for sched_id, sched in schedules.items():
            if sched and isinstance(sched, dict) and sched.get('status') == 'Completed':
                # Get driver name from current object
                current = sched.get('current', {})
                if not isinstance(current, dict):
                    current = {}
                
                driver_name = current.get('driverName', 'Unknown')
                
                recent_trips.append({
                    'date': sched.get('date', ''),
                    'time': sched.get('time', ''),
                    'driverName': driver_name,  # Now using the stored driverName
                    'amount': safe_float(sched.get('amount'))
                })
        
        # Sort and limit
        recent_trips.sort(key=lambda x: x.get('date', ''), reverse=True)
        recent_trips = recent_trips[:10]
        
        # Get recent expenses (mix of gas, rfid, maintenance)
        gas_ref = get_gas_transactions_ref()
        rfid_ref = get_rfid_transactions_ref()
        maintenance_ref = get_maintenance_records_ref()
        
        recent_expenses = []
        
        gas_data = gas_ref.get() or {}
        for trans_id, trans in gas_data.items():
            if trans and isinstance(trans, dict):
                recent_expenses.append({
                    'date': trans.get('date', ''),
                    'type': 'gas',
                    'description': trans.get('description', 'Gas Transaction'),
                    'amount': safe_float(trans.get('amount'))
                })
        
        rfid_data = rfid_ref.get() or {}
        for trans_id, trans in rfid_data.items():
            if trans and isinstance(trans, dict):
                recent_expenses.append({
                    'date': trans.get('date', ''),
                    'type': 'rfid',
                    'description': trans.get('description', 'RFID Transaction'),
                    'amount': safe_float(trans.get('amount'))
                })
        
        maint_data = maintenance_ref.get() or {}
        for rec_id, rec in maint_data.items():
            if rec and isinstance(rec, dict):
                recent_expenses.append({
                    'date': rec.get('date', ''),
                    'type': 'maintenance',
                    'description': rec.get('description', 'Maintenance'),
                    'amount': safe_float(rec.get('cost'))
                })
        
        recent_expenses.sort(key=lambda x: x.get('date', ''), reverse=True)
        recent_expenses = recent_expenses[:10]
        
        # Get top drivers by earnings (this part still needs users lookup)
        driver_salaries = get_driver_salary_records_ref().get() or {}
        users = get_users_ref().get() or {}
        driver_earnings = {}
        
        for sal_id, sal in driver_salaries.items():
            if sal and isinstance(sal, dict) and sal.get('paymentStatus') == 'paid':
                driver_id = sal.get('driverId')
                if driver_id:
                    if driver_id not in driver_earnings:
                        driver_earnings[driver_id] = {
                            'earnings': 0,
                            'trips': 0
                        }
                    driver_earnings[driver_id]['earnings'] += safe_float(sal.get('netPay'))
                    driver_earnings[driver_id]['trips'] += safe_int(sal.get('totalTrips'))
        
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
        
        driver_salaries_data = get_driver_salary_records_ref().get() or {}
        for sal_id, sal in driver_salaries_data.items():
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
        driver_salaries = get_driver_salary_records_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        
        monthly_data = []
        
        for month in range(1, 13):
            month_name = calendar.month_name[month]
            start_date = datetime.date(year, month, 1)
            if month == 12:
                end_date = datetime.date(year, 12, 31)
            else:
                end_date = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
            
            month_income = 0
            month_driver_payout = 0
            month_salaries = 0
            month_expenses = 0
            
            # Process completed trips for this month
            for sched_id, sched in schedules.items():
                if not sched or not isinstance(sched, dict):
                    continue
                
                sched_date = parse_date(sched.get('date'))
                if sched.get('status') == 'Completed' and sched_date and start_date <= sched_date <= end_date:
                    month_income += safe_float(sched.get('amount'))
                    month_driver_payout += safe_float(sched.get('driverRate'))
            
            # Process driver salaries
            for sal_id, sal in driver_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                # This is approximate - would need better period parsing
                if sal.get('paymentStatus') == 'paid':
                    month_salaries += safe_float(sal.get('netPay'))
            
            # Process admin salaries
            for sal_id, sal in admin_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                if sal.get('paymentStatus') == 'paid':
                    month_salaries += safe_float(sal.get('netPay'))
            
            # For now, expenses are just salaries + driver payout
            month_expenses = month_salaries + month_driver_payout
            net_profit = month_income - month_expenses
            
            monthly_data.append({
                'month': month_name,
                'income': month_income,
                'driverPayout': month_driver_payout,
                'salaries': month_salaries,
                'expenses': month_expenses,
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
        driver_salaries = get_driver_salary_records_ref().get() or {}
        admin_salaries = get_admin_salary_records_ref().get() or {}
        
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
            
            # Expenses (driver payouts + salaries)
            for sal_id, sal in driver_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                if sal.get('paymentStatus') == 'paid':
                    month_expenses += safe_float(sal.get('netPay'))
            
            for sal_id, sal in admin_salaries.items():
                if not sal or not isinstance(sal, dict):
                    continue
                if sal.get('paymentStatus') == 'paid':
                    month_expenses += safe_float(sal.get('netPay'))
            
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