from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
import datetime
import calendar
from decorators import superadmin_required
import firebase_admin
from firebase_admin import db
import traceback

gl_drivers_salary_bp = Blueprint('gl_drivers_salary', __name__)

# Helper functions
def get_users_ref():
    return db.reference('users')

def get_schedules_ref():
    return db.reference('schedules')

def get_driver_salary_records_ref():
    return db.reference('driverSalaryRecords')

def get_deductions_ref():
    return db.reference('deductions')

def get_advances_ref():
    return db.reference('advances')

def safe_float(value, default=0):
    """Safely convert string to float"""
    if value is None:
        return default
    try:
        return float(str(value).replace(',', ''))
    except (ValueError, TypeError):
        return default

def safe_int(value, default=0):
    """Safely convert string to int"""
    if value is None:
        return default
    try:
        return int(float(str(value).replace(',', '')))
    except (ValueError, TypeError):
        return default

def safe_str(value, default=''):
    """Safely convert to string"""
    if value is None:
        return default
    return str(value)

def parse_date(date_str):
    """Safely parse date string in YYYY-MM-DD format"""
    if not date_str:
        return None
    try:
        return datetime.datetime.strptime(str(date_str), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None

# Get all drivers (users with role "driver")
@gl_drivers_salary_bp.route('/api/drivers-salary/drivers', methods=['GET'])
@superadmin_required
def get_drivers():
    try:
        users_ref = get_users_ref()
        all_users = users_ref.get() or {}
        
        drivers = []
        for uid, user_data in all_users.items():
            if user_data and isinstance(user_data, dict) and user_data.get('role') == 'driver':
                first_name = safe_str(user_data.get('firstName'))
                middle_name = safe_str(user_data.get('middleName'))
                last_name = safe_str(user_data.get('lastName'))
                
                # Construct full name
                name_parts = [first_name]
                if middle_name:
                    name_parts.append(middle_name)
                if last_name:
                    name_parts.append(last_name)
                full_name = ' '.join(name_parts).strip()
                
                drivers.append({
                    'id': uid,
                    'name': full_name or 'Unknown Driver',
                    'firstName': first_name,
                    'middleName': middle_name,
                    'lastName': last_name
                })
        
        return jsonify({'success': True, 'data': drivers})
        
    except Exception as e:
        print(f"Error in get_drivers: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get all completed trips - UPDATED to use current.driverName
@gl_drivers_salary_bp.route('/api/drivers-salary/completed-trips', methods=['GET'])
@superadmin_required
def get_completed_trips():
    try:
        schedules_ref = get_schedules_ref()
        all_schedules = schedules_ref.get() or {}
        
        trips = []
        for schedule_id, schedule in all_schedules.items():
            if not schedule or not isinstance(schedule, dict):
                continue
                
            # Check if schedule is completed
            if schedule.get('status') == 'Completed':
                # Get driver name from current object
                current = schedule.get('current', {})
                if not isinstance(current, dict):
                    current = {}
                
                driver_name = safe_str(current.get('driverName'))
                
                # If not found in current, try direct field as fallback
                if not driver_name:
                    driver_name = safe_str(schedule.get('driverName'))
                
                trips.append({
                    'id': schedule_id,
                    'date': safe_str(schedule.get('date')),
                    'time': safe_str(schedule.get('time')),
                    'driverId': safe_str(schedule.get('driverId')),  # Still keep for reference
                    'driverName': driver_name,
                    'amount': safe_float(schedule.get('amount')),
                    'driverRate': safe_float(schedule.get('driverRate'))
                })
        
        # Sort by date descending
        trips.sort(key=lambda x: x.get('date', ''), reverse=True)
        
        print(f"Found {len(trips)} completed trips")
        
        return jsonify({'success': True, 'data': trips})
        
    except Exception as e:
        print(f"Error in get_completed_trips: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get driver's completed trips for a specific period - UPDATED to match by driverName
@gl_drivers_salary_bp.route('/api/drivers-salary/driver-trips/<driver_id>', methods=['GET'])
@superadmin_required
def get_driver_trips(driver_id):
    try:
        period = request.args.get('period', '')
        driver_name = request.args.get('driverName', '')
        
        if not period:
            return jsonify({'success': False, 'error': 'Period is required'}), 400
        
        if not driver_name:
            return jsonify({'success': False, 'error': 'Driver name is required'}), 400
        
        print(f"Looking for trips for driver: {driver_name} in period: {period}")
        
        # Parse period (e.g., "March 2026 - 1st Half")
        parts = period.split(' - ')
        month_year = parts[0]  # "March 2026"
        half = parts[1] if len(parts) > 1 else ''  # "1st Half" or "2nd Half"
        
        try:
            month_name, year = month_year.rsplit(' ', 1)
            year = int(year)
            month_num = list(calendar.month_name).index(month_name)
        except (ValueError, IndexError):
            return jsonify({'success': False, 'error': f'Invalid period format: {period}'}), 400
        
        # Determine date range
        if '1st Half' in half:
            start_day = 1
            end_day = 15
        else:
            start_day = 16
            last_day = calendar.monthrange(year, month_num)[1]
            end_day = last_day
        
        start_date = f"{year}-{month_num:02d}-{start_day:02d}"
        end_date = f"{year}-{month_num:02d}-{end_day:02d}"
        
        # Parse dates for comparison
        start_date_obj = parse_date(start_date)
        end_date_obj = parse_date(end_date)
        
        if not start_date_obj or not end_date_obj:
            return jsonify({'success': False, 'error': 'Invalid date range'}), 400
        
        schedules_ref = get_schedules_ref()
        all_schedules = schedules_ref.get() or {}
        
        trips = []
        for schedule_id, schedule in all_schedules.items():
            if not schedule or not isinstance(schedule, dict):
                continue
            
            # Get the current object which contains driverName
            current = schedule.get('current', {})
            if not isinstance(current, dict):
                current = {}
            
            # Get driver name from current object
            schedule_driver_name = safe_str(current.get('driverName'))
            
            # Also check direct driverName field as fallback
            if not schedule_driver_name:
                schedule_driver_name = safe_str(schedule.get('driverName'))
            
            schedule_date_str = safe_str(schedule.get('date'))
            schedule_date_obj = parse_date(schedule_date_str)
            
            # Match by driver name (case-insensitive) and completed status
            if (schedule.get('status') == 'Completed' and 
                schedule_driver_name and 
                schedule_driver_name.lower() == driver_name.lower() and
                schedule_date_obj and start_date_obj <= schedule_date_obj <= end_date_obj):
                
                print(f"Found matching trip: {schedule_id} on {schedule_date_str}")
                
                trips.append({
                    'id': schedule_id,
                    'date': schedule_date_str,
                    'time': safe_str(schedule.get('time')),
                    'driverRate': safe_float(schedule.get('driverRate'))
                })
        
        print(f"Found {len(trips)} trips for driver {driver_name}")
        
        # Sort by date
        trips.sort(key=lambda x: x.get('date', ''))
        
        return jsonify({'success': True, 'data': trips})
        
    except Exception as e:
        print(f"Error in get_driver_trips: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get pending deductions for an employee (admin or driver)
@gl_drivers_salary_bp.route('/api/drivers-salary/pending-deductions/<employee_id>', methods=['GET'])
@superadmin_required
def get_pending_deductions(employee_id):
    try:
        period = request.args.get('period', '')
        
        if not period:
            return jsonify({'success': False, 'error': 'Period is required'}), 400
        
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        
        pending = {
            'sss': 0,
            'philhealth': 0,
            'pagibig': 0,
            'tax': 0,
            'loan': 0,
            'other': 0,
            'total': 0
        }
        
        for ded_id, ded in all_deductions.items():
            if ded and isinstance(ded, dict):
                if (ded.get('employeeId') == employee_id and 
                    ded.get('period') == period and 
                    ded.get('status') == 'pending'):
                    
                    ded_type = ded.get('type', 'other')
                    amount = safe_float(ded.get('amount'))
                    
                    if ded_type in pending:
                        pending[ded_type] += amount
                    else:
                        pending['other'] += amount
                    
                    pending['total'] += amount
        
        return jsonify({'success': True, 'data': pending})
        
    except Exception as e:
        print(f"Error in get_pending_deductions: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get pending advances for an employee (admin or driver)
@gl_drivers_salary_bp.route('/api/drivers-salary/pending-advances/<employee_id>', methods=['GET'])
@superadmin_required
def get_pending_advances(employee_id):
    try:
        period = request.args.get('period', '')
        
        if not period:
            return jsonify({'success': False, 'error': 'Period is required'}), 400
        
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        total_advance = 0
        
        for adv_id, adv in all_advances.items():
            if adv and isinstance(adv, dict):
                if adv.get('employeeId') != employee_id:
                    continue
                    
                if adv.get('status') in ['approved', 'partially-paid'] and safe_float(adv.get('remainingBalance')) > 0:
                    if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                        repayment = min(safe_float(adv.get('repaymentAmount')), safe_float(adv.get('remainingBalance')))
                        total_advance += repayment
        
        return jsonify({
            'success': True, 
            'data': {
                'totalAdvance': total_advance
            }
        })
        
    except Exception as e:
        print(f"Error in get_pending_advances: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get all driver salary records
@gl_drivers_salary_bp.route('/api/drivers-salary/records', methods=['GET'])
@superadmin_required
def get_salary_records():
    try:
        search = request.args.get('search', '')
        status = request.args.get('status', 'all')
        driver_id = request.args.get('driverId', 'all')
        pay_period = request.args.get('payPeriod', 'all')
        date_range = request.args.get('dateRange', 'all')
        start_date = request.args.get('startDate', '')
        end_date = request.args.get('endDate', '')
        page = safe_int(request.args.get('page', 1))
        limit = safe_int(request.args.get('limit', 10))
        
        salary_ref = get_driver_salary_records_ref()
        all_records = salary_ref.get() or {}
        
        records = []
        for record_id, record in all_records.items():
            if not record or not isinstance(record, dict):
                continue
                
            driver_id_val = record.get('driverId')
            driver_name = 'Unknown'
            
            # Try to get driver name from users
            if driver_id_val:
                users_ref = get_users_ref()
                driver = users_ref.child(driver_id_val).get() or {}
                if driver and isinstance(driver, dict):
                    first_name = safe_str(driver.get('firstName'))
                    middle_name = safe_str(driver.get('middleName'))
                    last_name = safe_str(driver.get('lastName'))
                    
                    name_parts = [first_name]
                    if middle_name:
                        name_parts.append(middle_name)
                    if last_name:
                        name_parts.append(last_name)
                    driver_name = ' '.join(name_parts).strip() or 'Unknown'
            
            records.append({
                'id': record_id,
                'driverId': driver_id_val,
                'driverName': driver_name,
                **record
            })
        
        # Apply filters
        filtered = filter_records(records, search, status, driver_id, pay_period, date_range, start_date, end_date)
        
        total = len(filtered)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated = filtered[start_idx:end_idx]
        
        return jsonify({
            'success': True,
            'data': paginated,
            'total': total,
            'page': page,
            'total_pages': (total + limit - 1) // limit if total > 0 else 1
        })
        
    except Exception as e:
        print(f"Error in get_salary_records: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get single salary record
@gl_drivers_salary_bp.route('/api/drivers-salary/records/<record_id>', methods=['GET'])
@superadmin_required
def get_salary_record(record_id):
    try:
        salary_ref = get_driver_salary_records_ref().child(record_id)
        record = salary_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Get driver name
        driver_id = record.get('driverId')
        driver_name = 'Unknown'
        
        if driver_id:
            users_ref = get_users_ref()
            driver = users_ref.child(driver_id).get() or {}
            if driver and isinstance(driver, dict):
                first_name = safe_str(driver.get('firstName'))
                middle_name = safe_str(driver.get('middleName'))
                last_name = safe_str(driver.get('lastName'))
                
                name_parts = [first_name]
                if middle_name:
                    name_parts.append(middle_name)
                if last_name:
                    name_parts.append(last_name)
                driver_name = ' '.join(name_parts).strip() or 'Unknown'
        
        # Get trip details
        trip_ids = record.get('tripIds', [])
        trips = []
        
        if trip_ids and isinstance(trip_ids, list):
            schedules_ref = get_schedules_ref()
            for trip_id in trip_ids:
                trip = schedules_ref.child(trip_id).get()
                if trip and isinstance(trip, dict):
                    # Try to get driver name from multiple sources
                    trip_driver_name = 'Unknown'
                    
                    # Try current object
                    current = trip.get('current')
                    if current and isinstance(current, dict):
                        trip_driver_name = safe_str(current.get('driverName'))
                    
                    # Try direct field
                    if not trip_driver_name or trip_driver_name == 'Unknown':
                        trip_driver_name = safe_str(trip.get('driverName'))
                    
                    trips.append({
                        'id': trip_id,
                        'date': safe_str(trip.get('date')),
                        'time': safe_str(trip.get('time')),
                        'driverRate': safe_float(trip.get('driverRate')),
                        'driverName': trip_driver_name
                    })
        
        record_data = {
            'id': record_id,
            'driverId': driver_id,
            'driverName': driver_name,
            'trips': trips,
            **record
        }
        
        return jsonify({'success': True, 'data': record_data})
        
    except Exception as e:
        print(f"Error in get_salary_record: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Create salary record
@gl_drivers_salary_bp.route('/api/drivers-salary/records', methods=['POST'])
@superadmin_required
def create_salary_record():
    try:
        data = request.json
        
        required_fields = ['driverId', 'payPeriod', 'tripIds', 'grossEarnings', 'paymentStatus']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        driver_id = data['driverId']
        period = data['payPeriod']
        trip_ids = data['tripIds']
        
        if not isinstance(trip_ids, list):
            return jsonify({'success': False, 'error': 'tripIds must be a list'}), 400
        
        # Get pending deductions and advances
        pending_deductions = get_pending_deductions_data(driver_id, period)
        pending_advances = get_pending_advances_data(driver_id, period)
        
        # Use values from form
        tax_deduction = safe_float(data.get('taxDeduction'), pending_deductions['tax'])
        sss_deduction = safe_float(data.get('sssDeduction'), pending_deductions['sss'])
        philhealth_deduction = safe_float(data.get('philhealthDeduction'), pending_deductions['philhealth'])
        pagibig_deduction = safe_float(data.get('pagibigDeduction'), pending_deductions['pagibig'])
        loan_deduction = safe_float(data.get('loanDeduction'), pending_deductions['loan'])
        other_deductions = safe_float(data.get('otherDeductions'), pending_deductions['other'])
        advance_deduction = safe_float(data.get('advanceDeduction'), pending_advances['totalAdvance'])
        
        gross_earnings = safe_float(data.get('grossEarnings'))
        total_deductions = (tax_deduction + sss_deduction + philhealth_deduction + 
                           pagibig_deduction + loan_deduction + other_deductions + 
                           advance_deduction)
        net_pay = gross_earnings - total_deductions
        
        record_data = {
            'driverId': driver_id,
            'payPeriod': period,
            'tripIds': trip_ids,
            'totalTrips': len(trip_ids),
            'grossEarnings': gross_earnings,
            'taxDeduction': tax_deduction,
            'sssDeduction': sss_deduction,
            'philhealthDeduction': philhealth_deduction,
            'pagibigDeduction': pagibig_deduction,
            'loanDeduction': loan_deduction,
            'otherDeductions': other_deductions,
            'advanceDeduction': advance_deduction,
            'totalDeductions': total_deductions,
            'netPay': net_pay,
            'paymentStatus': data['paymentStatus'],
            'paymentDate': data.get('paymentDate', ''),
            'paymentMethod': data.get('paymentMethod', ''),
            'notes': data.get('notes', ''),
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system'),
            'updatedAt': datetime.datetime.now().isoformat()
        }
        
        salary_ref = get_driver_salary_records_ref()
        new_record = salary_ref.push(record_data)
        
        # Mark pending deductions as applied
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        for ded_id, ded in all_deductions.items():
            if ded and isinstance(ded, dict):
                if (ded.get('employeeId') == driver_id and 
                    ded.get('period') == period and 
                    ded.get('status') == 'pending'):
                    deductions_ref.child(ded_id).update({
                        'status': 'applied',
                        'linkedSalaryRecord': new_record.key,
                        'appliedAt': datetime.datetime.now().isoformat()
                    })
        
        # Update advance balances
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        for adv_id, adv in all_advances.items():
            if adv and isinstance(adv, dict):
                if adv.get('employeeId') != driver_id:
                    continue
                    
                if adv.get('status') in ['approved', 'partially-paid'] and safe_float(adv.get('remainingBalance')) > 0:
                    if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                        repayment = min(safe_float(adv.get('repaymentAmount')), safe_float(adv.get('remainingBalance')))
                        new_balance = safe_float(adv.get('remainingBalance')) - repayment
                        
                        # Update payment schedule
                        payment_schedule = adv.get('paymentSchedule', [])
                        if payment_schedule and isinstance(payment_schedule, list):
                            for payment in payment_schedule:
                                if payment and isinstance(payment, dict) and payment.get('status') == 'pending':
                                    payment['status'] = 'paid'
                                    payment['paidDate'] = data.get('paymentDate', datetime.datetime.now().isoformat())
                                    payment['linkedSalaryRecord'] = new_record.key
                                    break
                        
                        update_data = {
                            'remainingBalance': new_balance,
                            'paidAmount': safe_float(adv.get('paidAmount')) + repayment,
                            'paymentSchedule': payment_schedule,
                            'updatedAt': datetime.datetime.now().isoformat()
                        }
                        
                        if new_balance <= 0:
                            update_data['status'] = 'paid'
                            update_data['datePaid'] = data.get('paymentDate', datetime.datetime.now().isoformat())
                        
                        advances_ref.child(adv_id).update(update_data)
        
        return jsonify({
            'success': True,
            'message': 'Salary record created successfully',
            'data': {'id': new_record.key}
        }), 201
        
    except Exception as e:
        print(f"Error in create_salary_record: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Update salary record
@gl_drivers_salary_bp.route('/api/drivers-salary/records/<record_id>', methods=['PUT'])
@superadmin_required
def update_salary_record(record_id):
    try:
        data = request.json
        salary_ref = get_driver_salary_records_ref().child(record_id)
        
        if not salary_ref.get():
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        gross_earnings = safe_float(data.get('grossEarnings'))
        tax_deduction = safe_float(data.get('taxDeduction'))
        sss_deduction = safe_float(data.get('sssDeduction'))
        philhealth_deduction = safe_float(data.get('philhealthDeduction'))
        pagibig_deduction = safe_float(data.get('pagibigDeduction'))
        loan_deduction = safe_float(data.get('loanDeduction'))
        other_deductions = safe_float(data.get('otherDeductions'))
        advance_deduction = safe_float(data.get('advanceDeduction'))
        
        total_deductions = (tax_deduction + sss_deduction + philhealth_deduction + 
                           pagibig_deduction + loan_deduction + other_deductions + 
                           advance_deduction)
        net_pay = gross_earnings - total_deductions
        
        data['totalDeductions'] = total_deductions
        data['netPay'] = net_pay
        data['updatedAt'] = datetime.datetime.now().isoformat()
        data['updatedBy'] = session.get('user_id', 'system')
        
        salary_ref.update(data)
        
        return jsonify({'success': True, 'message': 'Salary record updated successfully'})
        
    except Exception as e:
        print(f"Error in update_salary_record: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Delete salary record
@gl_drivers_salary_bp.route('/api/drivers-salary/records/<record_id>', methods=['DELETE'])
@superadmin_required
def delete_salary_record(record_id):
    try:
        salary_ref = get_driver_salary_records_ref().child(record_id)
        record = salary_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        salary_ref.delete()
        
        return jsonify({'success': True, 'message': 'Salary record deleted successfully'})
        
    except Exception as e:
        print(f"Error in delete_salary_record: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Process bulk payroll
@gl_drivers_salary_bp.route('/api/drivers-salary/process-payroll', methods=['POST'])
@superadmin_required
def process_payroll():
    try:
        data = request.json
        pay_period = data.get('payrollPeriod')
        payment_date = data.get('payrollDate')
        payment_method = data.get('paymentMethod')
        
        if not all([pay_period, payment_date, payment_method]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        # Parse period
        parts = pay_period.split(' - ')
        month_year = parts[0]
        half = parts[1] if len(parts) > 1 else ''
        
        try:
            month_name, year = month_year.rsplit(' ', 1)
            year = int(year)
            month_num = list(calendar.month_name).index(month_name)
        except (ValueError, IndexError) as e:
            return jsonify({'success': False, 'error': f'Invalid period format: {pay_period}'}), 400
        
        if '1st Half' in half:
            start_day = 1
            end_day = 15
        else:
            start_day = 16
            last_day = calendar.monthrange(year, month_num)[1]
            end_day = last_day
        
        start_date = f"{year}-{month_num:02d}-{start_day:02d}"
        end_date = f"{year}-{month_num:02d}-{end_day:02d}"
        
        # Parse dates for comparison
        start_date_obj = parse_date(start_date)
        end_date_obj = parse_date(end_date)
        
        if not start_date_obj or not end_date_obj:
            return jsonify({'success': False, 'error': 'Invalid date range'}), 400
        
        # Get all completed trips in period
        schedules_ref = get_schedules_ref()
        all_schedules = schedules_ref.get() or {}
        
        # Group trips by driver
        driver_trips = {}
        for schedule_id, schedule in all_schedules.items():
            if schedule and isinstance(schedule, dict):
                schedule_date_str = safe_str(schedule.get('date'))
                schedule_date_obj = parse_date(schedule_date_str)
                
                if (schedule.get('status') == 'Completed' and
                    schedule_date_obj and start_date_obj <= schedule_date_obj <= end_date_obj):
                    
                    driver_id = schedule.get('driverId')
                    if driver_id:
                        if driver_id not in driver_trips:
                            driver_trips[driver_id] = []
                        driver_trips[driver_id].append({
                            'id': schedule_id,
                            'driverRate': safe_float(schedule.get('driverRate'))
                        })
        
        salary_ref = get_driver_salary_records_ref()
        deductions_ref = get_deductions_ref()
        advances_ref = get_advances_ref()
        
        created_count = 0
        
        for driver_id, trips in driver_trips.items():
            # Check if already has a salary record for this period
            existing = False
            all_records = salary_ref.get() or {}
            for record in all_records.values():
                if record and isinstance(record, dict):
                    if record.get('driverId') == driver_id and record.get('payPeriod') == pay_period:
                        existing = True
                        break
            
            if existing:
                continue
            
            # Calculate gross earnings
            gross_earnings = sum(trip['driverRate'] for trip in trips)
            trip_ids = [trip['id'] for trip in trips]
            
            # Get pending deductions
            pending_deductions = get_pending_deductions_data(driver_id, pay_period)
            
            # Get pending advances
            pending_advances = get_pending_advances_data(driver_id, pay_period)
            
            tax_deduction = pending_deductions['tax']
            sss_deduction = pending_deductions['sss']
            philhealth_deduction = pending_deductions['philhealth']
            pagibig_deduction = pending_deductions['pagibig']
            loan_deduction = pending_deductions['loan']
            other_deductions = pending_deductions['other']
            advance_deduction = pending_advances['totalAdvance']
            
            total_deductions = (tax_deduction + sss_deduction + philhealth_deduction + 
                               pagibig_deduction + loan_deduction + other_deductions + 
                               advance_deduction)
            net_pay = gross_earnings - total_deductions
            
            record_data = {
                'driverId': driver_id,
                'payPeriod': pay_period,
                'tripIds': trip_ids,
                'totalTrips': len(trip_ids),
                'grossEarnings': gross_earnings,
                'taxDeduction': tax_deduction,
                'sssDeduction': sss_deduction,
                'philhealthDeduction': philhealth_deduction,
                'pagibigDeduction': pagibig_deduction,
                'loanDeduction': loan_deduction,
                'otherDeductions': other_deductions,
                'advanceDeduction': advance_deduction,
                'totalDeductions': total_deductions,
                'netPay': net_pay,
                'paymentStatus': 'processing',
                'paymentDate': payment_date,
                'paymentMethod': payment_method,
                'notes': f'Auto-generated payroll for {pay_period}',
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system')
            }
            
            new_record = salary_ref.push(record_data)
            created_count += 1
            
            # Mark deductions as applied
            all_deductions = deductions_ref.get() or {}
            for ded_id, ded in all_deductions.items():
                if ded and isinstance(ded, dict):
                    if (ded.get('employeeId') == driver_id and 
                        ded.get('period') == pay_period and 
                        ded.get('status') == 'pending'):
                        deductions_ref.child(ded_id).update({
                            'status': 'applied',
                            'linkedSalaryRecord': new_record.key,
                            'appliedAt': datetime.datetime.now().isoformat()
                        })
            
            # Update advances
            all_advances = advances_ref.get() or {}
            for adv_id, adv in all_advances.items():
                if adv and isinstance(adv, dict):
                    if adv.get('employeeId') != driver_id:
                        continue
                        
                    if adv.get('status') in ['approved', 'partially-paid'] and safe_float(adv.get('remainingBalance')) > 0:
                        if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                            repayment = min(safe_float(adv.get('repaymentAmount')), safe_float(adv.get('remainingBalance')))
                            new_balance = safe_float(adv.get('remainingBalance')) - repayment
                            
                            payment_schedule = adv.get('paymentSchedule', [])
                            if payment_schedule and isinstance(payment_schedule, list):
                                for payment in payment_schedule:
                                    if payment and isinstance(payment, dict) and payment.get('status') == 'pending':
                                        payment['status'] = 'paid'
                                        payment['paidDate'] = payment_date
                                        payment['linkedSalaryRecord'] = new_record.key
                                        break
                            
                            update_data = {
                                'remainingBalance': new_balance,
                                'paidAmount': safe_float(adv.get('paidAmount')) + repayment,
                                'paymentSchedule': payment_schedule,
                                'updatedAt': datetime.datetime.now().isoformat()
                            }
                            
                            if new_balance <= 0:
                                update_data['status'] = 'paid'
                                update_data['datePaid'] = payment_date
                            
                            advances_ref.child(adv_id).update(update_data)
        
        return jsonify({
            'success': True,
            'message': f'Payroll processed for {created_count} drivers',
            'data': {'count': created_count}
        })
        
    except Exception as e:
        print(f"Error in process_payroll: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Generate payslip
@gl_drivers_salary_bp.route('/api/drivers-salary/generate-payslip/<record_id>', methods=['GET'])
@superadmin_required
def generate_payslip(record_id):
    try:
        salary_ref = get_driver_salary_records_ref().child(record_id)
        record = salary_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        driver_id = record.get('driverId')
        driver_name = 'Unknown'
        
        if driver_id:
            users_ref = get_users_ref()
            driver = users_ref.child(driver_id).get() or {}
            if driver and isinstance(driver, dict):
                first_name = safe_str(driver.get('firstName'))
                middle_name = safe_str(driver.get('middleName'))
                last_name = safe_str(driver.get('lastName'))
                
                name_parts = [first_name]
                if middle_name:
                    name_parts.append(middle_name)
                if last_name:
                    name_parts.append(last_name)
                driver_name = ' '.join(name_parts).strip() or 'Unknown'
        
        payslip_data = {
            'recordId': record_id,
            'driver': {
                'id': driver_id,
                'name': driver_name
            },
            'payPeriod': record.get('payPeriod'),
            'totalTrips': safe_int(record.get('totalTrips')),
            'grossEarnings': safe_float(record.get('grossEarnings')),
            'deductions': {
                'tax': safe_float(record.get('taxDeduction')),
                'sss': safe_float(record.get('sssDeduction')),
                'philhealth': safe_float(record.get('philhealthDeduction')),
                'pagibig': safe_float(record.get('pagibigDeduction')),
                'loan': safe_float(record.get('loanDeduction')),
                'other': safe_float(record.get('otherDeductions')),
                'advance': safe_float(record.get('advanceDeduction')),
                'total': safe_float(record.get('totalDeductions'))
            },
            'netPay': safe_float(record.get('netPay')),
            'paymentDate': record.get('paymentDate', ''),
            'paymentMethod': record.get('paymentMethod', ''),
            'status': record.get('paymentStatus', '')
        }
        
        return jsonify({'success': True, 'data': payslip_data})
        
    except Exception as e:
        print(f"Error in generate_payslip: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get summary statistics
@gl_drivers_salary_bp.route('/api/drivers-salary/summary', methods=['GET'])
@superadmin_required
def get_summary():
    try:
        users_ref = get_users_ref()
        all_users = users_ref.get() or {}
        
        # Count active drivers
        active_drivers = 0
        for user in all_users.values():
            if user and isinstance(user, dict) and user.get('role') == 'driver':
                active_drivers += 1
        
        # Get salary records
        salary_ref = get_driver_salary_records_ref()
        all_records = salary_ref.get() or {}
        
        current_month = datetime.datetime.now().strftime('%B %Y')
        monthly_payout = 0
        pending_total = 0
        pending_count = 0
        completed_trips = 0
        
        for record in all_records.values():
            if record and isinstance(record, dict):
                if record.get('payPeriod', '').startswith(current_month):
                    monthly_payout += safe_float(record.get('netPay'))
                
                if record.get('paymentStatus') == 'pending':
                    pending_total += safe_float(record.get('netPay'))
                    pending_count += 1
                
                completed_trips += safe_int(record.get('totalTrips'))
        
        summary = {
            'totalDrivers': active_drivers,
            'monthlyPayout': monthly_payout,
            'monthlyPeriod': current_month,
            'pendingPayouts': pending_total,
            'pendingCount': pending_count,
            'completedTrips': completed_trips
        }
        
        return jsonify({'success': True, 'data': summary})
        
    except Exception as e:
        print(f"Error in get_summary: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get analytics
@gl_drivers_salary_bp.route('/api/drivers-salary/analytics', methods=['GET'])
@superadmin_required
def get_analytics():
    try:
        salary_ref = get_driver_salary_records_ref()
        all_records = salary_ref.get() or {}
        
        users_ref = get_users_ref()
        all_users = users_ref.get() or {}
        
        schedules_ref = get_schedules_ref()
        all_schedules = schedules_ref.get() or {}
        
        # Monthly trend
        months = []
        monthly_data = []
        today = datetime.datetime.now()
        for i in range(5, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            month_name = month_date.strftime('%b')
            months.append(month_name)
            
            month_total = 0
            for record in all_records.values():
                if record and isinstance(record, dict):
                    if record.get('payPeriod', '').startswith(month_name):
                        month_total += safe_float(record.get('netPay'))
            monthly_data.append(month_total)
        
        # Status distribution
        status_counts = {'paid': 0, 'pending': 0, 'processing': 0, 'cancelled': 0}
        for record in all_records.values():
            if record and isinstance(record, dict):
                status = record.get('paymentStatus', 'pending')
                if status in status_counts:
                    status_counts[status] += 1
        
        # Top drivers by earnings
        driver_totals = {}
        for record in all_records.values():
            if record and isinstance(record, dict):
                driver_id = record.get('driverId')
                if driver_id and record.get('paymentStatus') == 'paid':
                    if driver_id not in driver_totals:
                        driver_totals[driver_id] = 0
                    driver_totals[driver_id] += safe_float(record.get('netPay'))
        
        top_drivers = []
        for driver_id, total in sorted(driver_totals.items(), key=lambda x: x[1], reverse=True)[:5]:
            driver = all_users.get(driver_id, {})
            if driver and isinstance(driver, dict):
                first_name = safe_str(driver.get('firstName'))
                middle_name = safe_str(driver.get('middleName'))
                last_name = safe_str(driver.get('lastName'))
                
                name_parts = [first_name]
                if middle_name:
                    name_parts.append(middle_name)
                if last_name:
                    name_parts.append(last_name)
                name = ' '.join(name_parts).strip() or 'Unknown'
            else:
                name = 'Unknown'
            
            top_drivers.append({
                'name': name,
                'total': total
            })
        
        # Recent trips
        recent_trips = []
        # Convert to list for sorting
        schedule_items = []
        for schedule_id, schedule in all_schedules.items():
            if schedule and isinstance(schedule, dict):
                schedule_items.append((schedule_id, schedule))
        
        # Sort by date
        schedule_items.sort(key=lambda x: x[1].get('date', ''), reverse=True)
        
        for schedule_id, schedule in schedule_items[:10]:
            if schedule.get('status') == 'Completed':
                # Get driver name from multiple sources
                driver_name = 'Unknown'
                
                # Try current object
                current = schedule.get('current')
                if current and isinstance(current, dict):
                    driver_name = safe_str(current.get('driverName'))
                
                # Try direct field
                if not driver_name or driver_name == 'Unknown':
                    driver_name = safe_str(schedule.get('driverName'))
                
                recent_trips.append({
                    'date': safe_str(schedule.get('date')),
                    'time': safe_str(schedule.get('time')),
                    'driverName': driver_name,
                    'driverRate': safe_float(schedule.get('driverRate'))
                })
        
        analytics = {
            'monthlyTrend': {
                'labels': months,
                'data': monthly_data
            },
            'statusDistribution': {
                'labels': list(status_counts.keys()),
                'data': list(status_counts.values())
            },
            'topDrivers': top_drivers,
            'recentTrips': recent_trips
        }
        
        return jsonify({'success': True, 'data': analytics})
        
    except Exception as e:
        print(f"Error in get_analytics: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Helper functions
def get_pending_deductions_data(employee_id, period):
    try:
        deductions_ref = db.reference('deductions')
        all_deductions = deductions_ref.get() or {}
        
        pending = {
            'sss': 0,
            'philhealth': 0,
            'pagibig': 0,
            'tax': 0,
            'loan': 0,
            'other': 0,
            'total': 0
        }
        
        for ded_id, ded in all_deductions.items():
            if ded and isinstance(ded, dict):
                if (ded.get('employeeId') == employee_id and 
                    ded.get('period') == period and 
                    ded.get('status') == 'pending'):
                    
                    ded_type = ded.get('type', 'other')
                    amount = safe_float(ded.get('amount'))
                    
                    if ded_type in pending:
                        pending[ded_type] += amount
                    else:
                        pending['other'] += amount
                    
                    pending['total'] += amount
        
        return pending
    except Exception as e:
        print(f"Error in get_pending_deductions_data: {str(e)}")
        return {'sss': 0, 'philhealth': 0, 'pagibig': 0, 'tax': 0, 'loan': 0, 'other': 0, 'total': 0}

def get_pending_advances_data(employee_id, period):
    try:
        advances_ref = db.reference('advances')
        all_advances = advances_ref.get() or {}
        
        total_advance = 0
        
        for adv_id, adv in all_advances.items():
            if adv and isinstance(adv, dict):
                if adv.get('employeeId') != employee_id:
                    continue
                    
                if adv.get('status') in ['approved', 'partially-paid'] and safe_float(adv.get('remainingBalance')) > 0:
                    if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                        repayment = min(safe_float(adv.get('repaymentAmount')), safe_float(adv.get('remainingBalance')))
                        total_advance += repayment
        
        return {'totalAdvance': total_advance}
    except Exception as e:
        print(f"Error in get_pending_advances_data: {str(e)}")
        return {'totalAdvance': 0}

def filter_records(records, search, status, driver_id, pay_period, date_range, start_date, end_date):
    filtered = records.copy()
    
    if search:
        search_lower = search.lower()
        filtered = [r for r in filtered if 
                   search_lower in r.get('driverName', '').lower()]
    
    if status != 'all':
        filtered = [r for r in filtered if r.get('paymentStatus') == status]
    
    if driver_id != 'all':
        filtered = [r for r in filtered if r.get('driverId') == driver_id]
    
    if pay_period != 'all':
        filtered = [r for r in filtered if r.get('payPeriod') == pay_period]
    
    if date_range == 'custom' and start_date and end_date:
        # Parse dates for comparison
        start_obj = parse_date(start_date)
        end_obj = parse_date(end_date)
        
        if start_obj and end_obj:
            filtered = [r for r in filtered if 
                       start_obj <= parse_date(r.get('paymentDate')) <= end_obj]
    
    return filtered