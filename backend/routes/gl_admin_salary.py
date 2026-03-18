from flask import Blueprint, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
import datetime
import json
from decorators import login_required, superadmin_required
import firebase_admin
from firebase_admin import db

gl_admin_salary_bp = Blueprint('gl_admin_salary', __name__)

# Helper function to get Firebase references
def get_admins_ref():
    return db.reference('admins')

def get_salary_records_ref():
    return db.reference('salaryRecords')

def get_deductions_ref():
    return db.reference('deductions')

def get_advances_ref():
    return db.reference('advances')

# Get pending deductions for an employee for a specific period
@gl_admin_salary_bp.route('/api/admin-salary/pending-deductions/<employee_id>', methods=['GET'])
@superadmin_required
def get_pending_deductions(employee_id):
    try:
        period = request.args.get('period', '')
        
        if not period:
            return jsonify({'success': False, 'error': 'Period is required'}), 400
        
        # Get ALL deductions (no query)
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
        
        # Filter in Python
        for ded_id, ded in all_deductions.items():
            # Check if deduction is for this employee, period, and still pending
            if (ded.get('employeeId') == employee_id and 
                ded.get('period') == period and 
                ded.get('status') == 'pending'):
                
                ded_type = ded.get('type', 'other')
                amount = ded.get('amount', 0)
                
                if ded_type in pending:
                    pending[ded_type] += amount
                else:
                    pending['other'] += amount
                
                pending['total'] += amount
        
        return jsonify({'success': True, 'data': pending})
        
    except Exception as e:
        print(f"Error in get_pending_deductions: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Get pending advances for an employee for a specific period
@gl_admin_salary_bp.route('/api/admin-salary/pending-advances/<employee_id>', methods=['GET'])
@superadmin_required
def get_pending_advances(employee_id):
    try:
        period = request.args.get('period', '')
        
        if not period:
            return jsonify({'success': False, 'error': 'Period is required'}), 400
        
        # Get ALL advances (no query)
        advances_ref = db.reference('advances')
        all_advances = advances_ref.get() or {}
        
        total_advance = 0
        advances_list = []
        
        # Filter in Python
        for adv_id, adv in all_advances.items():
            # Check if advance is for this employee
            if adv.get('employeeId') != employee_id:
                continue
                
            # Check if advance is approved and has remaining balance
            if adv.get('status') in ['approved', 'partially-paid'] and adv.get('remainingBalance', 0) > 0:
                # Determine if this advance should be deducted this period
                repayment_period = adv.get('repaymentPeriod', '')
                repayment_amount = adv.get('repaymentAmount', 0)
                
                # Simple logic: if it's a cutoff-based repayment, always deduct the repayment amount
                if 'Cutoff' in repayment_period or 'Payroll' in repayment_period:
                    deduction = min(repayment_amount, adv.get('remainingBalance', 0))
                    total_advance += deduction
                    advances_list.append({
                        'id': adv_id,
                        'amount': deduction,
                        'originalAmount': adv.get('amount', 0),
                        'remaining': adv.get('remainingBalance', 0)
                    })
        
        return jsonify({
            'success': True, 
            'data': {
                'totalAdvance': total_advance,
                'advances': advances_list
            }
        })
        
    except Exception as e:
        print(f"Error in get_pending_advances: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Get all salary records
@gl_admin_salary_bp.route('/api/admin-salary/records', methods=['GET'])
@superadmin_required
def get_salary_records():
    try:
        # Get query parameters
        search = request.args.get('search', '')
        status = request.args.get('status', 'all')
        department = request.args.get('department', 'all')
        pay_period = request.args.get('payPeriod', 'all')
        date_range = request.args.get('dateRange', 'all')
        start_date = request.args.get('startDate', '')
        end_date = request.args.get('endDate', '')
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 10))
        
        # Get ALL salary records (no query)
        salary_ref = get_salary_records_ref()
        salary_records = salary_ref.get() or {}
        
        # Get ALL admin details
        admins_ref = get_admins_ref()
        admins = admins_ref.get() or {}
        
        # Combine records
        records = []
        for record_id, record_data in salary_records.items():
            admin_id = record_data.get('employeeId')
            admin_data = admins.get(admin_id, {}).get('info', {}) if admin_id else {}
            
            record = {
                'id': record_id,
                'employeeId': admin_id,
                'employeeName': admin_data.get('fullName', 'Unknown'),
                'position': admin_data.get('position', 'N/A'),
                'department': admin_data.get('department', 'admin'),
                'baseSalary': admin_data.get('baseSalary', 0),
                **record_data
            }
            records.append(record)
        
        # Apply filters in Python
        filtered_records = filter_records(records, search, status, department, 
                                        pay_period, date_range, start_date, end_date)
        
        # Pagination
        total = len(filtered_records)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_records = filtered_records[start_idx:end_idx]
        
        return jsonify({
            'success': True,
            'data': paginated_records,
            'total': total,
            'page': page,
            'total_pages': (total + limit - 1) // limit
        })
        
    except Exception as e:
        print(f"Error in get_salary_records: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Get single salary record
@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['GET'])
@superadmin_required
def get_salary_record(record_id):
    try:
        salary_ref = get_salary_records_ref().child(record_id)
        record_data = salary_ref.get()
        
        if not record_data:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        admin_id = record_data.get('employeeId')
        admin_ref = get_admins_ref().child(admin_id).child('info')
        admin_data = admin_ref.get() or {}
        
        record = {
            'id': record_id,
            'employeeId': admin_id,
            'employeeName': admin_data.get('fullName', 'Unknown'),
            'position': admin_data.get('position', 'N/A'),
            'department': admin_data.get('department', 'admin'),
            **record_data
        }
        
        return jsonify({'success': True, 'data': record})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Create salary record
