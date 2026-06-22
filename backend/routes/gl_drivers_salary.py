from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
from datetime import datetime, timedelta
import calendar
import re
from decorators import login_required, admin_required
import firebase_admin
from firebase_admin import db

gl_drivers_salary_bp = Blueprint('gl_drivers_salary', __name__)

# ==================== HELPER FUNCTIONS ====================

def get_cutoff_periods(year=None, month=None):
    """Generate cutoff periods for a given month/year"""
    if not year:
        year = datetime.now().year
    if not month:
        month = datetime.now().month
    
    month_name = datetime(year, month, 1).strftime('%B')
    last_day = calendar.monthrange(year, month)[1]
    
    return {
        '1st_half': {
            'name': f'{month_name} {year} - 1st Half',
            'start': f'{year}-{month:02d}-01',
            'end': f'{year}-{month:02d}-15',
            'days': 15
        },
        '2nd_half': {
            'name': f'{month_name} {year} - 2nd Half',
            'start': f'{year}-{month:02d}-16',
            'end': f'{year}-{month:02d}-{last_day}',
            'days': last_day - 15
        }
    }

def get_users_ref():
    """Get Firebase reference for users"""
    return db.reference('users')

def get_schedules_ref():
    """Get Firebase reference for schedules"""
    return db.reference('schedules')

def get_driver_dtr_ref():
    """Get Firebase reference for driver DTR records"""
    return db.reference('driverDTRRecords')

def parse_time(time_str):
    """Parse time string to decimal hours"""
    if not time_str:
        return None
    try:
        parts = time_str.split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        return hours + minutes / 60
    except:
        return None

def calculate_hours(start_time, end_time):
    """Calculate total hours worked"""
    if not start_time or not end_time:
        return 0
    
    start = parse_time(start_time)
    end = parse_time(end_time)
    
    if start is None or end is None:
        return 0
    
    hours = end - start
    if hours < 0:
        hours += 24
    
    return hours

def normalize_phone(phone):
    """Normalize PH mobile numbers so schedules and user profiles can match."""
    digits = re.sub(r'\D', '', str(phone or ''))
    if digits.startswith('63') and len(digits) == 12:
        return '0' + digits[2:]
    if digits.startswith('9') and len(digits) == 10:
        return '0' + digits
    return digits

def parse_amount(value):
    """Parse money/rate values that may contain peso signs, commas, or spaces."""
    if value in (None, ''):
        return 0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r'[^\d.-]', '', str(value))
    try:
        return float(cleaned) if cleaned else 0
    except ValueError:
        return 0

def parse_schedule_date(date_value):
    if not date_value:
        return None
    date_text = str(date_value).strip()
    for fmt in ('%Y-%m-%d', '%B %d, %Y', '%b %d, %Y'):
        try:
            return datetime.strptime(date_text, fmt)
        except ValueError:
            continue
    return None

def parse_cutoff_range(cutoff):
    cutoff_parts = cutoff.split(' - ')
    month_year = cutoff_parts[0].split()
    month = month_year[0]
    year = int(month_year[1])
    period = cutoff_parts[1]

    months = ['January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December']
    month_num = months.index(month) + 1

    if period == '1st Half':
        start_day = 1
        end_day = 15
    else:
        start_day = 16
        end_day = calendar.monthrange(year, month_num)[1]

    return month, year, period, month_num, start_day, end_day

