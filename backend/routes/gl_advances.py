import traceback
from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
import datetime
import uuid
from decorators import superadmin_required
import firebase_admin
from firebase_admin import db

gl_advances_bp = Blueprint('gl_advances', __name__)

# Helper functions
def get_advances_ref():
    return db.reference('advances')

def get_admins_ref():
    return db.reference('admins')

def get_drivers_ref():
    return db.reference('users')

def get_drivers_root_ref():
    """Get reference to the drivers root node (separate from users)"""
    return db.reference('drivers')

# Helper function to get employee name from either admins or drivers
def get_employee_name(emp_id):
    """Get employee name from either admins or drivers"""
    # Try admins first
    admins_ref = get_admins_ref()
    admin_data = admins_ref.child(emp_id).get()
    if admin_data and admin_data.get('info'):
        info = admin_data.get('info', {})
        return info.get('fullName', 'Unknown')
    
    # Try drivers (from users node)
    drivers_ref = get_drivers_ref()
    driver_data = drivers_ref.child(emp_id).get()
    if driver_data and driver_data.get('role') == 'driver':
        first_name = driver_data.get('firstName', '')
        middle_name = driver_data.get('middleName', '')
        last_name = driver_data.get('lastName', '')
        
        # Construct full name
        name_parts = []
        if first_name:
            name_parts.append(first_name)
        if middle_name:
            name_parts.append(middle_name)
        if last_name:
            name_parts.append(last_name)
        return ' '.join(name_parts).strip() or 'Unknown Driver'
    
    return 'Unknown'

# Helper function to get department
def get_employee_department(emp_id):
    """Get department from either admins or drivers"""
    # Try admins first
    admins_ref = get_admins_ref()
    admin_data = admins_ref.child(emp_id).get()
    if admin_data and admin_data.get('info'):
        info = admin_data.get('info', {})
        return info.get('department', 'admin')
    
    # Try drivers
    drivers_ref = get_drivers_ref()
    driver_data = drivers_ref.child(emp_id).get()
    if driver_data and driver_data.get('role') == 'driver':
        return 'operations'
    
    return 'N/A'

# Helper function to check if employee is a driver
def is_driver(emp_id):
    """Check if an employee ID belongs to a driver"""
    drivers_ref = get_drivers_ref()
    driver_data = drivers_ref.child(emp_id).get()
    return driver_data and driver_data.get('role') == 'driver'