@gl_admin_salary_bp.route('/api/admin-salary/records', methods=['POST'])
@superadmin_required
def create_salary_record():
    try:
        data = request.json
        
        required_fields = ['employeeId', 'payPeriod', 'baseSalary', 'paymentStatus']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Get pending deductions and advances for this period
        admin_id = data['employeeId']
        period = data['payPeriod']
        
        # Get pending deductions (these will be used to verify entered amounts)
        pending_deductions = get_pending_deductions_data(admin_id, period)
        pending_advances = get_pending_advances_data(admin_id, period)
        
        # Use the values from the form (which were auto-filled from pending)
        tax_deduction = float(data.get('taxDeduction', pending_deductions['tax']))
        sss_deduction = float(data.get('sssDeduction', pending_deductions['sss']))
        philhealth_deduction = float(data.get('philhealthDeduction', pending_deductions['philhealth']))
        pagibig_deduction = float(data.get('pagibigDeduction', pending_deductions['pagibig']))
        loan_deduction = float(data.get('loanDeduction', pending_deductions['loan']))
        other_deductions = float(data.get('otherDeductions', pending_deductions['other']))
        advance_deduction = float(data.get('advanceDeduction', pending_advances['totalAdvance']))
        
        # Calculate totals
        base_salary = float(data.get('baseSalary', 0))
        allowances = float(data.get('allowances', 0))
        overtime_pay = float(data.get('overtimePay', 0))
        bonus = float(data.get('bonus', 0))
        
        total_earnings = base_salary + allowances + overtime_pay + bonus
        total_deductions = (tax_deduction + sss_deduction + philhealth_deduction + 
                           pagibig_deduction + loan_deduction + other_deductions + 
                           advance_deduction)
        net_pay = total_earnings - total_deductions
        
        # Prepare record
        record_data = {
            'employeeId': data['employeeId'],
            'payPeriod': data['payPeriod'],
            'baseSalary': base_salary,
            'allowances': allowances,
            'overtimePay': overtime_pay,
            'bonus': bonus,
            'taxDeduction': tax_deduction,
            'sssDeduction': sss_deduction,
            'philhealthDeduction': philhealth_deduction,
            'pagibigDeduction': pagibig_deduction,
            'loanDeduction': loan_deduction,
            'otherDeductions': other_deductions,
            'advanceDeduction': advance_deduction,
            'totalEarnings': total_earnings,
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
        
        # Save to Firebase
        salary_ref = get_salary_records_ref()
        new_record = salary_ref.push(record_data)
        
        # Update admin's salary history
        admin_ref = get_admins_ref().child(data['employeeId']).child('salaryHistory')
        admin_ref.child(new_record.key).set({
            'period': data['payPeriod'],
            'netPay': net_pay,
            'status': data['paymentStatus'],
            'paymentDate': data.get('paymentDate', ''),
            'createdAt': datetime.datetime.now().isoformat()
        })
        
        # Mark pending deductions as applied
        deductions_ref = get_deductions_ref()
        all_deductions = deductions_ref.get() or {}
        for ded_id, ded in all_deductions.items():
            if (ded.get('employeeId') == admin_id and 
                ded.get('period') == period and 
                ded.get('status') == 'pending'):
                deductions_ref.child(ded_id).update({
                    'status': 'applied',
                    'linkedSalaryRecord': new_record.key,
                    'appliedAt': datetime.datetime.now().isoformat()
                })
        
        # FIXED: Update advance balances AND payment schedule
        advances_ref = get_advances_ref()
        all_advances = advances_ref.get() or {}
        
        for adv_id, adv in all_advances.items():
            if adv.get('employeeId') != admin_id:
                continue
                
            if adv.get('status') in ['approved', 'partially-paid'] and adv.get('remainingBalance', 0) > 0:
                if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                    repayment = min(adv.get('repaymentAmount', 0), adv.get('remainingBalance', 0))
                    new_balance = adv.get('remainingBalance', 0) - repayment
                    
                    # Get current payment schedule
                    payment_schedule = adv.get('paymentSchedule', [])
                    
                    # Find the next pending payment and mark it as paid
                    for payment in payment_schedule:
                        if payment.get('status') == 'pending':
                            payment['status'] = 'paid'
                            payment['paidDate'] = data.get('paymentDate', datetime.datetime.now().isoformat())
                            payment['linkedSalaryRecord'] = new_record.key
                            break
                    
                    update_data = {
                        'remainingBalance': new_balance,
                        'paidAmount': adv.get('paidAmount', 0) + repayment,
                        'paymentSchedule': payment_schedule,  # Update the schedule
                        'updatedAt': datetime.datetime.now().isoformat()
                    }
                    
                    if new_balance <= 0:
                        update_data['status'] = 'paid'
                        update_data['datePaid'] = data.get('paymentDate', datetime.datetime.now().isoformat())
                    
                    advances_ref.child(adv_id).update(update_data)
        
        return jsonify({
            'success': True,
            'message': 'Salary record created successfully',
            'data': {'id': new_record.key, **record_data}
        }), 201
        
    except Exception as e:
        print(f"Error in create_salary_record: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500
    
# Helper functions for getting pending data (updated to avoid queries)
def get_pending_deductions_data(employee_id, period):
    """Get pending deductions for an employee for a specific period"""
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
            if (ded.get('employeeId') == employee_id and 
                ded.get('period') == period and 
                ded.get('status') == 'pending'):
                
                ded_type = ded.get('type', 'other')
                amount = ded.get('amount', 0)
                
                if ded_type in pending:
                    pending[ded_type] += amount
                else:
                    pending['other'] += amount
                
                pending['total'] += amount
        
        return pending
    except Exception as e:
        print(f"Error getting pending deductions: {e}")
        return {'sss': 0, 'philhealth': 0, 'pagibig': 0, 'tax': 0, 'loan': 0, 'other': 0, 'total': 0}

def get_pending_advances_data(employee_id, period):
    """Get pending advances for an employee"""
    try:
        advances_ref = db.reference('advances')
        all_advances = advances_ref.get() or {}
        
        total_advance = 0
        
        for adv_id, adv in all_advances.items():
            if adv.get('employeeId') != employee_id:
                continue
                
            if adv.get('status') in ['approved', 'partially-paid'] and adv.get('remainingBalance', 0) > 0:
                if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                    repayment = min(adv.get('repaymentAmount', 0), adv.get('remainingBalance', 0))
                    total_advance += repayment
        
        return {'totalAdvance': total_advance}
    except Exception as e:
        print(f"Error getting pending advances: {e}")
        return {'totalAdvance': 0}

# Update salary record
@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['PUT'])
@superadmin_required
def update_salary_record(record_id):
    try:
        data = request.json
        salary_ref = get_salary_records_ref().child(record_id)
        
        if not salary_ref.get():
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Recalculate totals
        total_earnings = (data.get('baseSalary', 0) + data.get('allowances', 0) + 
                         data.get('overtimePay', 0) + data.get('bonus', 0))
        total_deductions = (data.get('taxDeduction', 0) + data.get('sssDeduction', 0) + 
                           data.get('philhealthDeduction', 0) + data.get('pagibigDeduction', 0) +
                           data.get('loanDeduction', 0) + data.get('otherDeductions', 0) +
                           data.get('advanceDeduction', 0))
        net_pay = total_earnings - total_deductions
        
        data['totalEarnings'] = total_earnings
        data['totalDeductions'] = total_deductions
        data['netPay'] = net_pay
        data['updatedAt'] = datetime.datetime.now().isoformat()
        data['updatedBy'] = session.get('user_id', 'system')
        
        salary_ref.update(data)
        
        return jsonify({'success': True, 'message': 'Salary record updated successfully'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Delete salary record
@gl_admin_salary_bp.route('/api/admin-salary/records/<record_id>', methods=['DELETE'])
@superadmin_required
def delete_salary_record(record_id):
    try:
        salary_ref = get_salary_records_ref().child(record_id)
        record = salary_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        # Remove from admin's history
        admin_id = record.get('employeeId')
        if admin_id:
            admin_ref = get_admins_ref().child(admin_id).child('salaryHistory').child(record_id)
            admin_ref.delete()
        
        salary_ref.delete()
        
        return jsonify({'success': True, 'message': 'Salary record deleted successfully'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Update admin
@gl_admin_salary_bp.route('/api/admin-salary/update-admin/<admin_id>', methods=['PUT'])
@superadmin_required
def update_admin(admin_id):
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['fullName', 'email', 'position', 'department', 'rateType']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Get admin reference
        admin_ref = get_admins_ref().child(admin_id)
        
        # Check if admin exists
        if not admin_ref.get():
            return jsonify({'success': False, 'error': 'Admin not found'}), 404
        
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
            'dailyRate': data.get('dailyRate', 0),
            'cutoffRate': data.get('cutoffRate', 0),
            'monthlyRate': data.get('monthlyRate', 0),
            'updatedAt': datetime.datetime.now().isoformat()
        }
        
        # Save to Firebase
        admin_ref.child('info').update(info_data)
        admin_ref.child('payRates').update(pay_rates_data)
        
        return jsonify({
            'success': True,
            'message': 'Admin updated successfully'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get employees list
@gl_admin_salary_bp.route('/api/admin-salary/employees', methods=['GET'])
@superadmin_required
def get_employees():
    try:
        admins_ref = get_admins_ref()
        admins_data = admins_ref.get() or {}
        
        employees = []
        for admin_id, admin_data in admins_data.items():
            info = admin_data.get('info', {})
            pay_rates = admin_data.get('payRates', {})
            
            base_salary = 0
            if pay_rates.get('rateType') == 'daily':
                base_salary = pay_rates.get('dailyRate', 0) * 22  # Approximate monthly
            elif pay_rates.get('rateType') == 'cutoff':
                base_salary = pay_rates.get('cutoffRate', 0) * 2
            elif pay_rates.get('rateType') == 'monthly':
                base_salary = pay_rates.get('monthlyRate', 0)
            
            employee = {
                'id': admin_id,
                'name': info.get('fullName', 'Unknown'),
                'position': info.get('position', 'Staff'),
                'department': info.get('department', 'admin'),
                'baseSalary': base_salary,
                'email': info.get('email', ''),
                'phone': info.get('phone', ''),
                'hireDate': info.get('hireDate', ''),
                'status': info.get('status', 'active')
            }
            employees.append(employee)
        
        employees.sort(key=lambda x: x['name'])
        
        return jsonify({'success': True, 'data': employees})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get single employee
@gl_admin_salary_bp.route('/api/admin-salary/employees/<admin_id>', methods=['GET'])
@superadmin_required
def get_employee(admin_id):
    try:
        admin_ref = get_admins_ref().child(admin_id)
        admin_data = admin_ref.get() or {}
        
        info = admin_data.get('info', {})
        pay_rates = admin_data.get('payRates', {})
        
        base_salary = 0
        if pay_rates.get('rateType') == 'daily':
            base_salary = pay_rates.get('dailyRate', 0) * 22
        elif pay_rates.get('rateType') == 'cutoff':
            base_salary = pay_rates.get('cutoffRate', 0) * 2
        elif pay_rates.get('rateType') == 'monthly':
            base_salary = pay_rates.get('monthlyRate', 0)
        
        employee = {
            'id': admin_id,
            'name': info.get('fullName', 'Unknown'),
            'position': info.get('position', 'Staff'),
            'department': info.get('department', 'admin'),
            'baseSalary': base_salary,
            'email': info.get('email', ''),
            'phone': info.get('phone', ''),
            'hireDate': info.get('hireDate', ''),
            'status': info.get('status', 'active'),
            'address': info.get('address', ''),
            'emergencyContact': info.get('emergencyContact', ''),
            'rateType': pay_rates.get('rateType', 'monthly'),
            'effectiveDate': pay_rates.get('effectiveDate', '')
        }
        
        return jsonify({'success': True, 'data': employee})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Add new admin
@gl_admin_salary_bp.route('/api/admin-salary/add-admin', methods=['POST'])
@superadmin_required
def add_admin():
    try:
        data = request.json
        
        required_fields = ['fullName', 'email', 'position', 'department', 'rateType']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
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
                'dailyRate': data.get('dailyRate', 0),
                'cutoffRate': data.get('cutoffRate', 0),
                'monthlyRate': data.get('monthlyRate', 0)
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
        return jsonify({'success': False, 'error': str(e)}), 500

# Get salary history for an admin
@gl_admin_salary_bp.route('/api/admin-salary/history/<admin_id>', methods=['GET'])
@superadmin_required
def get_salary_history(admin_id):
    try:
        history_ref = get_admins_ref().child(admin_id).child('salaryHistory')
        history = history_ref.get() or {}
        
        # Get full salary records
        salary_ref = get_salary_records_ref()
        records = []
        for record_id, record_summary in history.items():
            full_record = salary_ref.child(record_id).get() or {}
            records.append({
                'id': record_id,
                **full_record,
                **record_summary
            })
        
        records.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get deductions history for an admin
@gl_admin_salary_bp.route('/api/admin-salary/deductions/<admin_id>', methods=['GET'])
@superadmin_required
def get_deductions_history(admin_id):
    try:
        deductions_ref = get_deductions_ref().order_by_child('employeeId').equal_to(admin_id)
        deductions = deductions_ref.get() or {}
        
        records = []
        for ded_id, ded_data in deductions.items():
            records.append({
                'id': ded_id,
                **ded_data
            })
        
        records.sort(key=lambda x: x.get('date', ''), reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get advances history for an admin
@gl_admin_salary_bp.route('/api/admin-salary/advances/<admin_id>', methods=['GET'])
@superadmin_required
def get_advances_history(admin_id):
    try:
        advances_ref = get_advances_ref().order_by_child('employeeId').equal_to(admin_id)
        advances = advances_ref.get() or {}
        
        records = []
        for adv_id, adv_data in advances.items():
            records.append({
                'id': adv_id,
                **adv_data
            })
        
        records.sort(key=lambda x: x.get('dateRequested', ''), reverse=True)
        
        return jsonify({'success': True, 'data': records})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Add deduction
@gl_admin_salary_bp.route('/api/admin-salary/add-deduction', methods=['POST'])
@superadmin_required
def add_deduction():
    try:
        data = request.json
        
        required_fields = ['adminId', 'type', 'amount', 'period']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        deduction_data = {
            'employeeId': data['adminId'],
            'type': data['type'],
            'amount': float(data['amount']),
            'period': data['period'],
            'description': data.get('description', ''),
            'status': 'pending',  # Start as pending until applied to salary
            'date': datetime.datetime.now().isoformat(),
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system')
        }
        
        # Save to Firebase
        deductions_ref = get_deductions_ref()
        new_deduction = deductions_ref.push(deduction_data)
        
        # Update admin's deductions history
        admin_ref = get_admins_ref().child(data['adminId']).child('deductionsHistory')
        admin_ref.child(new_deduction.key).set({
            'type': data['type'],
            'amount': float(data['amount']),
            'period': data['period'],
            'date': datetime.datetime.now().isoformat(),
            'status': 'pending'
        })
        
        return jsonify({
            'success': True,
            'message': 'Deduction added successfully',
            'data': {'id': new_deduction.key}
        }), 201
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Add advance
@gl_admin_salary_bp.route('/api/admin-salary/add-advance', methods=['POST'])
@superadmin_required
def add_advance():
    try:
        data = request.json
        
        required_fields = ['adminId', 'amount', 'reason', 'repaymentPeriod']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Calculate repayment amount if not provided
        amount = float(data['amount'])
        repayment_period = data['repaymentPeriod']
        repayment_amount = data.get('repaymentAmount')
        
        if not repayment_amount:
            if 'Next Payroll' in repayment_period:
                repayment_amount = amount
            elif '2 Cutoffs' in repayment_period:
                repayment_amount = amount / 2
            elif '3 Cutoffs' in repayment_period:
                repayment_amount = amount / 3
            elif '4 Cutoffs' in repayment_period:
                repayment_amount = amount / 4
            else:
                repayment_amount = amount / 2  # Default to 2 cutoffs
        
        advance_data = {
            'employeeId': data['adminId'],
            'amount': amount,
            'reason': data['reason'],
            'repaymentPeriod': repayment_period,
            'repaymentAmount': repayment_amount,
            'paidAmount': 0,
            'remainingBalance': amount,
            'status': 'approved',  # Auto-approve for now, can be changed to pending
            'dateRequested': datetime.datetime.now().isoformat(),
            'dateApproved': datetime.datetime.now().isoformat(),
            'notes': data.get('notes', ''),
            'createdAt': datetime.datetime.now().isoformat(),
            'createdBy': session.get('user_id', 'system')
        }
        
        # Save to Firebase
        advances_ref = get_advances_ref()
        new_advance = advances_ref.push(advance_data)
        
        # Update admin's advances history
        admin_ref = get_admins_ref().child(data['adminId']).child('advancesHistory')
        admin_ref.child(new_advance.key).set({
            'amount': amount,
            'status': 'approved',
            'dateRequested': advance_data['dateRequested']
        })
        
        return jsonify({
            'success': True,
            'message': 'Advance request submitted successfully',
            'data': {'id': new_advance.key}
        }), 201
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get summary statistics
@gl_admin_salary_bp.route('/api/admin-salary/summary', methods=['GET'])
@superadmin_required
def get_summary():
    try:
        # Get admins count
        admins_ref = get_admins_ref()
        admins = admins_ref.get() or {}
        active_admins = 0
        
        for admin in admins.values():
            if admin.get('info', {}).get('status') == 'active':
                active_admins += 1
        
        # Get salary records
        salary_ref = get_salary_records_ref()
        salary_records = salary_ref.get() or {}
        
        # Calculate monthly payroll
        current_month = datetime.datetime.now().strftime('%B %Y')
        monthly_payroll = 0
        pending_total = 0
        pending_count = 0
        ytd_total = 0
        current_year = datetime.datetime.now().year
        
        for record in salary_records.values():
            if record.get('payPeriod', '').startswith(current_month.split()[0]):
                monthly_payroll += float(record.get('netPay', 0))
            
            if record.get('paymentStatus') == 'pending':
                pending_total += float(record.get('netPay', 0))
                pending_count += 1
            
            if str(current_year) in record.get('payPeriod', ''):
                ytd_total += float(record.get('netPay', 0))
        
        summary = {
            'totalStaff': active_admins,
            'monthlyPayroll': monthly_payroll,
            'pendingPayments': pending_total,
            'pendingCount': pending_count,
            'ytdTotal': ytd_total,
            'monthlyPayrollPeriod': current_month
        }
        
        return jsonify({'success': True, 'data': summary})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Get analytics data
@gl_admin_salary_bp.route('/api/admin-salary/analytics', methods=['GET'])
@superadmin_required
def get_analytics():
    try:
        salary_ref = get_salary_records_ref()
        salary_records = salary_ref.get() or {}
        
        admins_ref = get_admins_ref()
        admins = admins_ref.get() or {}
        
        # Salary by department
        dept_salary = {}
        for admin in admins.values():
            info = admin.get('info', {})
            dept = info.get('department', 'other')
            pay_rates = admin.get('payRates', {})
            
            salary = 0
            if pay_rates.get('rateType') == 'daily':
                salary = pay_rates.get('dailyRate', 0) * 22
            elif pay_rates.get('rateType') == 'cutoff':
                salary = pay_rates.get('cutoffRate', 0) * 2
            else:
                salary = pay_rates.get('monthlyRate', 0)
            
            if dept not in dept_salary:
                dept_salary[dept] = 0
            dept_salary[dept] += salary
        
        # Monthly trend
        months = []
        monthly_data = []
        today = datetime.datetime.now()
        for i in range(5, -1, -1):
            month_date = today - datetime.timedelta(days=30*i)
            month_name = month_date.strftime('%b')
            months.append(month_name)
            
            month_total = 0
            for record in salary_records.values():
                if record.get('payPeriod', '').startswith(month_name):
                    month_total += float(record.get('netPay', 0))
            monthly_data.append(month_total)
        
        # Status distribution
        status_counts = {'paid': 0, 'pending': 0, 'processing': 0, 'cancelled': 0}
        for record in salary_records.values():
            status = record.get('paymentStatus', 'pending')
            if status in status_counts:
                status_counts[status] += 1
        
        # Top earners
        earner_list = []
        for admin_id, admin in admins.items():
            info = admin.get('info', {})
            total_paid = 0
            for record in salary_records.values():
                if record.get('employeeId') == admin_id and record.get('paymentStatus') == 'paid':
                    total_paid += float(record.get('netPay', 0))
            
            earner_list.append({
                'name': info.get('fullName', 'Unknown'),
                'position': info.get('position', 'N/A'),
                'salary': total_paid or info.get('baseSalary', 0)
            })
        
        earner_list.sort(key=lambda x: x['salary'], reverse=True)
        top_earners = earner_list[:5]
        
        analytics = {
            'salaryByDepartment': {
                'labels': list(dept_salary.keys()),
                'data': list(dept_salary.values())
            },
            'monthlyTrend': {
                'labels': months,
                'data': monthly_data
            },
            'statusDistribution': {
                'labels': list(status_counts.keys()),
                'data': list(status_counts.values())
            },
            'topEarners': top_earners
        }
        
        return jsonify({'success': True, 'data': analytics})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Process payroll
@gl_admin_salary_bp.route('/api/admin-salary/process-payroll', methods=['POST'])
@superadmin_required
def process_payroll():
    try:
        data = request.json
        pay_period = data.get('payrollPeriod')
        payment_date = data.get('payrollDate')
        payment_method = data.get('paymentMethod')
        employee_ids = data.get('employees', [])
        
        if not all([pay_period, payment_date, payment_method, employee_ids]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        admins_ref = get_admins_ref()
        salary_ref = get_salary_records_ref()
        
        # Get all data once
        all_admins = admins_ref.get() or {}
        all_salary_records = salary_ref.get() or {}
        all_deductions = db.reference('deductions').get() or {}
        all_advances = db.reference('advances').get() or {}
        
        created_records = []
        for emp_id in employee_ids:
            admin = all_admins.get(emp_id)
            if not admin:
                continue
            
            # Check if already exists
            existing = False
            for record in all_salary_records.values():
                if record.get('employeeId') == emp_id and record.get('payPeriod') == pay_period:
                    existing = True
                    break
            
            if existing:
                continue
            
            # Get pay rate
            pay_rates = admin.get('payRates', {})
            rate_type = pay_rates.get('rateType', 'monthly')
            base_salary = 0
            
            if rate_type == 'daily':
                base_salary = pay_rates.get('dailyRate', 0) * 15  # Half month
            elif rate_type == 'cutoff':
                base_salary = pay_rates.get('cutoffRate', 0)
            else:
                base_salary = pay_rates.get('monthlyRate', 0) / 2
            
            # Get pending deductions for this period
            pending_deductions = {'sss': 0, 'philhealth': 0, 'pagibig': 0, 'tax': 0, 'loan': 0, 'other': 0, 'total': 0}
            for ded_id, ded in all_deductions.items():
                if (ded.get('employeeId') == emp_id and 
                    ded.get('period') == pay_period and 
                    ded.get('status') == 'pending'):
                    
                    ded_type = ded.get('type', 'other')
                    amount = ded.get('amount', 0)
                    
                    if ded_type in pending_deductions:
                        pending_deductions[ded_type] += amount
                    else:
                        pending_deductions['other'] += amount
                    
                    pending_deductions['total'] += amount
            
            # Get pending advances
            pending_advances = 0
            advance_records = []  # Store which advances are being deducted
            for adv_id, adv in all_advances.items():
                if adv.get('employeeId') != emp_id:
                    continue
                    
                if adv.get('status') in ['approved', 'partially-paid'] and adv.get('remainingBalance', 0) > 0:
                    if 'Cutoff' in adv.get('repaymentPeriod', '') or 'Payroll' in adv.get('repaymentPeriod', ''):
                        repayment = min(adv.get('repaymentAmount', 0), adv.get('remainingBalance', 0))
                        pending_advances += repayment
                        advance_records.append({
                            'id': adv_id,
                            'repayment': repayment,
                            'schedule': adv.get('paymentSchedule', [])
                        })
            
            # Calculate totals
            tax = pending_deductions['tax'] or (base_salary * 0.12)
            sss = pending_deductions['sss'] or 1200
            philhealth = pending_deductions['philhealth'] or 800
            pagibig = pending_deductions['pagibig'] or 400
            loan = pending_deductions['loan']
            other = pending_deductions['other']
            
            total_deductions = tax + sss + philhealth + pagibig + loan + other + pending_advances
            net_pay = base_salary - total_deductions
            
            # Create salary record
            record_data = {
                'employeeId': emp_id,
                'payPeriod': pay_period,
                'baseSalary': base_salary,
                'allowances': 0,
                'overtimePay': 0,
                'bonus': 0,
                'taxDeduction': tax,
                'sssDeduction': sss,
                'philhealthDeduction': philhealth,
                'pagibigDeduction': pagibig,
                'loanDeduction': loan,
                'otherDeductions': other,
                'advanceDeduction': pending_advances,
                'totalEarnings': base_salary,
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
            created_records.append(new_record.key)
            
            # Update admin's salary history
            admin_ref = admins_ref.child(emp_id).child('salaryHistory')
            admin_ref.child(new_record.key).set({
                'period': pay_period,
                'netPay': net_pay,
                'status': 'processing',
                'paymentDate': payment_date,
                'createdAt': datetime.datetime.now().isoformat()
            })
            
            # Mark pending deductions as applied
            deductions_ref = db.reference('deductions')
            for ded_id, ded in all_deductions.items():
                if (ded.get('employeeId') == emp_id and 
                    ded.get('period') == pay_period and 
                    ded.get('status') == 'pending'):
                    deductions_ref.child(ded_id).update({
                        'status': 'applied',
                        'linkedSalaryRecord': new_record.key,
                        'appliedAt': datetime.datetime.now().isoformat()
                    })
            
            # FIXED: Update advance balances AND payment schedule
            advances_ref = db.reference('advances')
            for adv_record in advance_records:
                adv_id = adv_record['id']
                repayment = adv_record['repayment']
                schedule = adv_record['schedule']
                
                # Get current advance data
                adv = all_advances.get(adv_id, {})
                new_balance = adv.get('remainingBalance', 0) - repayment
                
                # Update payment schedule - find first pending and mark as paid
                for payment in schedule:
                    if payment.get('status') == 'pending':
                        payment['status'] = 'paid'
                        payment['paidDate'] = payment_date
                        payment['linkedSalaryRecord'] = new_record.key
                        break
                
                update_data = {
                    'remainingBalance': new_balance,
                    'paidAmount': adv.get('paidAmount', 0) + repayment,
                    'paymentSchedule': schedule,
                    'updatedAt': datetime.datetime.now().isoformat()
                }
                
                if new_balance <= 0:
                    update_data['status'] = 'paid'
                    update_data['datePaid'] = payment_date
                
                advances_ref.child(adv_id).update(update_data)
        
        return jsonify({
            'success': True,
            'message': f'Payroll processed for {len(created_records)} employees',
            'data': {'count': len(created_records)}
        })
        
    except Exception as e:
        print(f"Error in process_payroll: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Generate payslip
@gl_admin_salary_bp.route('/api/admin-salary/generate-payslip/<record_id>', methods=['GET'])
@superadmin_required
def generate_payslip(record_id):
    try:
        salary_ref = get_salary_records_ref().child(record_id)
        record = salary_ref.get()
        
        if not record:
            return jsonify({'success': False, 'error': 'Record not found'}), 404
        
        admin_id = record.get('employeeId')
        admin_ref = get_admins_ref().child(admin_id).child('info')
        admin = admin_ref.get() or {}
        
        payslip_data = {
            'recordId': record_id,
            'employee': {
                'id': admin_id,
                'name': admin.get('fullName', 'Unknown'),
                'position': admin.get('position', 'N/A'),
                'department': admin.get('department', 'N/A'),
                'email': admin.get('email', '')
            },
            'payPeriod': record.get('payPeriod'),
            'paymentDate': record.get('paymentDate'),
            'earnings': {
                'baseSalary': record.get('baseSalary', 0),
                'allowances': record.get('allowances', 0),
                'overtimePay': record.get('overtimePay', 0),
                'bonus': record.get('bonus', 0),
                'total': record.get('totalEarnings', 0)
            },
            'deductions': {
                'tax': record.get('taxDeduction', 0),
                'sss': record.get('sssDeduction', 0),
                'philhealth': record.get('philhealthDeduction', 0),
                'pagibig': record.get('pagibigDeduction', 0),
                'loan': record.get('loanDeduction', 0),
                'other': record.get('otherDeductions', 0),
                'advance': record.get('advanceDeduction', 0),
                'total': record.get('totalDeductions', 0)
            },
            'netPay': record.get('netPay', 0),
            'paymentMethod': record.get('paymentMethod', 'N/A'),
            'status': record.get('paymentStatus', 'N/A')
        }
        
        return jsonify({'success': True, 'data': payslip_data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Export report
@gl_admin_salary_bp.route('/api/admin-salary/export', methods=['POST'])
@superadmin_required
def export_report():
    try:
        data = request.json
        format_type = data.get('format', 'PDF')
        
        return jsonify({
            'success': True,
            'message': f'Report exported as {format_type}',
            'data': {'format': format_type}
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Helper functions
def filter_records(records, search, status, department, pay_period, date_range, start_date, end_date):
    filtered = records.copy()
    
    if search:
        search_lower = search.lower()
        filtered = [r for r in filtered if 
                   search_lower in r.get('employeeName', '').lower() or
                   search_lower in r.get('position', '').lower()]
    
    if status != 'all':
        filtered = [r for r in filtered if r.get('paymentStatus') == status]
    
    if department != 'all':
        filtered = [r for r in filtered if r.get('department') == department]
    
    if pay_period != 'all':
        filtered = [r for r in filtered if r.get('payPeriod') == pay_period]
    
    if date_range == 'custom' and start_date and end_date:
        filtered = [r for r in filtered if 
                   start_date <= r.get('paymentDate', '') <= end_date]
    
    return filtered