import os
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from decorators import superadmin_required

maintenance_transactions_bp = Blueprint("maintenance_transactions", __name__, url_prefix="/api/maintenance")

# ---------------- GET ALL MAINTENANCE RECORDS ----------------
@maintenance_transactions_bp.route("/records", methods=["GET"])
@superadmin_required
def get_maintenance_records():
    try:
        ref = db.reference("maintenanceRecords")
        data = ref.get() or {}
        
        records = []
        for record_id, record in data.items():
            record["id"] = record_id
            records.append(record)
        
        # Debug: Print first few records to see transportUnit data
        print(f"Total records: {len(records)}")
        for i, record in enumerate(records[:3]):  # First 3 records
            transport_unit = record.get('transportUnit', {})
            print(f"Record {i+1}: ID={record.get('id')}, transportUnit={transport_unit.get('name')} ({transport_unit.get('plateNumber')})")
        
        return jsonify({
            "success": True,
            "records": records
        }), 200
    except Exception as e:
        print(f"Error in get_maintenance_records: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- GET SINGLE MAINTENANCE RECORD ----------------
@maintenance_transactions_bp.route("/records/<record_id>", methods=["GET"])
@superadmin_required
def get_maintenance_record(record_id):
    try:
        ref = db.reference(f"maintenanceRecords/{record_id}")
        record = ref.get()
        
        if not record:
            return jsonify({"error": "Record not found"}), 404
        
        record["id"] = record_id
        transport_unit = record.get('transportUnit', {})
        print(f"Single record - transportUnit: {transport_unit.get('name')} ({transport_unit.get('plateNumber')})")
        
        return jsonify({
            "success": True,
            "record": record
        }), 200
    except Exception as e:
        print(f"Error in get_maintenance_record: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- CREATE MAINTENANCE RECORD ----------------
@maintenance_transactions_bp.route("/records", methods=["POST"])
@superadmin_required
def create_maintenance_record():
    try:
        data = request.get_json()
        
        # Get user info from cookies
        user_email = request.cookies.get("user_email", "system")
        user_full_name = request.cookies.get("user_full_name", "System")
        
        # Validate required fields
        required_fields = ["date", "serviceType", "description", "cost"]
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        # transportUnit is now an object, not just an ID
        transport_unit = data.get("transportUnit")
        print(f"Creating record with transportUnit: {transport_unit.get('name') if transport_unit else 'None'}")
        
        # Create record with metadata
        record_data = {
            "date": data["date"],
            "transportUnit": transport_unit,  # Store the complete transport unit object
            "serviceType": data["serviceType"],
            "status": data.get("status", "pending"),
            "description": data["description"],
            "cost": float(data["cost"]),
            "mechanic": data.get("mechanic", ""),
            "odometerReading": data.get("odometerReading"),
            "nextDueDate": data.get("nextDueDate"),
            "nextDueOdometer": data.get("nextDueOdometer"),
            "notes": data.get("notes", ""),
            "createdAt": datetime.now().isoformat(),
            "createdBy": user_full_name,
            "createdByEmail": user_email,
            "lastModified": datetime.now().isoformat(),
            "lastModifiedBy": user_full_name,
            "history": [
                {
                    "timestamp": datetime.now().isoformat(),
                    "action": "created",
                    "user": user_full_name,
                    "userEmail": user_email,
                    "changes": [{"field": "initial", "old": None, "new": "Record created"}]
                }
            ]
        }
        
        # Save to Firebase
        ref = db.reference("maintenanceRecords").push()
        ref.set(record_data)
        
        return jsonify({
            "success": True,
            "id": ref.key,
            "message": "Maintenance record created successfully"
        }), 201
        
    except Exception as e:
        print(f"Error in create_maintenance_record: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- UPDATE MAINTENANCE RECORD ----------------
@maintenance_transactions_bp.route("/records/<record_id>", methods=["PUT", "PATCH"])
@superadmin_required
def update_maintenance_record(record_id):
    try:
        data = request.get_json()
        
        # Get user info from cookies
        user_email = request.cookies.get("user_email", "unknown")
        user_full_name = request.cookies.get("user_full_name", "Unknown")
        
        # Get existing record
        ref = db.reference(f"maintenanceRecords/{record_id}")
        existing = ref.get()
        
        if not existing:
            return jsonify({"error": "Record not found"}), 404
        
        # Track changes for history
        changes = []
        editable_fields = [
            "date", "transportUnit", "serviceType", "status", "description", "cost",
            "mechanic", "odometerReading", "nextDueDate", "nextDueOdometer", "notes"
        ]
        
        updates = {}
        for field in editable_fields:
            if field in data:
                old_val = existing.get(field)
                new_val = data[field]
                
                # For transportUnit, compare the name field
                if field == "transportUnit":
                    old_name = old_val.get('name') if old_val else None
                    new_name = new_val.get('name') if new_val else None
                    if old_name != new_name:
                        changes.append({
                            "field": field,
                            "old": old_val,
                            "new": new_val
                        })
                        updates[field] = new_val
                        print(f"TransportUnit changed from '{old_name}' to '{new_name}'")
                
                # For other fields
                elif field == "cost":
                    old_val = float(old_val) if old_val else 0
                    new_val = float(new_val) if new_val else 0
                    if old_val != new_val:
                        changes.append({
                            "field": field,
                            "old": old_val,
                            "new": new_val
                        })
                        updates[field] = new_val
                
                elif str(old_val) != str(new_val):
                    changes.append({
                        "field": field,
                        "old": old_val,
                        "new": new_val
                    })
                    updates[field] = new_val
        
        # Add metadata
        updates["lastModified"] = datetime.now().isoformat()
        updates["lastModifiedBy"] = user_full_name
        
        # Add to history
        if changes:
            history_entry = {
                "timestamp": datetime.now().isoformat(),
                "action": "updated",
                "user": user_full_name,
                "userEmail": user_email,
                "changes": changes
            }
            
            # Get existing history or create new
            history = existing.get("history", [])
            history.append(history_entry)
            updates["history"] = history
        
        # Update record
        if updates:
            ref.update(updates)
        
        return jsonify({
            "success": True,
            "id": record_id,
            "changes": changes
        }), 200
        
    except Exception as e:
        print(f"Error in update_maintenance_record: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- DELETE MAINTENANCE RECORD ----------------
@maintenance_transactions_bp.route("/records/<record_id>", methods=["DELETE"])
@superadmin_required
def delete_maintenance_record(record_id):
    try:
        ref = db.reference(f"maintenanceRecords/{record_id}")
        
        if not ref.get():
            return jsonify({"error": "Record not found"}), 404
        
        ref.delete()
        
        return jsonify({
            "success": True,
            "message": "Record deleted successfully"
        }), 200
        
    except Exception as e:
        print(f"Error in delete_maintenance_record: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- GET RECORD HISTORY ----------------
@maintenance_transactions_bp.route("/records/<record_id>/history", methods=["GET"])
@superadmin_required
def get_record_history(record_id):
    try:
        ref = db.reference(f"maintenanceRecords/{record_id}")
        record = ref.get()
        
        if not record:
            return jsonify({"error": "Record not found"}), 404
        
        history = record.get("history", [])
        
        return jsonify({
            "success": True,
            "history": history
        }), 200
        
    except Exception as e:
        print(f"Error in get_record_history: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- GET MAINTENANCE STATISTICS ----------------
@maintenance_transactions_bp.route("/statistics", methods=["GET"])
@superadmin_required
def get_maintenance_statistics():
    try:
        # Get all records
        records_ref = db.reference("maintenanceRecords")
        records_data = records_ref.get() or {}
        
        # Get date range from query params
        start_date = request.args.get("startDate")
        end_date = request.args.get("endDate")
        
        # Filter records by date if provided
        filtered_records = []
        for record_id, record in records_data.items():
            record_date = datetime.fromisoformat(record.get("date", "2000-01-01"))
            
            if start_date and end_date:
                start = datetime.fromisoformat(start_date)
                end = datetime.fromisoformat(end_date)
                if start <= record_date <= end:
                    filtered_records.append(record)
            else:
                filtered_records.append(record)
        
        # Calculate statistics
        total_records = len(filtered_records)
        total_cost = sum(float(r.get("cost", 0)) for r in filtered_records)
        
        # Status breakdown
        status_counts = {
            "completed": 0,
            "in-progress": 0,
            "pending": 0,
            "cancelled": 0
        }
        
        status_cost = {
            "completed": 0,
            "in-progress": 0,
            "pending": 0,
            "cancelled": 0
        }
        
        for record in filtered_records:
            status = record.get("status", "pending")
            cost = float(record.get("cost", 0))
            
            if status in status_counts:
                status_counts[status] += 1
                status_cost[status] += cost
        
        # Service type breakdown
        service_types = {}
        for record in filtered_records:
            service_type = record.get("serviceType", "other")
            cost = float(record.get("cost", 0))
            
            if service_type not in service_types:
                service_types[service_type] = {
                    "count": 0,
                    "cost": 0
                }
            
            service_types[service_type]["count"] += 1
            service_types[service_type]["cost"] += cost
        
        # Monthly trend
        monthly_trend = {}
        for record in filtered_records:
            date = datetime.fromisoformat(record.get("date", "2000-01-01"))
            month_key = date.strftime("%Y-%m")
            cost = float(record.get("cost", 0))
            
            if month_key not in monthly_trend:
                monthly_trend[month_key] = 0
            
            monthly_trend[month_key] += cost
        
        return jsonify({
            "success": True,
            "statistics": {
                "totalRecords": total_records,
                "totalCost": total_cost,
                "statusCounts": status_counts,
                "statusCosts": status_cost,
                "serviceTypes": service_types,
                "monthlyTrend": monthly_trend
            }
        }), 200
        
    except Exception as e:
        print(f"Error in get_maintenance_statistics: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- GET MAINTENANCE ALERTS ----------------
@maintenance_transactions_bp.route("/alerts", methods=["GET"])
@superadmin_required
def get_maintenance_alerts():
    try:
        records_ref = db.reference("maintenanceRecords")
        records_data = records_ref.get() or {}
        
        today = datetime.now()
        alerts = []
        
        for record_id, record in records_data.items():
            transport_unit = record.get("transportUnit", {})
            
            # Check for upcoming/overdue maintenance
            if record.get("nextDueDate"):
                due_date = datetime.fromisoformat(record["nextDueDate"])
                days_until_due = (due_date - today).days
                
                if 0 < days_until_due <= 7 and record.get("status") != "completed":
                    alerts.append({
                        "id": record_id,
                        "type": "upcoming",
                        "severity": "warning",
                        "message": f"Maintenance due in {days_until_due} days",
                        "record": {
                            "transportUnit": transport_unit,
                            "serviceType": record.get("serviceType"),
                            "dueDate": record["nextDueDate"]
                        }
                    })
                elif days_until_due <= 0 and record.get("status") != "completed":
                    alerts.append({
                        "id": record_id,
                        "type": "overdue",
                        "severity": "danger",
                        "message": f"Maintenance overdue by {abs(days_until_due)} days",
                        "record": {
                            "transportUnit": transport_unit,
                            "serviceType": record.get("serviceType"),
                            "dueDate": record["nextDueDate"]
                        }
                    })
            
            # Check for high-cost repairs
            cost = float(record.get("cost", 0))
            if cost > 10000:
                alerts.append({
                    "id": record_id,
                    "type": "high-cost",
                    "severity": "info",
                    "message": f"High-cost repair: ₱{cost:,.2f}",
                    "record": {
                        "transportUnit": transport_unit,
                        "serviceType": record.get("serviceType"),
                        "cost": cost
                    }
                })
        
        return jsonify({
            "success": True,
            "alerts": alerts,
            "total": len(alerts)
        }), 200
        
    except Exception as e:
        print(f"Error in get_maintenance_alerts: {e}")
        return jsonify({"error": str(e)}), 500

# ---------------- BULK OPERATIONS ----------------
@maintenance_transactions_bp.route("/records/bulk", methods=["POST"])
@superadmin_required
def bulk_operation():
    try:
        data = request.get_json()
        operation = data.get("operation")
        record_ids = data.get("recordIds", [])
        
        # Get user info
        user_full_name = request.cookies.get("user_full_name", "System")
        
        if not record_ids:
            return jsonify({"error": "No records specified"}), 400
        
        results = {
            "success": [],
            "failed": []
        }
        
        for record_id in record_ids:
            try:
                ref = db.reference(f"maintenanceRecords/{record_id}")
                record = ref.get()
                
                if not record:
                    results["failed"].append({"id": record_id, "error": "Record not found"})
                    continue
                
                if operation == "delete":
                    ref.delete()
                    results["success"].append(record_id)
                    
                elif operation == "status_update":
                    new_status = data.get("status")
                    if new_status:
                        ref.update({
                            "status": new_status,
                            "lastModified": datetime.now().isoformat(),
                            "lastModifiedBy": user_full_name
                        })
                        results["success"].append(record_id)
                    else:
                        results["failed"].append({"id": record_id, "error": "No status provided"})
                        
                else:
                    results["failed"].append({"id": record_id, "error": f"Unknown operation: {operation}"})
                    
            except Exception as e:
                results["failed"].append({"id": record_id, "error": str(e)})
        
        return jsonify({
            "success": True,
            "operation": operation,
            "results": results
        }), 200
        
    except Exception as e:
        print(f"Error in bulk_operation: {e}")
        return jsonify({"error": str(e)}), 500