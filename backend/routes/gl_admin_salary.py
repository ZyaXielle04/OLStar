from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
import datetime
import calendar
from decorators import login_required, admin_required
import firebase_admin
from firebase_admin import db

gl_admin_salary_bp = Blueprint('gl_admin_salary', __name__)

# ==================== HELPER FUNCTIONS ====================

def get_cutoff_periods(year=None, month=None):
    """Generate cutoff periods for a given month/year"""
    if not year:
        year = datetime.datetime.now().year
    if not month:
        month = datetime.datetime.now().month
    
    month_name = datetime.datetime(year, month, 1).strftime('%B')
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

def calculate_salary_from_dtr(entries, daily_rate, hourly_rate, ot_rate, night_diff_rate, cutoff=None):
    """
    Calculate all salary components from DTR entries
    hourly_rate = 70 per hour
    ot_rate = 14 per hour (20% of hourly rate)
    night_diff_rate = 10 per hour
    """
    summary = {
        'totalDays': 0,
        'totalHours': 0,
        'totalOT': 0,
        'totalNightDiff': 0,
        'totalAdvances': 0,
        'grossSalary': 0,
        'regularPay': 0,
        'otPay': 0,
        'nightDiffPay': 0,
        'advances': 0,
        'otherDeductions': 0,
        'sss': 0,
        'philhealth': 0,
        'pagibig': 0,
        'benefitsDeduction': 0,
        'netTotal': 0
    }
    
    # Determine if this is 2nd cutoff (where deductions apply)
    is_second_cutoff = False
    if cutoff and '2nd Half' in cutoff:
        is_second_cutoff = True
    
    for date, entry in entries.items():
        if entry.get('status') == 'present':
            summary['totalDays'] += 1
            
            # Get time in and out
            time_in = entry.get('timeIn', '')
            time_out = entry.get('timeOut', '')
            
            # Calculate hours worked
            total_hours = 8  # Default 8 hours
            if time_in and time_out:
                # Parse times
                start_h, start_m = map(int, time_in.split(':'))
                end_h, end_m = map(int, time_out.split(':'))
                
                start_minutes = start_h * 60 + start_m
                end_minutes = end_h * 60 + end_m
                
                # Handle overnight shifts
                if end_minutes < start_minutes:
                    end_minutes += 24 * 60
                
                total_minutes = end_minutes - start_minutes
                total_hours = total_minutes / 60
            
            # Regular hours (up to 8 hours)
            regular_hours = min(total_hours, 8)
            summary['totalHours'] += regular_hours
            summary['regularPay'] += regular_hours * hourly_rate
            
            # Overtime (20% of hourly rate = ₱14)
            ot_hours = float(entry.get('ot', 0) or 0)
            if ot_hours > 0:
                summary['totalOT'] += ot_hours
                summary['otPay'] += ot_hours * ot_rate  # 14 per hour
            
            # Night Differential (₱10 per hour)
            night_diff_hours = float(entry.get('nightDiff', 0) or 0)
            if night_diff_hours > 0:
                summary['totalNightDiff'] += night_diff_hours
                summary['nightDiffPay'] += night_diff_hours * night_diff_rate  # 10 per hour
            
            # Advances
            advance = float(entry.get('advance', 0) or 0)
            if advance > 0:
                summary['totalAdvances'] += advance
                summary['advances'] += advance
    
    # Calculate gross salary
    summary['grossSalary'] = summary['regularPay'] + summary['otPay'] + summary['nightDiffPay']
    
    # Note: SSS, PhilHealth, PAGIBIG will be set separately based on cutoff
    # For 1st cutoff, these should be 0
    # For 2nd cutoff, they should be the admin's deduction values
    
    return summary

def get_admins_ref():
    """Get Firebase reference for admins"""
    return db.reference('admins')

def get_dtr_records_ref():
    """Get Firebase reference for DTR records"""
    return db.reference('dtrRecords')

def get_advances_ref():
    """Get Firebase reference for advances"""
    return db.reference('advances')