# Get all advances
@gl_advances_bp.route('/api/advances', methods=['GET'])
@superadmin_required
def get_advances():
    try:
        # Get query parameters
        search = request.args.get('search', '')
        status = request.args.get('status', 'all')
        employee_id = request.args.get('employeeId', 'all')
        repayment_period = request.args.get('repaymentPeriod', 'all')
        date_range = request.args.get('dateRange', 'all')
        start_date = request.args.get('startDate', '')
        end_date = request.args.get('endDate', '')
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 10))
        
        # Get advances from Firebase
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        # Combine data
        records = []
        for adv_id, adv_data in all_advances.items():
            if not adv_data or not isinstance(adv_data, dict):
                continue
                
            emp_id = adv_data.get('employeeId')
            
            # Use stored employeeName if available, otherwise get it
            if adv_data.get('employeeName'):
                employee_name = adv_data.get('employeeName')
                department = adv_data.get('department', get_employee_department(emp_id))
            else:
                employee_name = get_employee_name(emp_id)
                department = get_employee_department(emp_id)
            
            record = {
                'id': adv_id,
                'employeeId': emp_id,
                'employeeName': employee_name,
                'department': department,
                **adv_data
            }
            records.append(record)
        
        # Apply filters
        filtered = filter_advances(records, search, status, employee_id, 
                                   repayment_period, date_range, start_date, end_date)
        
        # Pagination
        total = len(filtered)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated = filtered[start_idx:end_idx]
        
        return jsonify({
            'success': True,
            'data': paginated,
            'total': total,
            'page': page,
            'total_pages': (total + limit - 1) // limit
        })
        
    except Exception as e:
        print(f"Error in get_advances: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get single advance
@gl_advances_bp.route('/api/advances/<advance_id>', methods=['GET'])
@superadmin_required
def get_advance(advance_id):
    try:
        advance_ref = get_advances_ref().child(advance_id)
        advance = advance_ref.get()
        
        if not advance:
            return jsonify({'success': False, 'error': 'Advance not found'}), 404
        
        # Get employee info
        emp_id = advance.get('employeeId')
        
        # Use stored employeeName if available, otherwise get it
        if advance.get('employeeName'):
            employee_name = advance.get('employeeName')
            department = advance.get('department', get_employee_department(emp_id))
        else:
            employee_name = get_employee_name(emp_id)
            department = get_employee_department(emp_id)
        
        advance['employeeName'] = employee_name
        advance['department'] = department
        
        return jsonify({'success': True, 'data': advance})
        
    except Exception as e:
        print(f"Error in get_advance: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Create advance request
@gl_advances_bp.route('/api/advances', methods=['POST'])
@superadmin_required
def create_advance():
    try:
        data = request.json
        
        required_fields = ['employeeId', 'amount', 'reason', 'repaymentPeriod']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Get employee name and department
        emp_id = data['employeeId']
        employee_name = get_employee_name(emp_id)
        department = get_employee_department(emp_id)
        
        # Determine if this is a driver or admin
        is_driver_flag = is_driver(emp_id)
        
        print(f"Creating advance for {'driver' if is_driver_flag else 'admin'} ID: {emp_id}, name: {employee_name}")
        
        # Calculate repayment amount
        amount = float(data['amount'])
        repayment_period = data['repaymentPeriod']
        repayment_amount = data.get('repaymentAmount')
        
        if not repayment_amount:
            if repayment_period == 'Next Payroll':
                repayment_amount = amount
                num_payments = 1
            elif repayment_period == '2 Cutoffs':
                repayment_amount = amount / 2
                num_payments = 2
            elif repayment_period == '3 Cutoffs':
                repayment_amount = amount / 3
                num_payments = 3
            elif repayment_period == '4 Cutoffs':
                repayment_amount = amount / 4
                num_payments = 4
            else:
                repayment_amount = amount
                num_payments = 1
        
        # Create payment schedule
        payment_schedule = []
        if repayment_period != 'Custom' and repayment_period != 'Next Payroll':
            due_date = datetime.datetime.now()
            for i in range(num_payments):
                due_date = due_date + datetime.timedelta(days=15)
                payment_schedule.append({
                    'dueDate': due_date.isoformat(),
                    'amount': repayment_amount,
                    'status': 'pending',
                    'paidDate': None
                })
        
        advance_data = {
            'employeeId': emp_id,
            'employeeName': employee_name,
            'department': department,
            'employeeType': 'driver' if is_driver_flag else 'admin',
            'amount': amount,
            'reason': data['reason'],
            'repaymentPeriod': repayment_period,
            'repaymentAmount': repayment_amount,
            'paidAmount': 0,
            'remainingBalance': amount,
            'status': 'pending',
            'dateRequested': datetime.datetime.now().isoformat(),
            'paymentSchedule': payment_schedule,
            'notes': data.get('notes', ''),
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system')
        }
        
        # Save to Firebase (main advances collection)
        advances_ref = get_advances_ref()
        new_advance = advances_ref.push(advance_data)
        
        print(f"Created advance for {employee_name} with ID: {new_advance.key}")
        
        # Update employee's advances history in the CORRECT location
        if is_driver_flag:
            # Store in /drivers/{driverId}/advancesHistory
            try:
                drivers_root_ref = get_drivers_root_ref()
                
                # Get driver data from users node for additional info
                drivers_ref = get_drivers_ref()
                driver_data = drivers_ref.child(emp_id).get() or {}
                
                # Store basic driver info if not exists
                driver_info_ref = drivers_root_ref.child(emp_id).child('info')
                if not driver_info_ref.get():
                    driver_info_ref.set({
                        'uid': emp_id,
                        'name': employee_name,
                        'role': 'driver',
                        'firstName': driver_data.get('firstName', ''),
                        'middleName': driver_data.get('middleName', ''),
                        'lastName': driver_data.get('lastName', ''),
                        'createdAt': datetime.datetime.now().isoformat()
                    })
                
                # Store the advance in /drivers/{driverId}/advancesHistory
                driver_history_ref = drivers_root_ref.child(emp_id).child('advancesHistory').child(new_advance.key)
                driver_history_ref.set({
                    'amount': amount,
                    'status': 'pending',
                    'dateRequested': advance_data['dateRequested'],
                    'advanceId': new_advance.key,
                    'repaymentPeriod': repayment_period,
                    'remainingBalance': amount
                })
                    
                print(f"Stored advance in /drivers/{emp_id}/advancesHistory")
            except Exception as e:
                print(f"Error storing in drivers history: {e}")
                traceback.print_exc()
        else:
            # Store in /admins/{adminId}/advancesHistory
            try:
                admin_history_ref = get_admins_ref().child(emp_id).child('advancesHistory').child(new_advance.key)
                admin_history_ref.set({
                    'amount': amount,
                    'status': 'pending',
                    'dateRequested': advance_data['dateRequested'],
                    'advanceId': new_advance.key,
                    'repaymentPeriod': repayment_period,
                    'remainingBalance': amount
                })
                print(f"Stored advance in /admins/{emp_id}/advancesHistory")
            except Exception as e:
                print(f"Error storing in admins history: {e}")
                traceback.print_exc()
        
        return jsonify({
            'success': True,
            'message': 'Advance request submitted',
            'data': {'id': new_advance.key, 'employeeName': employee_name}
        }), 201
        
    except Exception as e:
        print(f"Error in create_advance: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Approve/reject advance
@gl_advances_bp.route('/api/advances/<advance_id>/approve', methods=['PUT'])
@superadmin_required
def approve_advance(advance_id):
    try:
        data = request.json
        status = data.get('status')
        
        if status not in ['approved', 'rejected']:
            return jsonify({'success': False, 'error': 'Invalid status'}), 400
        
        advance_ref = get_advances_ref().child(advance_id)
        advance = advance_ref.get()
        
        if not advance:
            return jsonify({'success': False, 'error': 'Advance not found'}), 404
        
        update_data = {
            'status': status,
            'notes': data.get('notes', advance.get('notes', ''))
        }
        
        if status == 'approved':
            update_data['dateApproved'] = data.get('approvalDate', datetime.datetime.now().isoformat())
        elif status == 'rejected':
            update_data['dateRejected'] = datetime.datetime.now().isoformat()
        
        update_data['updatedAt'] = datetime.datetime.now().isoformat()
        update_data['updatedBy'] = session.get('user_id', 'system')
        
        advance_ref.update(update_data)
        
        # Update employee's history in the correct location
        emp_id = advance.get('employeeId')
        employee_type = advance.get('employeeType')
        
        # If employeeType not stored, determine it
        if not employee_type:
            employee_type = 'driver' if is_driver(emp_id) else 'admin'
        
        if emp_id:
            try:
                if employee_type == 'driver':
                    # Update in /drivers
                    drivers_root_ref = get_drivers_root_ref()
                    history_ref = drivers_root_ref.child(emp_id).child('advancesHistory').child(advance_id)
                    if history_ref.get():
                        history_ref.update({'status': status})
                        print(f"Updated driver advance history for {emp_id}")
                else:
                    # Update in /admins
                    admin_history_ref = get_admins_ref().child(emp_id).child('advancesHistory').child(advance_id)
                    if admin_history_ref.get():
                        admin_history_ref.update({'status': status})
                        print(f"Updated admin advance history for {emp_id}")
            except Exception as e:
                print(f"Error updating history: {e}")
                pass
        
        return jsonify({
            'success': True,
            'message': f'Advance {status} successfully'
        })
        
    except Exception as e:
        print(f"Error in approve_advance: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Record payment
@gl_advances_bp.route('/api/advances/<advance_id>/payment', methods=['POST'])
@superadmin_required
def record_payment(advance_id):
    try:
        data = request.json
        
        required_fields = ['amount', 'paymentDate', 'paymentMethod']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        advance_ref = get_advances_ref().child(advance_id)
        advance = advance_ref.get()
        
        if not advance:
            return jsonify({'success': False, 'error': 'Advance not found'}), 404
        
        amount = float(data['amount'])
        paid_amount = advance.get('paidAmount', 0) + amount
        remaining = advance.get('remainingBalance', advance['amount']) - amount
        
        update_data = {
            'paidAmount': paid_amount,
            'remainingBalance': remaining,
            'updatedAt': datetime.datetime.now().isoformat()
        }
        
        # Update status
        if remaining <= 0:
            update_data['status'] = 'paid'
            update_data['datePaid'] = data['paymentDate']
        else:
            update_data['status'] = 'partially-paid'
        
        # Add payment record
        payments = advance.get('payments', [])
        payments.append({
            'amount': amount,
            'date': data['paymentDate'],
            'method': data['paymentMethod'],
            'reference': data.get('reference', ''),
            'recordedBy': session.get('user_id', 'system'),
            'recordedAt': datetime.datetime.now().isoformat()
        })
        update_data['payments'] = payments
        
        # Update payment schedule if exists
        schedule = advance.get('paymentSchedule', [])
        if schedule:
            for i, payment in enumerate(schedule):
                if payment.get('status') == 'pending' and abs(payment.get('amount') - amount) < 0.01:
                    schedule[i]['status'] = 'paid'
                    schedule[i]['paidDate'] = data['paymentDate']
                    schedule[i]['linkedSalaryRecord'] = data.get('linkedSalaryRecord', '')
                    break
            update_data['paymentSchedule'] = schedule
        
        advance_ref.update(update_data)
        
        # Also update the history with new paid amount if needed
        emp_id = advance.get('employeeId')
        employee_type = advance.get('employeeType')
        
        if not employee_type:
            employee_type = 'driver' if is_driver(emp_id) else 'admin'
        
        if emp_id:
            try:
                if employee_type == 'driver':
                    drivers_root_ref = get_drivers_root_ref()
                    history_ref = drivers_root_ref.child(emp_id).child('advancesHistory').child(advance_id)
                    if history_ref.get():
                        history_ref.update({
                            'remainingBalance': remaining,
                            'status': update_data['status']
                        })
                else:
                    admin_history_ref = get_admins_ref().child(emp_id).child('advancesHistory').child(advance_id)
                    if admin_history_ref.get():
                        admin_history_ref.update({
                            'remainingBalance': remaining,
                            'status': update_data['status']
                        })
            except Exception as e:
                print(f"Error updating history with payment: {e}")
                pass
        
        return jsonify({
            'success': True,
            'message': 'Payment recorded successfully'
        })
        
    except Exception as e:
        print(f"Error in record_payment: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get all employees (admins and drivers) for dropdown
@gl_advances_bp.route('/api/advances/employees', methods=['GET'])
@superadmin_required
def get_employees():
    try:
        admins_ref = get_admins_ref()
        drivers_ref = get_drivers_ref()
        
        all_employees = []
        
        # Get admin employees
        admins_data = admins_ref.get() or {}
        for emp_id, emp_data in admins_data.items():
            info = emp_data.get('info', {})
            if info.get('status') == 'active':
                all_employees.append({
                    'id': emp_id,
                    'name': info.get('fullName', 'Unknown'),
                    'position': info.get('position', 'Admin Staff'),
                    'department': info.get('department', 'admin'),
                    'type': 'admin',
                    'baseSalary': info.get('baseSalary', 0)
                })
        
        # Get drivers
        drivers_data = drivers_ref.get() or {}
        for driver_id, driver_data in drivers_data.items():
            if driver_data.get('role') == 'driver':
                first_name = driver_data.get('firstName', '')
                middle_name = driver_data.get('middleName', '')
                last_name = driver_data.get('lastName', '')
                
                # Construct full name
                name_parts = []
                if first_name:
                    name_parts.append(first_name)
                if middle_name:
                    name_parts.append(middle_name)
                if last_name:
                    name_parts.append(last_name)
                full_name = ' '.join(name_parts).strip()
                
                all_employees.append({
                    'id': driver_id,
                    'name': full_name or 'Unknown Driver',
                    'position': 'Driver',
                    'department': 'operations',
                    'type': 'driver',
                    'baseSalary': 0
                })
        
        # Sort by name
        all_employees.sort(key=lambda x: x['name'])
        
        return jsonify({'success': True, 'data': all_employees})
        
    except Exception as e:
        print(f"Error in get_employees: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get advance history for a specific employee
@gl_advances_bp.route('/api/advances/history/<employee_id>', methods=['GET'])
@superadmin_required
def get_advances_history(employee_id):
    try:
        # Determine if this is a driver or admin
        is_driver_flag = is_driver(employee_id)
        history = {}
        
        if is_driver_flag:
            # Get from drivers node
            drivers_root_ref = get_drivers_root_ref()
            driver_data = drivers_root_ref.child(employee_id).get()
            if driver_data:
                history = driver_data.get('advancesHistory', {})
        else:
            # Get from admins node
            admins_ref = get_admins_ref()
            admin_data = admins_ref.child(employee_id).get()
            if admin_data:
                history = admin_data.get('advancesHistory', {})
        
        # Get full advance details from main advances collection
        advances_ref = get_advances_ref()
        records = []
        for hist_id, hist_data in history.items():
            advance_id = hist_data.get('advanceId', hist_id)
            full_advance = advances_ref.child(advance_id).get() or {}
            records.append({
                'id': advance_id,
                **full_advance,
                **hist_data
            })
        
        records.sort(key=lambda x: x.get('dateRequested', ''), reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        print(f"Error in get_advances_history: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get summary
@gl_advances_bp.route('/api/advances/summary', methods=['GET'])
@superadmin_required
def get_summary():
    try:
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        total = 0
        approved_total = 0
        approved_count = 0
        pending_total = 0
        pending_count = 0
        outstanding = 0
        
        for adv in all_advances.values():
            if not adv or not isinstance(adv, dict):
                continue
                
            amount = adv.get('amount', 0)
            total += amount
            
            status = adv.get('status')
            if status == 'approved':
                approved_total += amount
                approved_count += 1
                outstanding += adv.get('remainingBalance', amount)
            elif status == 'pending':
                pending_total += amount
                pending_count += 1
            elif status == 'partially-paid':
                outstanding += adv.get('remainingBalance', 0)
        
        summary = {
            'totalAdvances': total,
            'approvedAmount': approved_total,
            'approvedCount': approved_count,
            'pendingAmount': pending_total,
            'pendingCount': pending_count,
            'outstandingBalance': outstanding
        }
        
        return jsonify({'success': True, 'data': summary})
        
    except Exception as e:
        print(f"Error in get_summary: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get analytics
@gl_advances_bp.route('/api/advances/analytics', methods=['GET'])
@superadmin_required
def get_analytics():
    try:
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        # Status distribution
        status_counts = {'pending': 0, 'approved': 0, 'rejected': 0, 'paid': 0, 'partially-paid': 0}
        
        # Monthly trend
        months = []
        monthly_data = []
        today = datetime.datetime.now()
        for i in range(5, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            month_name = month_date.strftime('%b %Y')
            months.append(month_name)
            monthly_data.append(0)
        
        # Employee totals
        emp_totals = {}
        
        # Upcoming repayments
        upcoming = []
        
        for adv_id, adv in all_advances.items():
            if not adv or not isinstance(adv, dict):
                continue
                
            status = adv.get('status', 'pending')
            if status in status_counts:
                status_counts[status] += 1
            
            amount = adv.get('amount', 0)
            
            # Monthly trend
            date_str = adv.get('dateRequested', '')
            if date_str:
                try:
                    adv_date = datetime.datetime.fromisoformat(date_str)
                    month_key = adv_date.strftime('%b %Y')
                    if month_key in months:
                        idx = months.index(month_key)
                        monthly_data[idx] += amount
                except:
                    pass
            
            # Employee totals - use stored employeeName
            emp_name = adv.get('employeeName', 'Unknown')
            emp_dept = adv.get('department', 'N/A')
            
            if emp_name not in emp_totals:
                emp_totals[emp_name] = {
                    'name': emp_name,
                    'total': 0,
                    'department': emp_dept
                }
            emp_totals[emp_name]['total'] += amount
            
            # Upcoming repayments - use stored employeeName
            if adv.get('status') in ['approved', 'partially-paid']:
                schedule = adv.get('paymentSchedule', [])
                if schedule and isinstance(schedule, list):
                    for payment in schedule:
                        if payment and isinstance(payment, dict) and payment.get('status') == 'pending':
                            upcoming.append({
                                'employeeName': emp_name,
                                'amount': payment.get('amount', 0),
                                'dueDate': payment.get('dueDate', '')
                            })
        
        # Top employees
        top_employees = []
        for emp_name, data in sorted(emp_totals.items(), key=lambda x: x[1]['total'], reverse=True)[:5]:
            top_employees.append({
                'name': data['name'],
                'department': data['department'],
                'total': data['total']
            })
        
        # Sort upcoming repayments by due date
        upcoming.sort(key=lambda x: x.get('dueDate', ''))
        upcoming = upcoming[:10]
        
        analytics = {
            'statusDistribution': {
                'labels': list(status_counts.keys()),
                'data': list(status_counts.values())
            },
            'monthlyTrend': {
                'labels': months,
                'data': monthly_data
            },
            'topEmployees': top_employees,
            'upcomingRepayments': upcoming
        }
        
        return jsonify({'success': True, 'data': analytics})
        
    except Exception as e:
        print(f"Error in get_analytics: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Filter helper
def filter_advances(records, search, status, employee_id, repayment_period, date_range, start_date, end_date):
    filtered = records.copy()
    
    if search:
        search_lower = search.lower()
        filtered = [r for r in filtered if 
                   search_lower in r.get('employeeName', '').lower() or
                   search_lower in r.get('reason', '').lower()]
    
    if status != 'all':
        filtered = [r for r in filtered if r.get('status') == status]
    
    if employee_id != 'all':
        filtered = [r for r in filtered if r.get('employeeId') == employee_id]
    
    if repayment_period != 'all':
        filtered = [r for r in filtered if r.get('repaymentPeriod') == repayment_period]
    
    if date_range == 'custom' and start_date and end_date:
        filtered = [r for r in filtered if 
                   start_date <= r.get('dateRequested', '')[:10] <= end_date]
    
    return filtered