import traceback
from flask import Blueprint, render_template, jsonify, request, session
from functools import wraps
import datetime
import uuid
from decorators import superadmin_required
import firebase_admin
from firebase_admin import db

gl_deductions_bp = Blueprint('gl_deductions', __name__)

# Helper functions
def get_deductions_ref():
    return db.reference('deductions')

def get_admins_ref():
    return db.reference('admins')

def get_drivers_ref():
    return db.reference('users')

def get_drivers_root_ref():
    """Get reference to the drivers root node (separate from users)"""
    return db.reference('drivers')

def get_salary_records_ref():
    return db.reference('salaryRecords')

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

# Get all deductions
@gl_deductions_bp.route('/api/deductions', methods=['GET'])
@superadmin_required
def get_deductions():
    try:
        # Get query parameters
        search = request.args.get('search', '')
        deduction_type = request.args.get('type', 'all')
        employee_id = request.args.get('employeeId', 'all')
        period = request.args.get('period', 'all')
        date_range = request.args.get('dateRange', 'all')
        start_date = request.args.get('startDate', '')
        end_date = request.args.get('endDate', '')
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 10))
        
        # Get deductions from Firebase
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        
        # Get admin employees for names
        admins_ref = get_admins_ref()
        admins_data = admins_ref.get() or {}
        
        # Get drivers for names
        drivers_ref = get_drivers_ref()
        drivers_data = drivers_ref.get() or {}
        
        # Combine data
        records = []
        for ded_id, ded_data in all_deductions.items():
            if not ded_data or not isinstance(ded_data, dict):
                continue
                
            emp_id = ded_data.get('employeeId')
            employee_name = 'Unknown'
            department = 'N/A'
            
            # First, try to use stored employeeName if available
            if ded_data.get('employeeName'):
                employee_name = ded_data.get('employeeName')
                department = ded_data.get('department', get_employee_department(emp_id))
            else:
                # Try to find employee in admins first (checking for info structure)
                if emp_id and emp_id in admins_data and admins_data[emp_id].get('info'):
                    emp_info = admins_data[emp_id].get('info', {})
                    employee_name = emp_info.get('fullName', 'Unknown')
                    department = emp_info.get('department', 'admin')
                # If not found in admins with info, try drivers
                elif emp_id and emp_id in drivers_data:
                    driver = drivers_data[emp_id]
                    if driver.get('role') == 'driver':
                        first_name = driver.get('firstName', '')
                        middle_name = driver.get('middleName', '')
                        last_name = driver.get('lastName', '')
                        
                        name_parts = [first_name]
                        if middle_name:
                            name_parts.append(middle_name)
                        if last_name:
                            name_parts.append(last_name)
                        employee_name = ' '.join(name_parts).strip() or 'Unknown Driver'
                        department = 'operations'
            
            record = {
                'id': ded_id,
                'employeeId': emp_id,
                'employeeName': employee_name,
                'department': department,
                **ded_data
            }
            records.append(record)
        
        # Apply filters
        filtered = filter_deductions(records, search, deduction_type, employee_id, 
                                    period, date_range, start_date, end_date)
        
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
        print(f"Error in get_deductions: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get single deduction
@gl_deductions_bp.route('/api/deductions/<deduction_id>', methods=['GET'])
@superadmin_required
def get_deduction(deduction_id):
    try:
        deduction_ref = get_deductions_ref().child(deduction_id)
        deduction = deduction_ref.get()
        
        if not deduction:
            return jsonify({'success': False, 'error': 'Deduction not found'}), 404
        
        # Get employee info
        emp_id = deduction.get('employeeId')
        employee_name = 'Unknown'
        department = 'N/A'
        
        # First, try to use stored employeeName
        if deduction.get('employeeName'):
            employee_name = deduction.get('employeeName')
            department = deduction.get('department', get_employee_department(emp_id))
        elif emp_id:
            # Try admins first (checking for info structure)
            admins_ref = get_admins_ref()
            admin = admins_ref.child(emp_id).get()
            if admin and admin.get('info'):
                info = admin.get('info', {})
                employee_name = info.get('fullName', 'Unknown')
                department = info.get('department', 'admin')
            else:
                # Try drivers
                drivers_ref = get_drivers_ref()
                driver = drivers_ref.child(emp_id).get()
                if driver and driver.get('role') == 'driver':
                    first_name = driver.get('firstName', '')
                    middle_name = driver.get('middleName', '')
                    last_name = driver.get('lastName', '')
                    
                    name_parts = [first_name]
                    if middle_name:
                        name_parts.append(middle_name)
                    if last_name:
                        name_parts.append(last_name)
                    employee_name = ' '.join(name_parts).strip() or 'Unknown Driver'
                    department = 'operations'
        
        deduction['employeeName'] = employee_name
        deduction['department'] = department
        
        return jsonify({'success': True, 'data': deduction})
        
    except Exception as e:
        print(f"Error in get_deduction: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Create deduction
@gl_deductions_bp.route('/api/deductions', methods=['POST'])
@superadmin_required
def create_deduction():
    try:
        data = request.json
        
        required_fields = ['employeeId', 'type', 'amount', 'period', 'date']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Get employee name and department
        emp_id = data['employeeId']
        employee_name = get_employee_name(emp_id)
        department = get_employee_department(emp_id)
        
        # Determine if this is a driver or admin
        is_driver_flag = is_driver(emp_id)
        
        print(f"Creating deduction for {'driver' if is_driver_flag else 'admin'} ID: {emp_id}, name: {employee_name}")
        
        deduction_data = {
            'employeeId': emp_id,
            'employeeName': employee_name,
            'department': department,
            'employeeType': 'driver' if is_driver_flag else 'admin',
            'type': data['type'],
            'amount': float(data['amount']),
            'period': data['period'],
            'date': data['date'],
            'description': data.get('description', ''),
            'linkedTo': data.get('linkedTo', ''),
            'status': 'pending',
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system')
        }
        
        # Save to Firebase (main deductions collection)
        deductions_ref = get_deductions_ref()
        new_deduction = deductions_ref.push(deduction_data)
        
        print(f"Created deduction for {employee_name} with ID: {new_deduction.key}")
        
        # Update employee's deductions history in the CORRECT location
        if is_driver_flag:
            # Store in /drivers/{driverId}/deductionsHistory
            try:
                drivers_root_ref = get_drivers_root_ref()
                
                # Get driver data from users node for additional info
                drivers_ref = get_drivers_ref()
                driver_data = drivers_ref.child(emp_id).get() or {}
                
                # Store basic driver info if not exists - THIS WAS MISSING!
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
                    print(f"Stored driver info for {employee_name} in /drivers/{emp_id}/info")
                
                # Store the deduction in /drivers/{driverId}/deductionsHistory
                driver_history_ref = drivers_root_ref.child(emp_id).child('deductionsHistory').child(new_deduction.key)
                driver_history_ref.set({
                    'type': data['type'],
                    'amount': float(data['amount']),
                    'period': data['period'],
                    'date': data['date'],
                    'status': 'pending',
                    'deductionId': new_deduction.key
                })
                    
                print(f"Stored deduction in /drivers/{emp_id}/deductionsHistory")
            except Exception as e:
                print(f"Error storing in drivers history: {e}")
                traceback.print_exc()
        else:
            # Store in /admins/{adminId}/deductionsHistory
            try:
                admin_history_ref = get_admins_ref().child(emp_id).child('deductionsHistory').child(new_deduction.key)
                admin_history_ref.set({
                    'type': data['type'],
                    'amount': float(data['amount']),
                    'period': data['period'],
                    'date': data['date'],
                    'status': 'pending',
                    'deductionId': new_deduction.key
                })
                print(f"Stored deduction in /admins/{emp_id}/deductionsHistory")
            except Exception as e:
                print(f"Error storing in admins history: {e}")
                traceback.print_exc()
        
        return jsonify({
            'success': True,
            'message': 'Deduction added successfully',
            'data': {'id': new_deduction.key}
        }), 201
        
    except Exception as e:
        print(f"Error in create_deduction: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Bulk create deductions
@gl_deductions_bp.route('/api/deductions/bulk', methods=['POST'])
@superadmin_required
def bulk_create_deductions():
    try:
        data = request.json
        
        required_fields = ['type', 'period', 'date', 'employees']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        deduction_type = data['type']
        period = data['period']
        date = data['date']
        employee_ids = data['employees']
        fixed_amount = data.get('fixedAmount')
        
        deductions_ref = get_deductions_ref()
        admins_ref = get_admins_ref()
        drivers_ref = get_drivers_ref()
        drivers_root_ref = get_drivers_root_ref()
        
        created = []
        for emp_id in employee_ids:
            # Get employee name and determine type
            employee_name = get_employee_name(emp_id)
            is_driver_flag = is_driver(emp_id)
            department = get_employee_department(emp_id)
            
            # Get employee's standard rate if no fixed amount
            amount = fixed_amount
            if not amount:
                if is_driver_flag:
                    # For drivers, we might want a default or skip
                    # You can set a default amount for driver deductions here
                    amount = 0  # or some default value
                    print(f"Driver {employee_name} has no base salary, using amount: {amount}")
                else:
                    emp_data = admins_ref.child(emp_id).get() or {}
                    pay_rates = emp_data.get('payRates', {})
                    base_salary = pay_rates.get('monthlyRate', 0) or pay_rates.get('cutoffRate', 0) * 2 or pay_rates.get('dailyRate', 0) * 22
                    
                    if deduction_type == 'sss':
                        amount = base_salary * 0.045
                    elif deduction_type == 'philhealth':
                        amount = base_salary * 0.03
                    elif deduction_type == 'pagibig':
                        amount = 100
                    elif deduction_type == 'tax':
                        amount = base_salary * 0.15
                    else:
                        amount = 0
            
            if amount and amount > 0:
                deduction_data = {
                    'employeeId': emp_id,
                    'employeeName': employee_name,
                    'employeeType': 'driver' if is_driver_flag else 'admin',
                    'department': department,
                    'type': deduction_type,
                    'amount': float(amount),
                    'period': period,
                    'date': date,
                    'description': f'Bulk {deduction_type} deduction for {period}',
                    'status': 'pending',
                    'createdAt': datetime.datetime.now().isoformat(),
                    'createdBy': session.get('user_id', 'system')
                }
                
                new_deduction = deductions_ref.push(deduction_data)
                created.append(new_deduction.key)
                
                # Update employee's history in the correct location
                if is_driver_flag:
                    try:
                        drivers_root_ref = get_drivers_root_ref()
                        
                        # Get driver data from users node for additional info
                        driver_data = drivers_ref.child(emp_id).get() or {}
                        
                        # Store basic driver info if not exists - THIS WAS MISSING!
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
                            print(f"Stored driver info for {employee_name} in /drivers/{emp_id}/info")
                        
                        driver_history_ref = drivers_root_ref.child(emp_id).child('deductionsHistory').child(new_deduction.key)
                        driver_history_ref.set({
                            'type': deduction_type,
                            'amount': float(amount),
                            'period': period,
                            'date': date,
                            'status': 'pending',
                            'deductionId': new_deduction.key
                        })
                    except Exception as e:
                        print(f"Error storing in drivers history: {e}")
                else:
                    try:
                        admin_history_ref = admins_ref.child(emp_id).child('deductionsHistory').child(new_deduction.key)
                        admin_history_ref.set({
                            'type': deduction_type,
                            'amount': float(amount),
                            'period': period,
                            'date': date,
                            'status': 'pending',
                            'deductionId': new_deduction.key
                        })
                    except Exception as e:
                        print(f"Error storing in admins history: {e}")
        
        return jsonify({
            'success': True,
            'message': f'{len(created)} deductions created successfully',
            'data': {'ids': created, 'count': len(created)}
        }), 201
        
    except Exception as e:
        print(f"Error in bulk_create_deductions: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Update deduction
@gl_deductions_bp.route('/api/deductions/<deduction_id>', methods=['PUT'])
@superadmin_required
def update_deduction(deduction_id):
    try:
        data = request.json
        deduction_ref = get_deductions_ref().child(deduction_id)
        existing = deduction_ref.get()
        
        if not existing:
            return jsonify({'success': False, 'error': 'Deduction not found'}), 404
        
        # Only allow updates if still pending
        if existing.get('status') != 'pending':
            return jsonify({'success': False, 'error': 'Cannot update deduction that has already been applied'}), 400
        
        # If employeeId changed, update employeeName too
        employee_name = existing.get('employeeName')
        employee_type = existing.get('employeeType')
        department = existing.get('department')
        
        if data.get('employeeId') and data['employeeId'] != existing.get('employeeId'):
            new_emp_id = data['employeeId']
            employee_name = get_employee_name(new_emp_id)
            department = get_employee_department(new_emp_id)
            employee_type = 'driver' if is_driver(new_emp_id) else 'admin'
        
        update_data = {
            'employeeId': data.get('employeeId', existing.get('employeeId')),
            'employeeName': employee_name,
            'employeeType': employee_type,
            'department': department,
            'type': data.get('type', existing.get('type')),
            'amount': float(data.get('amount', existing.get('amount', 0))),
            'period': data.get('period', existing.get('period')),
            'date': data.get('date', existing.get('date')),
            'description': data.get('description', existing.get('description', '')),
            'linkedTo': data.get('linkedTo', existing.get('linkedTo', '')),
            'updatedAt': datetime.datetime.now().isoformat(),
            'updatedBy': session.get('user_id', 'system')
        }
        
        deduction_ref.update(update_data)
        
        # Update employee's history in the correct location
        emp_id = update_data['employeeId']
        if emp_id:
            try:
                if employee_type == 'driver':
                    drivers_root_ref = get_drivers_root_ref()
                    history_ref = drivers_root_ref.child(emp_id).child('deductionsHistory').child(deduction_id)
                    if history_ref.get():
                        history_ref.update({
                            'type': update_data['type'],
                            'amount': update_data['amount'],
                            'period': update_data['period'],
                            'date': update_data['date']
                        })
                else:
                    admin_history_ref = get_admins_ref().child(emp_id).child('deductionsHistory').child(deduction_id)
                    if admin_history_ref.get():
                        admin_history_ref.update({
                            'type': update_data['type'],
                            'amount': update_data['amount'],
                            'period': update_data['period'],
                            'date': update_data['date']
                        })
            except Exception as e:
                print(f"Error updating history: {e}")
                pass
        
        return jsonify({
            'success': True,
            'message': 'Deduction updated successfully'
        })
        
    except Exception as e:
        print(f"Error in update_deduction: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Delete deduction
@gl_deductions_bp.route('/api/deductions/<deduction_id>', methods=['DELETE'])
@superadmin_required
def delete_deduction(deduction_id):
    try:
        deduction_ref = get_deductions_ref().child(deduction_id)
        deduction = deduction_ref.get()
        
        if not deduction:
            return jsonify({'success': False, 'error': 'Deduction not found'}), 404
        
        # Only allow deletion if still pending
        if deduction.get('status') != 'pending':
            return jsonify({'success': False, 'error': 'Cannot delete deduction that has already been applied'}), 400
        
        # Remove from employee's history in the correct location
        emp_id = deduction.get('employeeId')
        employee_type = deduction.get('employeeType')
        
        if emp_id:
            try:
                if employee_type == 'driver':
                    drivers_root_ref = get_drivers_root_ref()
                    history_ref = drivers_root_ref.child(emp_id).child('deductionsHistory').child(deduction_id)
                    history_ref.delete()
                else:
                    admin_history_ref = get_admins_ref().child(emp_id).child('deductionsHistory').child(deduction_id)
                    admin_history_ref.delete()
            except Exception as e:
                print(f"Error deleting history: {e}")
                pass
        
        deduction_ref.delete()
        
        return jsonify({
            'success': True,
            'message': 'Deduction deleted successfully'
        })
        
    except Exception as e:
        print(f"Error in delete_deduction: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get deduction history for a specific employee
@gl_deductions_bp.route('/api/deductions/history/<employee_id>', methods=['GET'])
@superadmin_required
def get_deductions_history(employee_id):
    try:
        # Determine if this is a driver or admin
        is_driver_flag = is_driver(employee_id)
        history = {}
        
        if is_driver_flag:
            # Get from drivers node
            drivers_root_ref = get_drivers_root_ref()
            driver_data = drivers_root_ref.child(employee_id).get()
            if driver_data:
                history = driver_data.get('deductionsHistory', {})
        else:
            # Get from admins node
            admins_ref = get_admins_ref()
            admin_data = admins_ref.child(employee_id).get()
            if admin_data:
                history = admin_data.get('deductionsHistory', {})
        
        # Get full deduction details from main deductions collection
        deductions_ref = get_deductions_ref()
        records = []
        for hist_id, hist_data in history.items():
            deduction_id = hist_data.get('deductionId', hist_id)
            full_deduction = deductions_ref.child(deduction_id).get() or {}
            records.append({
                'id': deduction_id,
                **full_deduction,
                **hist_data
            })
        
        records.sort(key=lambda x: x.get('date', ''), reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        print(f"Error in get_deductions_history: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get all employees (admins and drivers) for dropdown
@gl_deductions_bp.route('/api/deductions/employees', methods=['GET'])
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
                pay_rates = emp_data.get('payRates', {})
                base_salary = pay_rates.get('monthlyRate', 0) or pay_rates.get('cutoffRate', 0) * 2 or pay_rates.get('dailyRate', 0) * 22
                
                all_employees.append({
                    'id': emp_id,
                    'name': info.get('fullName', 'Unknown'),
                    'position': info.get('position', 'Admin Staff'),
                    'department': info.get('department', 'admin'),
                    'type': 'admin',
                    'baseSalary': base_salary
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

# Get periods list
@gl_deductions_bp.route('/api/deductions/periods', methods=['GET'])
@superadmin_required
def get_periods():
    try:
        # Generate last 12 months
        periods = []
        today = datetime.datetime.now()
        for i in range(11, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            period = month_date.strftime('%B %Y')
            periods.append(period)
        
        # Add cutoff periods
        cutoff_periods = []
        for period in periods:
            cutoff_periods.append(f"{period} - 1st Half")
            cutoff_periods.append(f"{period} - 2nd Half")
        
        return jsonify({
            'success': True,
            'data': {
                'months': periods,
                'cutoffs': cutoff_periods
            }
        })
        
    except Exception as e:
        print(f"Error in get_periods: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get summary
@gl_deductions_bp.route('/api/deductions/summary', methods=['GET'])
@superadmin_required
def get_summary():
    try:
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        
        total = 0
        sss_total = 0
        sss_count = 0
        philhealth_total = 0
        philhealth_count = 0
        pagibig_total = 0
        pagibig_count = 0
        tax_total = 0
        loan_total = 0
        other_total = 0
        pending_total = 0
        
        for ded in all_deductions.values():
            if not ded or not isinstance(ded, dict):
                continue
                
            amount = ded.get('amount', 0)
            total += amount
            
            if ded.get('status') == 'pending':
                pending_total += amount
            
            ded_type = ded.get('type')
            if ded_type == 'sss':
                sss_total += amount
                sss_count += 1
            elif ded_type == 'philhealth':
                philhealth_total += amount
                philhealth_count += 1
            elif ded_type == 'pagibig':
                pagibig_total += amount
                pagibig_count += 1
            elif ded_type == 'tax':
                tax_total += amount
            elif ded_type == 'loan':
                loan_total += amount
            else:
                other_total += amount
        
        summary = {
            'totalDeductions': total,
            'pendingTotal': pending_total,
            'sssTotal': sss_total,
            'sssCount': sss_count,
            'philhealthTotal': philhealth_total,
            'philhealthCount': philhealth_count,
            'pagibigTotal': pagibig_total,
            'pagibigCount': pagibig_count,
            'taxTotal': tax_total,
            'loanTotal': loan_total,
            'otherTotal': other_total
        }
        
        return jsonify({'success': True, 'data': summary})
        
    except Exception as e:
        print(f"Error in get_summary: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Get analytics
@gl_deductions_bp.route('/api/deductions/analytics', methods=['GET'])
@superadmin_required
def get_analytics():
    try:
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        
        # Type totals
        type_totals = {
            'sss': 0,
            'philhealth': 0,
            'pagibig': 0,
            'tax': 0,
            'loan': 0,
            'other': 0
        }
        
        # Monthly trend
        months = []
        monthly_data = []
        today = datetime.datetime.now()
        for i in range(5, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            month_name = month_date.strftime('%b %Y')
            months.append(month_name)
            monthly_data.append(0)
        
        # Department totals
        dept_totals = {}
        
        # Top individual deductions - use stored employeeName
        top_deductions_list = []
        
        for ded_id, ded in all_deductions.items():
            if not ded or not isinstance(ded, dict):
                continue
                
            ded_type = ded.get('type', 'other')
            amount = ded.get('amount', 0)
            if ded_type in type_totals:
                type_totals[ded_type] += amount
            else:
                type_totals['other'] += amount
            
            # Monthly trend
            date_str = ded.get('date', '')
            if date_str:
                try:
                    ded_date = datetime.datetime.fromisoformat(date_str)
                    month_key = ded_date.strftime('%b %Y')
                    if month_key in months:
                        idx = months.index(month_key)
                        monthly_data[idx] += amount
                except:
                    pass
            
            # Department totals - use stored department
            dept = ded.get('department', 'other')
            if dept not in dept_totals:
                dept_totals[dept] = 0
            dept_totals[dept] += amount
            
            # Add to top deductions list using stored employeeName
            top_deductions_list.append({
                'name': ded.get('employeeName', 'Unknown'),
                'type': ded_type,
                'amount': amount
            })
        
        # Sort and get top 5
        top_deductions_list.sort(key=lambda x: x['amount'], reverse=True)
        top_deductions = top_deductions_list[:5]
        
        analytics = {
            'typeDistribution': {
                'labels': list(type_totals.keys()),
                'data': list(type_totals.values())
            },
            'monthlyTrend': {
                'labels': months,
                'data': monthly_data
            },
            'departmentDistribution': {
                'labels': list(dept_totals.keys()),
                'data': list(dept_totals.values())
            },
            'topDeductions': top_deductions
        }
        
        return jsonify({'success': True, 'data': analytics})
        
    except Exception as e:
        print(f"Error in get_analytics: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Calculate all standard deductions for a period
@gl_deductions_bp.route('/api/deductions/calculate-all', methods=['POST'])
@superadmin_required
def calculate_all_deductions():
    try:
        data = request.json
        period = data.get('period', datetime.datetime.now().strftime('%B %Y - 1st Half'))
        date = data.get('date', datetime.datetime.now().strftime('%Y-%m-%d'))
        
        admins_ref = get_admins_ref()
        all_admins = admins_ref.get() or {}
        
        deductions_ref = get_deductions_ref()
        created = []
        
        for emp_id, emp_data in all_admins.items():
            info = emp_data.get('info', {})
            if info.get('status') != 'active':
                continue
            
            employee_name = info.get('fullName', 'Unknown')
            pay_rates = emp_data.get('payRates', {})
            base_salary = pay_rates.get('monthlyRate', 0) or pay_rates.get('cutoffRate', 0) * 2 or pay_rates.get('dailyRate', 0) * 22
            
            # Calculate standard deductions
            sss = base_salary * 0.045
            philhealth = base_salary * 0.03
            pagibig = 100
            tax = base_salary * 0.15
            
            # Create SSS deduction
            sss_data = {
                'employeeId': emp_id,
                'employeeName': employee_name,
                'employeeType': 'admin',
                'department': info.get('department', 'admin'),
                'type': 'sss',
                'amount': sss,
                'period': period,
                'date': date,
                'description': f'SSS contribution for {period}',
                'status': 'pending',
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system')
            }
            sss_ded = deductions_ref.push(sss_data)
            created.append(sss_ded.key)
            
            # Create PhilHealth deduction
            philhealth_data = {
                'employeeId': emp_id,
                'employeeName': employee_name,
                'employeeType': 'admin',
                'department': info.get('department', 'admin'),
                'type': 'philhealth',
                'amount': philhealth,
                'period': period,
                'date': date,
                'description': f'PhilHealth contribution for {period}',
                'status': 'pending',
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system')
            }
            philhealth_ded = deductions_ref.push(philhealth_data)
            created.append(philhealth_ded.key)
            
            # Create Pag-IBIG deduction
            pagibig_data = {
                'employeeId': emp_id,
                'employeeName': employee_name,
                'employeeType': 'admin',
                'department': info.get('department', 'admin'),
                'type': 'pagibig',
                'amount': pagibig,
                'period': period,
                'date': date,
                'description': f'Pag-IBIG contribution for {period}',
                'status': 'pending',
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system')
            }
            pagibig_ded = deductions_ref.push(pagibig_data)
            created.append(pagibig_ded.key)
            
            # Create Tax deduction
            tax_data = {
                'employeeId': emp_id,
                'employeeName': employee_name,
                'employeeType': 'admin',
                'department': info.get('department', 'admin'),
                'type': 'tax',
                'amount': tax,
                'period': period,
                'date': date,
                'description': f'Withholding tax for {period}',
                'status': 'pending',
                'createdAt': datetime.datetime.now().isoformat(),
                'createdBy': session.get('user_id', 'system')
            }
            tax_ded = deductions_ref.push(tax_data)
            created.append(tax_ded.key)
            
            # Update employee's history
            try:
                admin_history_ref = admins_ref.child(emp_id).child('deductionsHistory')
                admin_history_ref.child(sss_ded.key).set({
                    'type': 'sss',
                    'amount': sss,
                    'period': period,
                    'date': date,
                    'status': 'pending',
                    'deductionId': sss_ded.key
                })
                admin_history_ref.child(philhealth_ded.key).set({
                    'type': 'philhealth',
                    'amount': philhealth,
                    'period': period,
                    'date': date,
                    'status': 'pending',
                    'deductionId': philhealth_ded.key
                })
                admin_history_ref.child(pagibig_ded.key).set({
                    'type': 'pagibig',
                    'amount': pagibig,
                    'period': period,
                    'date': date,
                    'status': 'pending',
                    'deductionId': pagibig_ded.key
                })
                admin_history_ref.child(tax_ded.key).set({
                    'type': 'tax',
                    'amount': tax,
                    'period': period,
                    'date': date,
                    'status': 'pending',
                    'deductionId': tax_ded.key
                })
            except Exception as e:
                print(f"Error updating admin history: {e}")
                pass
        
        return jsonify({
            'success': True,
            'message': f'Calculated standard deductions for all employees',
            'data': {'count': len(created) // 4, 'total_deductions': len(created)}
        }), 201
        
    except Exception as e:
        print(f"Error in calculate_all_deductions: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Filter helper
def filter_deductions(records, search, deduction_type, employee_id, period, date_range, start_date, end_date):
    filtered = records.copy()
    
    if search:
        search_lower = search.lower()
        filtered = [r for r in filtered if 
                   search_lower in r.get('employeeName', '').lower() or
                   search_lower in r.get('type', '').lower() or
                   search_lower in r.get('description', '').lower()]
    
    if deduction_type != 'all':
        filtered = [r for r in filtered if r.get('type') == deduction_type]
    
    if employee_id != 'all':
        filtered = [r for r in filtered if r.get('employeeId') == employee_id]
    
    if period != 'all':
        filtered = [r for r in filtered if r.get('period') == period]
    
    if date_range == 'custom' and start_date and end_date:
        filtered = [r for r in filtered if 
                   start_date <= r.get('date', '')[:10] <= end_date]
    
    return filtered