def get_salary_history_ref():
    """Get Firebase reference for salary history"""
    return db.reference('salaryHistory')

# ==================== PAGE ROUTE ====================

@gl_admin_salary_bp.route('/admin/gl-admin-salary')
@login_required
@admin_required
def gl_admin_salary_page():
    """Render the DTR-based admin salary page"""
    return render_template('gl_admin_salary.html')

# ==================== EMPLOYEE ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/employees', methods=['GET'])
@admin_required
def get_employees():
    """Get all active admin employees"""
    try:
        admins_ref = get_admins_ref()
        admins_data = admins_ref.get() or {}
        
        employees = []
        for admin_id, admin_data in admins_data.items():
            info = admin_data.get('info', {})
            pay_rates = admin_data.get('payRates', {})
            
            # Only return active employees
            if info.get('status') != 'active':
                continue
            
            employee = {
                'id': admin_id,
                'name': info.get('fullName', 'Unknown'),
                'position': info.get('position', 'Staff'),
                'department': info.get('department', 'admin'),
                'baseSalary': 0,
                'email': info.get('email', ''),
                'phone': info.get('phone', ''),
                'hireDate': info.get('hireDate', ''),
                'status': info.get('status', 'active'),
                'dailyRate': pay_rates.get('dailyRate', 560),
                'hourlyRate': 70,
                'otRate': 14,
                'nightDiffRate': 10
            }
            employees.append(employee)
        
        employees.sort(key=lambda x: x['name'])
        return jsonify({'success': True, 'data': employees})
        
    except Exception as e:
        print(f"Error in get_employees: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/employees/all', methods=['GET'])
@admin_required
def get_all_employees():
    """Get ALL admin employees (including inactive/on-leave) for management"""
    try:
        admins_ref = get_admins_ref()
        admins_data = admins_ref.get() or {}
        
        employees = []
        for admin_id, admin_data in admins_data.items():
            info = admin_data.get('info', {})
            pay_rates = admin_data.get('payRates', {})
            
            employee = {
                'id': admin_id,
                'name': info.get('fullName', 'Unknown'),
                'position': info.get('position', 'Staff'),
                'department': info.get('department', 'admin'),
                'email': info.get('email', ''),
                'phone': info.get('phone', ''),
                'hireDate': info.get('hireDate', ''),
                'status': info.get('status', 'active'),
                'dailyRate': pay_rates.get('dailyRate', 560),
                'hourlyRate': 70,
                'otRate': 14,
                'nightDiffRate': 10,
                'sss': pay_rates.get('sss', 0),
                'philhealth': pay_rates.get('philhealth', 0),
                'pagibig': pay_rates.get('pagibig', 0)
            }
            employees.append(employee)
        
        employees.sort(key=lambda x: x['name'])
        return jsonify({'success': True, 'data': employees})
        
    except Exception as e:
        print(f"Error in get_all_employees: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/employees/<admin_id>', methods=['GET'])
@admin_required
def get_employee(admin_id):
    """Get single employee details"""
    try:
        admin_ref = get_admins_ref().child(admin_id)
        admin_data = admin_ref.get() or {}
        
        info = admin_data.get('info', {})
        pay_rates = admin_data.get('payRates', {})
        
        employee = {
            'id': admin_id,
            'name': info.get('fullName', 'Unknown'),
            'position': info.get('position', 'Staff'),
            'department': info.get('department', 'admin'),
            'email': info.get('email', ''),
            'phone': info.get('phone', ''),
            'hireDate': info.get('hireDate', ''),
            'status': info.get('status', 'active'),
            'address': info.get('address', ''),
            'emergencyContact': info.get('emergencyContact', ''),
            'dailyRate': pay_rates.get('dailyRate', 560),
            'hourlyRate': 70,
            'otRate': 14,
            'nightDiffRate': 10,
            'rateType': pay_rates.get('rateType', 'daily'),
            'effectiveDate': pay_rates.get('effectiveDate', ''),
            'sss': pay_rates.get('sss', 0),
            'philhealth': pay_rates.get('philhealth', 0),
            'pagibig': pay_rates.get('pagibig', 0),
            'cutoffRate': pay_rates.get('cutoffRate', 0),
            'monthlyRate': pay_rates.get('monthlyRate', 0)
        }
        
        return jsonify({'success': True, 'data': employee})
        
    except Exception as e:
        print(f"Error in get_employee: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/employees/<admin_id>/rates', methods=['GET'])
@admin_required
def get_employee_rates(admin_id):
    """Get employee pay rates for DTR form"""
    try:
        admin_ref = get_admins_ref().child(admin_id)
        admin_info = admin_ref.child('info').get()
        pay_rates = admin_ref.child('payRates').get() or {}
        
        if not admin_info:
            return jsonify({'success': False, 'error': 'Admin not found'}), 404
        
        daily_rate = pay_rates.get('dailyRate', 560)
        hourly_rate = 70
        ot_rate = 14
        night_diff_rate = 10
        
        return jsonify({
            'success': True,
            'data': {
                'dailyRate': daily_rate,
                'hourlyRate': hourly_rate,
                'otRate': ot_rate,
                'nightDiffRate': night_diff_rate,
                'sss': pay_rates.get('sss', 0),
                'philhealth': pay_rates.get('philhealth', 0),
                'pagibig': pay_rates.get('pagibig', 0)
            }
        })
        
    except Exception as e:
        print(f"Error in get_employee_rates: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== ADMIN MANAGEMENT ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/add-admin', methods=['POST'])
@admin_required
def add_admin():
    """Add new admin employee"""
    try:
        data = request.json
        
        required_fields = ['fullName', 'email', 'position', 'department', 'rateType']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Get deductions (default to 0 if not provided)
        sss = float(data.get('sss', 0))
        philhealth = float(data.get('philhealth', 0))
        pagibig = float(data.get('pagibig', 0))
        
        # Prepare admin data
        admin_data = {
            'info': {
                'fullName': data['fullName'],
                'email': data['email'],
                'position': data['position'],
                'department': data['department'],
                'phone': data.get('phone', ''),
                'hireDate': data.get('hireDate', datetime.datetime.now().strftime('%Y-%m-%d')),
                'status': data.get('status', 'active'),
                'address': data.get('address', ''),
                'emergencyContact': data.get('emergencyContact', ''),
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system'),
                'updatedAt': datetime.datetime.now().isoformat()
            },
            'payRates': {
                'rateType': data['rateType'],
                'effectiveDate': data.get('effectiveDate', datetime.datetime.now().strftime('%Y-%m-%d')),
                'dailyRate': float(data.get('dailyRate', 560)),
                'hourlyRate': 70,
                'otRate': 14,
                'nightDiffRate': 10,
                'cutoffRate': float(data.get('cutoffRate', 0)),
                'monthlyRate': float(data.get('monthlyRate', 0)),
                'sss': sss,
                'philhealth': philhealth,
                'pagibig': pagibig,
                'updatedAt': datetime.datetime.now().isoformat()
            },
            'salaryHistory': {},
            'deductionsHistory': {},
            'advancesHistory': {}
        }
        
        # Save to Firebase
        admins_ref = get_admins_ref()
        new_admin = admins_ref.push(admin_data)
        
        return jsonify({
            'success': True,
            'message': 'Admin added successfully',
            'data': {'id': new_admin.key}
        }), 201
        
    except Exception as e:
        print(f"Error in add_admin: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/update-admin/<admin_id>', methods=['PUT'])
@admin_required
def update_admin(admin_id):
    """Update admin information"""
    try:
        data = request.json
        
        required_fields = ['fullName', 'email', 'position', 'department', 'rateType']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        admin_ref = get_admins_ref().child(admin_id)
        
        if not admin_ref.get():
            return jsonify({'success': False, 'error': 'Admin not found'}), 404
        
        # Get deductions
        sss = float(data.get('sss', 0))
        philhealth = float(data.get('philhealth', 0))
        pagibig = float(data.get('pagibig', 0))
        
        # Update info
        info_data = {
            'fullName': data['fullName'],
            'email': data['email'],
            'position': data['position'],
            'department': data['department'],
            'phone': data.get('phone', ''),
            'hireDate': data.get('hireDate', ''),
            'status': data.get('status', 'active'),
            'address': data.get('address', ''),
            'emergencyContact': data.get('emergencyContact', ''),
            'updatedAt': datetime.datetime.now().isoformat(),
            'updatedBy': session.get('user_id', 'system')
        }
        
        # Update pay rates
        pay_rates_data = {
            'rateType': data['rateType'],
            'effectiveDate': data.get('effectiveDate', datetime.datetime.now().strftime('%Y-%m-%d')),
            'dailyRate': float(data.get('dailyRate', 560)),
            'hourlyRate': 70,
            'otRate': 14,
            'nightDiffRate': 10,
            'cutoffRate': float(data.get('cutoffRate', 0)),
            'monthlyRate': float(data.get('monthlyRate', 0)),
            'sss': sss,
            'philhealth': philhealth,
            'pagibig': pagibig,
            'updatedAt': datetime.datetime.now().isoformat()
        }
        
        admin_ref.child('info').update(info_data)
        admin_ref.child('payRates').update(pay_rates_data)
        
        return jsonify({'success': True, 'message': 'Admin updated successfully'})
        
    except Exception as e:
        print(f"Error in update_admin: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/delete-admin/<admin_id>', methods=['DELETE'])
@admin_required
def delete_admin(admin_id):
    """Permanently delete an admin and all associated records"""
    try:
        # Check if admin exists
        admin_ref = get_admins_ref().child(admin_id)
        admin_data = admin_ref.get()
        
        if not admin_data:
            return jsonify({'success': False, 'error': 'Admin not found'}), 404
        
        # Delete all DTR records for this admin
        dtr_ref = get_dtr_records_ref()
        all_records = dtr_ref.get() or {}
        
        deleted_dtr_count = 0
        for record_id, record in all_records.items():
            if record.get('adminId') == admin_id:
                dtr_ref.child(record_id).delete()
                deleted_dtr_count += 1
                
                # Also delete salary history for this record
                get_salary_history_ref().child(record_id).delete()
        
        # Delete all advances/utang transactions for this admin
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        deleted_advances_count = 0
        for advance_id, advance in all_advances.items():
            if advance.get('adminId') == admin_id:
                advances_ref.child(advance_id).delete()
                deleted_advances_count += 1
        
        # Finally, delete the admin record
        admin_ref.delete()
        
        print(f"Deleted admin {admin_id}: {deleted_dtr_count} DTR records, {deleted_advances_count} advances")
        
        return jsonify({
            'success': True,
            'message': f'Admin deleted successfully. Removed {deleted_dtr_count} DTR records and {deleted_advances_count} advances.',
            'data': {
                'deletedDTRRecords': deleted_dtr_count,
                'deletedAdvances': deleted_advances_count
            }
        })
        
    except Exception as e:
        print(f"Error in delete_admin: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== CUTOFF ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/cutoffs', methods=['GET'])
@admin_required
def get_cutoffs():
    """Get available cutoff periods"""
    try:
        year = request.args.get('year')
        month = request.args.get('month')
        
        if year and month:
            year = int(year)
            month = int(month)
            cutoffs = get_cutoff_periods(year, month)
            return jsonify({'success': True, 'data': cutoffs})
        
        # Return last 3 months by default
        today = datetime.datetime.now()
        periods = []
        for i in range(2, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            periods.append(get_cutoff_periods(month_date.year, month_date.month))
        
        return jsonify({'success': True, 'data': periods})
        
    except Exception as e:
        print(f"Error in get_cutoffs: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== DTR RECORDS ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/records', methods=['GET'])
@admin_required
def get_dtr_records():
    """Get DTR records with filters"""
    try:
        admin_id = request.args.get('adminId', 'all')
        cutoff = request.args.get('cutoff', 'all')
        status = request.args.get('status', 'all')
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 10))
        
        dtr_ref = get_dtr_records_ref()
        all_records = dtr_ref.get() or {}
        
        records = []
        for record_id, record in all_records.items():
            # Apply filters
            if admin_id != 'all' and record.get('adminId') != admin_id:
                continue
            if cutoff != 'all' and record.get('cutoff') != cutoff:
                continue
            if status != 'all' and record.get('status') != status:
                continue
            
            # Get admin info
            admin_ref = get_admins_ref().child(record['adminId']).child('info')
            admin = admin_ref.get() or {}
            
            records.append({
                'id': record_id,
                'adminName': admin.get('fullName', 'Unknown'),
                'adminPosition': admin.get('position', ''),
                **record
            })
        
        # Sort by date (newest first)
        records.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        
        # Pagination
        total = len(records)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_records = records[start_idx:end_idx]
        
        return jsonify({
            'success': True, 
            'data': paginated_records,
            'total': total,
            'page': page,
            'total_pages': (total + limit - 1) // limit if total > 0 else 1
        })
        
    except Exception as e:
        print(f"Error in get_dtr_records: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['GET'])
@admin_required
def get_dtr_record(record_id):
    """Get single DTR record"""
    try:
        dtr_ref = get_dtr_records_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Get admin info and rates
        admin_ref = get_admins_ref().child(record['adminId']).child('info')
        admin = admin_ref.get() or {}
        pay_rates = get_admins_ref().child(record['adminId']).child('payRates').get() or {}
        
        daily_rate = pay_rates.get('dailyRate', 560)
        hourly_rate = 70
        
        return jsonify({
            'success': True, 
            'data': {
                'id': record_id,
                'adminName': admin.get('fullName', 'Unknown'),
                'adminPosition': admin.get('position', ''),
                'dailyRate': daily_rate,
                'hourlyRate': hourly_rate,
                'otRate': 14,
                'nightDiffRate': 10,
                **record
            }
        })
        
    except Exception as e:
        print(f"Error in get_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records', methods=['POST'])
@admin_required
def create_dtr_record():
    """Create new DTR record"""
    try:
        data = request.json
        
        required_fields = ['adminId', 'cutoff', 'entries']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing {field}'}), 400
        
        # Get admin pay rates
        admin_ref = get_admins_ref().child(data['adminId'])
        admin_info = admin_ref.child('info').get()
        pay_rates = admin_ref.child('payRates').get() or {}
        
        if not admin_info:
            return jsonify({'success': False, 'error': 'Admin not found'}), 404
        
        # Use fixed rates
        daily_rate = pay_rates.get('dailyRate', 560)
        hourly_rate = 70
        ot_rate = 14
        night_diff_rate = 10
        
        # Calculate salary (without deductions first)
        summary = calculate_salary_from_dtr(
            data['entries'],
            daily_rate,
            hourly_rate,
            ot_rate,
            night_diff_rate,
            data['cutoff']  # Pass cutoff to determine if deductions apply
        )
        
        # Get admin deduction values
        admin_sss = pay_rates.get('sss', 0)
        admin_philhealth = pay_rates.get('philhealth', 0)
        admin_pagibig = pay_rates.get('pagibig', 0)
        
        # Determine if this is 2nd cutoff (deductions apply)
        is_second_cutoff = '2nd Half' in data['cutoff']
        
        # Override with user-provided deductions if any, otherwise apply logic
        if 'summary' in data and data['summary']:
            # Manual override - use provided values
            summary['sss'] = float(data['summary'].get('sss', 0))
            summary['philhealth'] = float(data['summary'].get('philhealth', 0))
            summary['pagibig'] = float(data['summary'].get('pagibig', 0))
            summary['otherDeductions'] = float(data['summary'].get('otherDeductions', 0))
        else:
            # Automatic deduction based on cutoff
            if is_second_cutoff:
                # Apply deductions for 2nd cutoff
                summary['sss'] = admin_sss
                summary['philhealth'] = admin_philhealth
                summary['pagibig'] = admin_pagibig
            else:
                # No deductions for 1st cutoff
                summary['sss'] = 0
                summary['philhealth'] = 0
                summary['pagibig'] = 0
            summary['otherDeductions'] = 0
        
        summary['benefitsDeduction'] = summary['sss'] + summary['philhealth'] + summary['pagibig']
        
        total_deductions = (summary['advances'] + summary['otherDeductions'] + 
                           summary['benefitsDeduction'])
        summary['netTotal'] = summary['grossSalary'] - total_deductions
        
        # Parse cutoff
        cutoff_parts = data['cutoff'].split(' - ')
        month_year = cutoff_parts[0].split()
        month = month_year[0]
        year = int(month_year[1])
        period = cutoff_parts[1]
        
        # Prepare record
        record_data = {
            'adminId': data['adminId'],
            'cutoff': data['cutoff'],
            'month': month,
            'year': year,
            'period': period,
            'entries': data['entries'],
            'summary': summary,
            'otherAdvances': data.get('otherAdvances', {
                'totalUtang': 0,
                'totalPaid': 0,
                'balanceUtang': 0,
                'transactions': {}
            }),
            'status': 'draft',
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system'),
            'updatedAt': datetime.datetime.now().isoformat()
        }
        
        # Save to Firebase
        dtr_ref = get_dtr_records_ref()
        new_record = dtr_ref.push(record_data)
        
        return jsonify({
            'success': True,
            'message': 'DTR record created',
            'data': {'id': new_record.key, **record_data}
        }), 201
        
    except Exception as e:
        print(f"Error creating DTR: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['PUT'])
@admin_required
def update_dtr_record(record_id):
    """Update DTR record"""
    try:
        data = request.json
        dtr_ref = get_dtr_records_ref().child(record_id)
        
        existing = dtr_ref.get()
        if not existing:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Get admin pay rates if entries changed
        if 'entries' in data:
            admin_ref = get_admins_ref().child(existing['adminId'])
            pay_rates = admin_ref.child('payRates').get() or {}
            
            daily_rate = pay_rates.get('dailyRate', 560)
            hourly_rate = 70
            ot_rate = 14
            night_diff_rate = 10
            
            # Use existing cutoff if not provided
            cutoff = data.get('cutoff', existing.get('cutoff'))
            
            summary = calculate_salary_from_dtr(
                data['entries'],
                daily_rate,
                hourly_rate,
                ot_rate,
                night_diff_rate,
                cutoff
            )
            
            # Get admin deduction values
            admin_sss = pay_rates.get('sss', 0)
            admin_philhealth = pay_rates.get('philhealth', 0)
            admin_pagibig = pay_rates.get('pagibig', 0)
            
            # Determine if this is 2nd cutoff
            is_second_cutoff = cutoff and '2nd Half' in cutoff
            
            # Preserve manual deduction overrides or apply automatic logic
            if 'summary' in data and data['summary']:
                # Manual override
                summary['sss'] = float(data['summary'].get('sss', summary['sss']))
                summary['philhealth'] = float(data['summary'].get('philhealth', summary['philhealth']))
                summary['pagibig'] = float(data['summary'].get('pagibig', summary['pagibig']))
                summary['otherDeductions'] = float(data['summary'].get('otherDeductions', 0))
            else:
                # Automatic deduction based on cutoff
                if is_second_cutoff:
                    summary['sss'] = admin_sss
                    summary['philhealth'] = admin_philhealth
                    summary['pagibig'] = admin_pagibig
                else:
                    summary['sss'] = 0
                    summary['philhealth'] = 0
                    summary['pagibig'] = 0
                summary['otherDeductions'] = 0
            
            summary['benefitsDeduction'] = summary['sss'] + summary['philhealth'] + summary['pagibig']
            
            total_deductions = (summary['advances'] + summary['otherDeductions'] + 
                               summary['benefitsDeduction'])
            summary['netTotal'] = summary['grossSalary'] - total_deductions
            
            data['summary'] = summary
        
        data['updatedAt'] = datetime.datetime.now().isoformat()
        data['updatedBy'] = session.get('user_id', 'system')
        
        dtr_ref.update(data)
        
        return jsonify({'success': True, 'message': 'DTR updated'})
        
    except Exception as e:
        print(f"Error in update_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>/approve', methods=['POST'])
@admin_required
def approve_dtr_record(record_id):
    """Approve DTR record for payment"""
    try:
        dtr_ref = get_dtr_records_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        update_data = {
            'status': 'approved',
            'approvedAt': datetime.datetime.now().isoformat(),
            'approvedBy': session.get('user_id', 'system')
        }
        
        dtr_ref.update(update_data)
        
        # Add to salary history
        history_ref = get_salary_history_ref()
        history_ref.child(record_id).set({
            'adminId': record['adminId'],
            'cutoff': record['cutoff'],
            'grossSalary': record['summary']['grossSalary'],
            'netTotal': record['summary']['netTotal'],
            'status': 'approved',
            'approvedAt': update_data['approvedAt'],
            'approvedBy': session.get('user_id', 'system')
        })
        
        return jsonify({'success': True, 'message': 'DTR approved'})
        
    except Exception as e:
        print(f"Error in approve_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>/pay', methods=['POST'])
@admin_required
def mark_dtr_paid(record_id):
    """Mark DTR record as paid"""
    try:
        data = request.json or {}
        dtr_ref = get_dtr_records_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        update_data = {
            'status': 'paid',
            'paidAt': datetime.datetime.now().isoformat(),
            'paidBy': session.get('user_id', 'system'),
            'paymentMethod': data.get('paymentMethod', 'bank-transfer')
        }
        
        dtr_ref.update(update_data)
        
        # Update salary history
        history_ref = get_salary_history_ref().child(record_id)
        history_ref.update({
            'status': 'paid',
            'paidAt': update_data['paidAt'],
            'paymentMethod': data.get('paymentMethod', 'bank-transfer')
        })
        
        return jsonify({'success': True, 'message': 'Payment recorded'})
        
    except Exception as e:
        print(f"Error in mark_dtr_paid: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['DELETE'])
@admin_required
def delete_dtr_record(record_id):
    """Delete DTR record"""
    try:
        dtr_ref = get_dtr_records_ref().child(record_id)
        record = dtr_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Only allow deletion of draft records
        if record.get('status') != 'draft':
            return jsonify({'success': False, 'error': 'Only draft records can be deleted'}), 400
        
        dtr_ref.delete()
        
        # Also delete from salary history if exists
        get_salary_history_ref().child(record_id).delete()
        
        return jsonify({'success': True, 'message': 'Record deleted'})
        
    except Exception as e:
        print(f"Error in delete_dtr_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== ADVANCES ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/advances', methods=['POST'])
@admin_required
def add_other_advance():
    """Add other advance (utang) transaction"""
    try:
        data = request.json
        required_fields = ['adminId', 'amount', 'type', 'cutoff']
        
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing {field}'}), 400
        
        # Save to advances collection
        advance_data = {
            'adminId': data['adminId'],
            'amount': float(data['amount']),
            'type': data['type'],
            'cutoff': data['cutoff'],
            'description': data.get('description', ''),
            'date': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system')
        }
        
        advances_ref = get_advances_ref()
        new_advance = advances_ref.push(advance_data)
        
        # Update DTR record if specified
        if data.get('dtrRecordId'):
            dtr_ref = get_dtr_records_ref().child(data['dtrRecordId']).child('otherAdvances').child('transactions')
            dtr_ref.child(new_advance.key).set({
                'amount': advance_data['amount'],
                'type': advance_data['type'],
                'date': advance_data['date'],
                'description': advance_data['description']
            })
            
            # Recalculate totals
            dtr = get_dtr_records_ref().child(data['dtrRecordId']).get()
            if dtr:
                total_utang = 0
                total_paid = 0
                transactions = dtr.get('otherAdvances', {}).get('transactions', {})
                for tid, trans in transactions.items():
                    if trans.get('type') == 'utang':
                        total_utang += trans.get('amount', 0)
                    elif trans.get('type') == 'payment':
                        total_paid += trans.get('amount', 0)
                
                get_dtr_records_ref().child(data['dtrRecordId']).child('otherAdvances').update({
                    'totalUtang': total_utang,
                    'totalPaid': total_paid,
                    'balanceUtang': total_utang - total_paid
                })
        
        return jsonify({'success': True, 'message': 'Advance recorded', 'data': {'id': new_advance.key}})
        
    except Exception as e:
        print(f"Error in add_other_advance: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@gl_admin_salary_bp.route('/api/admin-salary/advances/<transaction_id>', methods=['DELETE'])
@admin_required
def delete_advance_transaction(transaction_id):
    """Delete an advance transaction"""
    try:
        data = request.json
        dtr_record_id = data.get('dtrRecordId')
        
        if not dtr_record_id:
            return jsonify({'success': False, 'error': 'DTR record ID required'}), 400
        
        # Delete from advances collection
        advances_ref = get_advances_ref().child(transaction_id)
        advances_ref.delete()
        
        # Delete from DTR record
        dtr_ref = get_dtr_records_ref().child(dtr_record_id).child('otherAdvances').child('transactions').child(transaction_id)
        dtr_ref.delete()
        
        # Recalculate totals
        dtr = get_dtr_records_ref().child(dtr_record_id).get()
        if dtr:
            total_utang = 0
            total_paid = 0
            transactions = dtr.get('otherAdvances', {}).get('transactions', {})
            for tid, trans in transactions.items():
                if trans.get('type') == 'utang':
                    total_utang += trans.get('amount', 0)
                elif trans.get('type') == 'payment':
                    total_paid += trans.get('amount', 0)
            
            get_dtr_records_ref().child(dtr_record_id).child('otherAdvances').update({
                'totalUtang': total_utang,
                'totalPaid': total_paid,
                'balanceUtang': total_utang - total_paid
            })
        
        return jsonify({'success': True, 'message': 'Transaction deleted'})
        
    except Exception as e:
        print(f"Error in delete_advance_transaction: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== SUMMARY ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/summary', methods=['GET'])
@admin_required
def get_summary():
    """Get dashboard summary"""
    try:
        dtr_ref = get_dtr_records_ref()
        all_records = dtr_ref.get() or {}
        
        pending_approval = 0
        pending_payment = 0
        total_payroll = 0
        current_cutoff = None
        
        # Get current cutoff
        today = datetime.datetime.now()
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
                total_payroll += record.get('summary', {}).get('netTotal', 0)
        
        # Get active employees
        admins_ref = get_admins_ref()
        active_employees = 0
        for admin in (admins_ref.get() or {}).values():
            if admin.get('info', {}).get('status') == 'active':
                active_employees += 1
        
        return jsonify({
            'success': True,
            'data': {
                'activeEmployees': active_employees,
                'pendingApproval': pending_approval,
                'pendingPayment': pending_payment,
                'currentPayroll': total_payroll,
                'currentCutoff': current_cutoff
            }
        })
        
    except Exception as e:
        print(f"Error in get_summary: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ==================== HISTORY ENDPOINTS ====================

@gl_admin_salary_bp.route('/api/admin-salary/history/<admin_id>', methods=['GET'])
@admin_required
def get_admin_history(admin_id):
    """Get salary history for an admin"""
    try:
        salary_history = get_salary_history_ref().get() or {}
        
        records = []
        for record_id, record in salary_history.items():
            if record.get('adminId') == admin_id:
                # Get full DTR record for details
                dtr = get_dtr_records_ref().child(record_id).get()
                if dtr:
                    records.append({
                        'id': record_id,
                        'cutoff': dtr.get('cutoff'),
                        'netTotal': dtr.get('summary', {}).get('netTotal', 0),
                        'grossSalary': dtr.get('summary', {}).get('grossSalary', 0),
                        'status': dtr.get('status'),
                        'paidAt': dtr.get('paidAt'),
                        'approvedAt': dtr.get('approvedAt')
                    })
        
        records.sort(key=lambda x: x.get('paidAt') or x.get('approvedAt') or '', reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        print(f"Error in get_admin_history: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500