def build_entries_for_cutoff(cutoff, trips, existing_entries=None):
    month, year, period, month_num, start_day, end_day = parse_cutoff_range(cutoff)
    entries = {}
    current_date = datetime(year, month_num, start_day)
    end_date_obj = datetime(year, month_num, end_day)
    existing_entries = existing_entries or {}

    while current_date <= end_date_obj:
        date_str = current_date.strftime('%Y-%m-%d')
        old_entry = existing_entries.get(date_str, {})
        entries[date_str] = {
            'date': date_str,
            'timeIn': '',
            'timeOut': '',
            'driverRate': 0,
            'amount': 0,
            'tripCount': 0,
            'advance': old_entry.get('advance', 0),
            'scheduleIds': []
        }
        current_date += timedelta(days=1)

    for trip in trips:
        if not trip.get('isCompleted', True):
            continue

        date_obj = parse_schedule_date(trip.get('date', ''))
        if not date_obj:
            continue
        date_str = date_obj.strftime('%Y-%m-%d')

        if date_str in entries:
            trip_time = trip.get('time', '')
            entries[date_str]['timeIn'] = trip_time.split(' - ')[0] if ' - ' in trip_time else ''
            entries[date_str]['timeOut'] = trip_time.split(' - ')[1] if ' - ' in trip_time else ''
            entries[date_str]['driverRate'] += trip.get('driverRate', 0)
            entries[date_str]['amount'] += trip.get('amount', 0)
            entries[date_str]['tripCount'] += 1
            entries[date_str]['scheduleIds'].append(trip.get('scheduleId', ''))

    return entries, month, year, period, start_day, end_day

def summarize_entries(entries):
    total_trips = 0
    total_driver_rate = 0
    total_amount = 0

    for entry in entries.values():
        total_trips += entry.get('tripCount', 0)
        total_driver_rate += entry.get('driverRate', 0)
        total_amount += entry.get('amount', 0)

    return {
        'totalTrips': total_trips,
        'totalDriverRate': total_driver_rate,
        'totalAmount': total_amount
    }

def calculate_driver_net(summary, deductions=None, transactions=None):
    deductions = deductions or {}
    transactions = transactions or {}
    gross = summary.get('totalDriverRate', 0)
    total_deductions = (
        deductions.get('sss', 0) +
        deductions.get('philhealth', 0) +
        deductions.get('pagibig', 0) +
        deductions.get('otherDeductions', 0) +
        transactions.get('totalPaid', 0)
    )
    return gross - total_deductions

def refresh_existing_driver_dtr(record_id, record, cutoff):
    """Refresh draft DTR trip totals from schedules while preserving edits."""
    if record.get('status') in ['approved', 'paid']:
        return record

    trips = get_driver_trips_for_cutoff(record.get('driverPhone', ''), cutoff, include_all=True)
    entries, month, year, period, start_day, end_day = build_entries_for_cutoff(
        cutoff,
        trips,
        record.get('entries', {})
    )
    summary = summarize_entries(entries)
    deductions = record.get('deductions', {})
    transactions = record.get('transactions', {})
    net_total = calculate_driver_net(summary, deductions, transactions)

    refreshed = {
        **record,
        'month': month,
        'year': year,
        'period': period,
        'startDay': start_day,
        'endDay': end_day,
        'entries': entries,
        'trips': trips,
        'summary': summary,
        'netTotal': net_total,
        'updatedAt': datetime.now().isoformat()
    }

    get_driver_dtr_ref().child(record_id).update({
        'month': month,
        'year': year,
        'period': period,
        'startDay': start_day,
        'endDay': end_day,
        'entries': entries,
        'trips': trips,
        'summary': summary,
        'netTotal': net_total,
        'updatedAt': refreshed['updatedAt']
    })

    return refreshed

# ==================== PAGE ROUTE ====================

@gl_drivers_salary_bp.route('/admin/gl-drivers-salary')
@login_required
@admin_required
def gl_drivers_salary_page():
    """Render the driver DTR page"""
    return render_template('gl_drivers_salary.html')

# ==================== DRIVER DTR ENDPOINTS ====================

@gl_drivers_salary_bp.route('/api/driver-dtr/drivers', methods=['GET'])
@admin_required
def get_drivers():
    """Get all drivers grouped by type"""
    try:
        users_ref = get_users_ref()
        all_users = users_ref.get() or {}
        
        drivers = {
            'main': [],
            'direct': [],
            'indirect': [],
            'others': []
        }
        
        for uid, user_data in all_users.items():
            if user_data.get('role') != 'driver':
                continue
            
            phone = user_data.get('phone', '')
            driver_type = user_data.get('driverType', 'others')
            
            driver_info = {
                'uid': uid,
                'firstName': user_data.get('firstName', ''),
                'middleName': user_data.get('middleName', ''),
                'lastName': user_data.get('lastName', ''),
                'phone': phone,
                'driverType': driver_type,
                'fullName': f"{user_data.get('firstName', '')} {user_data.get('lastName', '')}".strip(),
                'status': user_data.get('status', 'active'),
                'dailyRate': 500,
                'sss': user_data.get('sss', 0),
                'philhealth': user_data.get('philhealth', 0),
                'pagibig': user_data.get('pagibig', 0)
            }
            
            if driver_type == 'main':
                drivers['main'].append(driver_info)
            elif driver_type == 'direct':
                drivers['direct'].append(driver_info)
            elif driver_type == 'indirect':
                drivers['indirect'].append(driver_info)
            else:
                drivers['others'].append(driver_info)
        
        for key in drivers:
            drivers[key].sort(key=lambda x: x['fullName'])
        
        return jsonify({'success': True, 'data': drivers})
        
    except Exception as e:
        print(f"Error in get_drivers: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/records/<cutoff>/<driver_type>', methods=['GET'])
@admin_required
def get_driver_dtr_records(cutoff, driver_type):
    """Get all DTR records for a cutoff and driver type"""
    try:
        from urllib.parse import unquote
        cutoff = unquote(cutoff)
        
        dtr_ref = get_driver_dtr_ref()
        all_records = dtr_ref.get() or {}
        
        records = []
        for record_id, record in all_records.items():
            if record.get('cutoff') == cutoff and record.get('driverType') == driver_type:
                records.append({'id': record_id, **record})
        
        records.sort(key=lambda x: x.get('driverName', ''))
        
        return jsonify({
            'success': True,
            'data': records
        })
        
    except Exception as e:
        print(f"Error in get_driver_dtr_records: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/record/<record_id>', methods=['GET'])
@admin_required
def get_driver_dtr_record(record_id):
    """Get single driver DTR record"""
    try:
        dtr_ref = get_driver_dtr_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        return jsonify({'success': True, 'data': {'id': record_id, **record}})
        
    except Exception as e:
        print(f"Error in get_driver_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/record/<driver_id>/<cutoff>', methods=['GET'])
@admin_required
def get_or_create_driver_dtr(driver_id, cutoff):
    """Get or create a specific driver's DTR record for a cutoff"""
    try:
        from urllib.parse import unquote
        
        cutoff = unquote(cutoff)
        
        # Get driver info
        users_ref = get_users_ref()
        driver_data = users_ref.child(driver_id).get()
        
        if not driver_data or driver_data.get('role') != 'driver':
            return jsonify({'success': False, 'error': 'Driver not found'}), 404
        
        driver_name = f"{driver_data.get('firstName', '')} {driver_data.get('lastName', '')}".strip()
        driver_phone = driver_data.get('phone', '')
        driver_type = driver_data.get('driverType', 'others')
        
        # Check if record exists
        dtr_ref = get_driver_dtr_ref()
        all_records = dtr_ref.get() or {}
        
        existing_record = None
        existing_id = None
        for record_id, record in all_records.items():
            if (record.get('driverId') == driver_id and 
                record.get('cutoff') == cutoff):
                existing_record = record
                existing_id = record_id
                break
        
        if existing_record:
            existing_record = refresh_existing_driver_dtr(existing_id, existing_record, cutoff)
            return jsonify({
                'success': True,
                'data': {'id': existing_id, **existing_record},
                'isNew': False
            })
        
        # Create new record from trips
        trips = get_driver_trips_for_cutoff(driver_phone, cutoff, include_all=True)
        
        entries, month, year, period, start_day, end_day = build_entries_for_cutoff(cutoff, trips)
        summary = summarize_entries(entries)
        
        # Calculate net total (initially gross minus deductions)
        sss = driver_data.get('sss', 0)
        philhealth = driver_data.get('philhealth', 0)
        pagibig = driver_data.get('pagibig', 0)
        total_deductions = sss + philhealth + pagibig
        net_total = summary['totalDriverRate'] - total_deductions
        
        # Create new record
        new_record = {
            'driverId': driver_id,
            'driverName': driver_name,
            'driverPhone': driver_phone,
            'driverType': driver_type,
            'cutoff': cutoff,
            'month': month,
            'year': year,
            'period': period,
            'startDay': start_day,
            'endDay': end_day,
            'entries': entries,
            'trips': trips,
            'summary': {
                'totalTrips': summary['totalTrips'],
                'totalDriverRate': summary['totalDriverRate'],
                'totalAmount': summary['totalAmount']
            },
            'transactions': {
                'totalUtang': 0,
                'totalPaid': 0,
                'balanceUtang': 0,
                'list': {}
            },
            'deductions': {
                'sss': sss,
                'philhealth': philhealth,
                'pagibig': pagibig,
                'otherDeductions': 0
            },
            'netTotal': net_total,
            'status': 'draft',
            'createdAt': datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system'),
            'updatedAt': datetime.now().isoformat()
        }
        
        # Save to Firebase
        new_ref = dtr_ref.push(new_record)
        
        return jsonify({
            'success': True,
            'data': {'id': new_ref.key, **new_record},
            'isNew': True
        })
        
    except Exception as e:
        print(f"Error in get_or_create_driver_dtr: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

def get_driver_trips_for_cutoff(driver_phone, cutoff, include_all=False):
    """Get driver schedules in a cutoff. Payroll totals only use completed trips."""
    try:
        # Parse cutoff to get date range
        month, year, period, month_num, start_day, end_day = parse_cutoff_range(cutoff)
        start_date = f"{year}-{month_num:02d}-{start_day:02d}"
        end_date = f"{year}-{month_num:02d}-{end_day:02d}"
        normalized_driver_phone = normalize_phone(driver_phone)
        
        # Get all schedules
        schedules_ref = get_schedules_ref()
        all_schedules = schedules_ref.get() or {}
        
        trips = []
        for schedule_id, schedule in all_schedules.items():
            schedule_status = str(schedule.get('status') or 'Pending').strip()
            is_completed = schedule_status.lower() == 'completed'

            if not include_all and not is_completed:
                continue
            
            current = schedule.get('current', {})
            cell_phone = normalize_phone(current.get('cellPhone', ''))
            
            if cell_phone != normalized_driver_phone:
                continue
            
            schedule_date = schedule.get('date', '')
            if not schedule_date:
                continue
            
            try:
                date_obj = parse_schedule_date(schedule_date)
                if not date_obj:
                    continue
                
                date_str = date_obj.strftime('%Y-%m-%d')
                
                if start_date <= date_str <= end_date:
                    trips.append({
                        'scheduleId': schedule_id,
                        'date': schedule_date,
                        'time': schedule.get('time', ''),
                        'driverRate': parse_amount(schedule.get('driverRate', 0)),
                        'amount': parse_amount(schedule.get('amount', 0)),
                        'status': schedule_status,
                        'isCompleted': is_completed,
                        'clientName': schedule.get('clientName', ''),
                        'pickup': schedule.get('pickup', ''),
                        'dropOff': schedule.get('dropOff', ''),
                        'company': schedule.get('company', ''),
                        'transactionID': schedule.get('transactionID', schedule_id)
                    })
                    
            except Exception as e:
                print(f"Error parsing date {schedule_date}: {e}")
                continue
        
        # Sort trips by date
        trips.sort(key=lambda x: x['date'])
        
        return trips
        
    except Exception as e:
        print(f"Error in get_driver_trips_for_cutoff: {str(e)}")
        return []

@gl_drivers_salary_bp.route('/api/driver-dtr/record/<record_id>', methods=['PUT'])
@admin_required
def update_driver_dtr_record(record_id):
    """Update driver DTR record (entries, transactions, deductions)"""
    try:
        data = request.json
        dtr_ref = get_driver_dtr_ref().child(record_id)
        
        existing = dtr_ref.get()
        if not existing:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Update only allowed fields
        update_data = {}
        
        if 'entries' in data:
            update_data['entries'] = data['entries']
        
        if 'transactions' in data:
            update_data['transactions'] = data['transactions']
        
        if 'deductions' in data:
            update_data['deductions'] = data['deductions']
        
        # Recalculate summary based on entries and trips
        if 'entries' in data:
            total_trips = 0
            total_driver_rate = 0
            total_amount = 0
            
            for entry in data['entries'].values():
                total_trips += entry.get('tripCount', 0)
                total_driver_rate += entry.get('driverRate', 0)
                total_amount += entry.get('amount', 0)
            
            update_data['summary'] = {
                'totalTrips': total_trips,
                'totalDriverRate': total_driver_rate,
                'totalAmount': total_amount
            }
        
        # Calculate net total if deductions or transactions are present
        gross = update_data.get('summary', existing.get('summary', {})).get('totalDriverRate', 0)
        deductions = update_data.get('deductions', existing.get('deductions', {}))
        transactions = update_data.get('transactions', existing.get('transactions', {}))
        
        sss = deductions.get('sss', 0)
        philhealth = deductions.get('philhealth', 0)
        pagibig = deductions.get('pagibig', 0)
        other_deductions = deductions.get('otherDeductions', 0)
        bayad_utang = transactions.get('totalPaid', 0)
        
        total_deductions = sss + philhealth + pagibig + other_deductions + bayad_utang
        net_total = gross - total_deductions
        
        update_data['netTotal'] = net_total
        update_data['updatedAt'] = datetime.now().isoformat()
        update_data['updatedBy'] = session.get('user_id', 'system')
        
        dtr_ref.update(update_data)
        
        return jsonify({'success': True, 'message': 'Record updated'})
        
    except Exception as e:
        print(f"Error in update_driver_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/record/<record_id>/approve', methods=['POST'])
@admin_required
def approve_driver_dtr_record(record_id):
    """Approve driver DTR record"""
    try:
        dtr_ref = get_driver_dtr_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        update_data = {
            'status': 'approved',
            'approvedAt': datetime.now().isoformat(),
            'approvedBy': session.get('user_id', 'system')
        }
        
        dtr_ref.update(update_data)
        
        return jsonify({'success': True, 'message': 'Record approved'})
        
    except Exception as e:
        print(f"Error in approve_driver_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/record/<record_id>/pay', methods=['POST'])
@admin_required
def mark_driver_dtr_paid(record_id):
    """Mark driver DTR record as paid"""
    try:
        data = request.json or {}
        dtr_ref = get_driver_dtr_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        update_data = {
            'status': 'paid',
            'paidAt': datetime.now().isoformat(),
            'paidBy': session.get('user_id', 'system'),
            'paymentMethod': data.get('paymentMethod', 'bank-transfer')
        }
        
        dtr_ref.update(update_data)
        
        return jsonify({'success': True, 'message': 'Payment recorded'})
        
    except Exception as e:
        print(f"Error in mark_driver_dtr_paid: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/cutoffs', methods=['GET'])
@admin_required
def get_driver_cutoffs():
    """Get available cutoff periods"""
    try:
        year = request.args.get('year')
        month = request.args.get('month')
        
        if year and month:
            year = int(year)
            month = int(month)
            cutoffs = get_cutoff_periods(year, month)
            return jsonify({'success': True, 'data': cutoffs})
        
        today = datetime.now()
        periods = []
        for i in range(2, -1, -1):
            month_date = today - timedelta(days=30*i)
            periods.append(get_cutoff_periods(month_date.year, month_date.month))
        
        return jsonify({'success': True, 'data': periods})
        
    except Exception as e:
        print(f"Error in get_driver_cutoffs: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_drivers_salary_bp.route('/api/driver-dtr/summary', methods=['GET'])
@admin_required
def get_driver_dtr_summary():
    """Get dashboard summary for driver DTR"""
    try:
        dtr_ref = get_driver_dtr_ref()
        all_records = dtr_ref.get() or {}
        
        pending_approval = 0
        pending_payment = 0
        total_payroll = 0
        current_cutoff = None
        
        today = datetime.now()
        if today.day <= 15:
            current_cutoff = f"{today.strftime('%B %Y')} - 1st Half"
        else:
            current_cutoff = f"{today.strftime('%B %Y')} - 2nd Half"
        
        for record in all_records.values():
            if record.get('status') == 'draft':
                pending_approval += 1
            elif record.get('status') == 'approved':
                pending_payment += 1
            
            if record.get('cutoff') == current_cutoff:
                total_payroll += record.get('summary', {}).get('totalDriverRate', 0)
        
        # Get active drivers count
        users_ref = get_users_ref()
        active_drivers = 0
        for user in (users_ref.get() or {}).values():
            if user.get('role') == 'driver' and user.get('status') == 'active':
                active_drivers += 1
        
        return jsonify({
            'success': True,
            'data': {
                'activeDrivers': active_drivers,
                'pendingApproval': pending_approval,
                'pendingPayment': pending_payment,
                'currentPayroll': total_payroll,
                'currentCutoff': current_cutoff
            }
        })
        
    except Exception as e:
        print(f"Error in get_driver_dtr_summary: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500
    
@gl_drivers_salary_bp.route('/api/driver-dtr/records/generate/<cutoff>/<driver_type>', methods=['GET'])
@admin_required
def generate_driver_dtr_records(cutoff, driver_type):
    """Generate or get all DTR records for drivers of a specific type for a cutoff"""
    try:
        from urllib.parse import unquote
        
        cutoff = unquote(cutoff)
        
        # Get all drivers of the specified type
        users_ref = get_users_ref()
        all_users = users_ref.get() or {}
        
        drivers = []
        for uid, user_data in all_users.items():
            if user_data.get('role') != 'driver':
                continue
            
            user_driver_type = user_data.get('driverType', 'others')
            
            # Filter by driver type
            if driver_type == 'others':
                if user_driver_type not in ['main', 'direct', 'indirect']:
                    drivers.append({'uid': uid, 'data': user_data})
            elif user_driver_type == driver_type:
                drivers.append({'uid': uid, 'data': user_data})
        
        # Also include unmatched drivers (from schedules) for 'others' type
        if driver_type == 'others':
            # Get all schedules to find unmatched drivers
            schedules_ref = get_schedules_ref()
            all_schedules = schedules_ref.get() or {}
            
            # Parse cutoff to get date range
            cutoff_parts = cutoff.split(' - ')
            month_year = cutoff_parts[0].split(' ')
            month = month_year[0]
            year = int(month_year[1])
            period = cutoff_parts[1]
            
            months = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December']
            month_num = months.index(month) + 1
            
            if period == '1st Half':
                start_date = f"{year}-{month_num:02d}-01"
                end_date = f"{year}-{month_num:02d}-15"
            else:
                start_date = f"{year}-{month_num:02d}-16"
                last_day = calendar.monthrange(year, month_num)[1]
                end_date = f"{year}-{month_num:02d}-{last_day}"
            
            # Find all drivers who have trips but are not in users
            existing_driver_phones = set(normalize_phone(d['data'].get('phone', '')) for d in drivers)
            unmatched_drivers = {}
            
            for schedule_id, schedule in all_schedules.items():
                if str(schedule.get('status', '')).strip().lower() != 'completed':
                    continue
                
                schedule_date = schedule.get('date', '')
                if not schedule_date:
                    continue
                
                try:
                    date_obj = parse_schedule_date(schedule_date)
                    if not date_obj:
                        continue
                    
                    date_str = date_obj.strftime('%Y-%m-%d')
                    
                    if start_date <= date_str <= end_date:
                        current = schedule.get('current', {})
                        cell_phone = normalize_phone(current.get('cellPhone', ''))
                        driver_name = current.get('driverName', 'Unknown')
                        
                        if cell_phone and cell_phone not in existing_driver_phones:
                            unmatched_drivers[cell_phone] = {
                                'uid': f'unmatched_{cell_phone}',
                                'data': {
                                    'firstName': driver_name.split()[0] if driver_name else 'Unknown',
                                    'lastName': driver_name.split()[-1] if len(driver_name.split()) > 1 else '',
                                    'phone': cell_phone,
                                    'driverType': 'others',
                                    'status': 'inactive'
                                }
                            }
                except Exception as e:
                    print(f"Error processing schedule {schedule_id}: {e}")
                    continue
            
            # Add unmatched drivers
            for phone, driver in unmatched_drivers.items():
                drivers.append(driver)
        
        # Generate or fetch DTR records for each driver
        dtr_ref = get_driver_dtr_ref()
        all_records = dtr_ref.get() or {}
        
        records = []
        
        for driver in drivers:
            driver_id = driver['uid']
            driver_data = driver['data']
            driver_name = f"{driver_data.get('firstName', '')} {driver_data.get('lastName', '')}".strip()
            driver_phone = driver_data.get('phone', '')
            
            # Check if record exists
            existing_record = None
            existing_id = None
            for record_id, record in all_records.items():
                if (record.get('driverId') == driver_id and 
                    record.get('cutoff') == cutoff):
                    existing_record = record
                    existing_id = record_id
                    break
            
            if existing_record:
                existing_record = refresh_existing_driver_dtr(existing_id, existing_record, cutoff)
                records.append({'id': existing_id, **existing_record})
            else:
                # Create new record from trips
                trips = get_driver_trips_for_cutoff(driver_phone, cutoff, include_all=True)
                
                entries, month, year, period, start_day, end_day = build_entries_for_cutoff(cutoff, trips)
                summary = summarize_entries(entries)
                
                # Calculate net total (initially gross minus deductions)
                sss = driver_data.get('sss', 0)
                philhealth = driver_data.get('philhealth', 0)
                pagibig = driver_data.get('pagibig', 0)
                total_deductions = sss + philhealth + pagibig
                net_total = summary['totalDriverRate'] - total_deductions
                
                # Create new record
                new_record = {
                    'driverId': driver_id,
                    'driverName': driver_name,
                    'driverPhone': driver_phone,
                    'driverType': driver_type if driver_type != 'others' else driver_data.get('driverType', 'others'),
                    'cutoff': cutoff,
                    'month': month,
                    'year': year,
                    'period': period,
                    'startDay': start_day,
                    'endDay': end_day,
                    'entries': entries,
                    'trips': trips,
                    'summary': {
                        'totalTrips': summary['totalTrips'],
                        'totalDriverRate': summary['totalDriverRate'],
                        'totalAmount': summary['totalAmount']
                    },
                    'transactions': {
                        'totalUtang': 0,
                        'totalPaid': 0,
                        'balanceUtang': 0,
                        'list': {}
                    },
                    'deductions': {
                        'sss': sss,
                        'philhealth': philhealth,
                        'pagibig': pagibig,
                        'otherDeductions': 0
                    },
                    'netTotal': net_total,
                    'status': 'draft',
                    'createdAt': datetime.now().isoformat(),
                    'createdBy': session.get('user_id', 'system'),
                    'updatedAt': datetime.now().isoformat()
                }
                
                # Save to Firebase
                new_ref = dtr_ref.push(new_record)
                records.append({'id': new_ref.key, **new_record})
        
        # Sort records by driver name
        records.sort(key=lambda x: x.get('driverName', ''))
        
        return jsonify({
            'success': True,
            'data': records,
            'total': len(records)
        })
        
    except Exception as e:
        print(f"Error in generate_driver_dtr_records: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
