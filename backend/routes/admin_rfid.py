from flask import Blueprint, request, jsonify, current_app, session
from firebase_admin import db
from decorators import admin_required
from datetime import datetime
import traceback

admin_rfid_api = Blueprint("admin_rfid_api", __name__)

@admin_rfid_api.route("/api/admin/rfid/cards", methods=["GET"])
@admin_required
def get_rfid_cards():
    try:
        cards_ref = db.reference("rfidCards")
        cards = cards_ref.get() or {}
        
        cards_list = []
        for card_id, card_data in cards.items():
            cards_list.append({
                "id": card_id,
                "cardNumber": card_data.get("cardNumber", ""),
                "unitId": card_data.get("unitId", ""),
                "unitName": card_data.get("unitName"),      # ← Now stored directly
                "unitPlate": card_data.get("plateNumber"),  # ← Now stored directly
                "balance": float(card_data.get("balance", 0)),
                "status": card_data.get("status", "active"),
                "notes": card_data.get("notes", ""),
                "lastUpdated": card_data.get("lastUpdated", ""),
                "createdAt": card_data.get("createdAt", "")
            })
        
        return jsonify({"cards": cards_list}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching RFID cards: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET SINGLE RFID CARD
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>", methods=["GET"])
@admin_required
def get_rfid_card(card_id):
    try:
        card_ref = db.reference(f"rfidCards/{card_id}")
        card = card_ref.get()
        
        if not card:
            return jsonify({"error": "RFID card not found"}), 404
        
        # Get unit info if assigned
        if card.get("unitId"):
            unit_ref = db.reference(f"transportUnits/{card['unitId']}")
            unit = unit_ref.get()
            if unit:
                card["unitName"] = unit.get("transportUnit", "")
                card["unitPlate"] = unit.get("plateNumber", "")
        
        card["id"] = card_id
        return jsonify({"card": card}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching RFID card: {str(e)}")
        return jsonify({"error": str(e)}), 500

@admin_rfid_api.route("/api/admin/rfid/cards", methods=["POST"])
@admin_required
def create_rfid_card():
    try:
        data = request.get_json() or {}
        
        # Validate required fields
        if not data.get("cardNumber"):
            return jsonify({"error": "Card number is required"}), 400
        
        # Check if card number already exists
        cards_ref = db.reference("rfidCards")
        all_cards = cards_ref.get() or {}
        
        for card_id, card_data in all_cards.items():
            if card_data.get("cardNumber") == data["cardNumber"]:
                return jsonify({"error": "Card number already exists"}), 409
        
        # Get unit info if unitId is provided
        unit_name = None
        plate_number = None
        
        if data.get("unitId"):
            unit_ref = db.reference(f"transportUnits/{data['unitId']}")
            unit = unit_ref.get()
            if unit:
                unit_name = unit.get("transportUnit", "")
                plate_number = unit.get("plateNumber", "")
        
        # Prepare card data with unit info
        card_data = {
            "cardNumber": data["cardNumber"],
            "unitId": data.get("unitId") or None,
            "unitName": unit_name,           # ← ADD THIS
            "plateNumber": plate_number,     # ← ADD THIS
            "balance": float(data.get("balance", 0)),
            "status": data.get("status", "active"),
            "notes": data.get("notes", ""),
            "createdAt": {".sv": "timestamp"},
            "lastUpdated": {".sv": "timestamp"}
        }
        
        # Save to database
        new_card_ref = cards_ref.push(card_data)
        card_id = new_card_ref.key
        
        # Add to balance history
        if float(data.get("balance", 0)) > 0:
            history_ref = db.reference("rfidBalanceHistory")
            history_ref.push({
                "cardId": card_id,
                "cardNumber": data["cardNumber"],
                "plateNumber": plate_number,  # ← ADD THIS
                "type": "initial_balance",
                "amount": float(data.get("balance", 0)),
                "oldBalance": 0,
                "newBalance": float(data.get("balance", 0)),
                "note": "Initial card creation",
                "timestamp": {".sv": "timestamp"},
                "userId": session.get("uid", "system"),
                "userEmail": session.get("email", "system")
            })
        
        return jsonify({
            "message": "RFID card created successfully",
            "id": card_id
        }), 201
        
    except Exception as e:
        current_app.logger.error(f"Error creating RFID card: {str(e)}")
        return jsonify({"error": str(e)}), 500
    
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>", methods=["PUT"])
@admin_required
def update_rfid_card(card_id):
    try:
        data = request.get_json() or {}
        
        # Check if card exists
        card_ref = db.reference(f"rfidCards/{card_id}")
        existing = card_ref.get()
        
        if not existing:
            return jsonify({"error": "RFID card not found"}), 404
        
        # Check if card number is being changed and if it already exists
        if data.get("cardNumber") and data["cardNumber"] != existing.get("cardNumber"):
            cards_ref = db.reference("rfidCards")
            all_cards = cards_ref.get() or {}
            
            for cid, card_data in all_cards.items():
                if cid != card_id and card_data.get("cardNumber") == data["cardNumber"]:
                    return jsonify({"error": "Card number already exists"}), 409
        
        # Track balance changes
        old_balance = float(existing.get("balance", 0))
        new_balance = float(data.get("balance", old_balance))
        
        # Prepare update data
        update_data = {}
        allowed_fields = ["cardNumber", "status", "notes"]
        
        for field in allowed_fields:
            if field in data:
                update_data[field] = data[field] if data[field] else None
        
        # Handle unitId changes - fetch unit info if changed
        if "unitId" in data:
            new_unit_id = data["unitId"] if data["unitId"] else None
            old_unit_id = existing.get("unitId")
            
            if new_unit_id != old_unit_id:
                update_data["unitId"] = new_unit_id
                
                # Fetch and update unit info
                if new_unit_id:
                    unit_ref = db.reference(f"transportUnits/{new_unit_id}")
                    unit = unit_ref.get()
                    if unit:
                        update_data["unitName"] = unit.get("transportUnit", "")
                        update_data["plateNumber"] = unit.get("plateNumber", "")
                else:
                    update_data["unitName"] = None
                    update_data["plateNumber"] = None
        
        # Handle balance separately
        if "balance" in data and new_balance != old_balance:
            update_data["balance"] = new_balance
            
            # Create adjustment record
            adjustment = {
                "type": "manual_update",
                "oldBalance": old_balance,
                "newBalance": new_balance,
                "note": data.get("balance_note", "Manual balance update via edit"),
                "date": {".sv": "timestamp"}
            }
            update_data["lastAdjustment"] = adjustment
            
            # Add to balance history
            history_ref = db.reference("rfidBalanceHistory")
            history_ref.push({
                "cardId": card_id,
                "cardNumber": data.get("cardNumber", existing.get("cardNumber")),
                "plateNumber": existing.get("plateNumber"),  # ← ADD THIS
                "type": "manual_update",
                "amount": abs(new_balance - old_balance),
                "oldBalance": old_balance,
                "newBalance": new_balance,
                "note": data.get("balance_note", "Manual balance update via edit"),
                "timestamp": {".sv": "timestamp"},
                "userId": session.get("uid", "system"),
                "userEmail": session.get("email", "system")
            })
        
        update_data["lastUpdated"] = {".sv": "timestamp"}
        
        # Update in database
        card_ref.update(update_data)
        
        return jsonify({"message": "RFID card updated successfully"}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error updating RFID card: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# UPDATE BALANCE ONLY (PATCH)
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>/balance", methods=["PATCH"])
@admin_required
def update_balance(card_id):
    try:
        data = request.get_json() or {}
        
        if "balance" not in data:
            return jsonify({"error": "Balance is required"}), 400
        
        # Get current card data
        card_ref = db.reference(f"rfidCards/{card_id}")
        existing = card_ref.get()
        
        if not existing:
            return jsonify({"error": "RFID card not found"}), 404
        
        new_balance = float(data["balance"])
        old_balance = float(existing.get("balance", 0))
        
        # Don't update if same balance
        if new_balance == old_balance:
            return jsonify({"message": "Balance unchanged", "balance": new_balance}), 200
        
        # Create adjustment record
        adjustment = {
            "type": "manual",
            "oldBalance": old_balance,
            "newBalance": new_balance,
            "note": data.get("note", "Manual balance update"),
            "date": {".sv": "timestamp"}
        }
        
        # Update balance and add adjustment to history
        update_data = {
            "balance": new_balance,
            "lastUpdated": {".sv": "timestamp"},
            "lastAdjustment": adjustment
        }
        
        card_ref.update(update_data)
        
        # Add to balance history
        history_ref = db.reference("rfidBalanceHistory")
        history_ref.push({
            "cardId": card_id,
            "cardNumber": existing.get("cardNumber"),
            "type": "manual",
            "amount": abs(new_balance - old_balance),
            "oldBalance": old_balance,
            "newBalance": new_balance,
            "note": data.get("note", "Manual balance update"),
            "timestamp": {".sv": "timestamp"},
            "userId": session.get("uid", "system"),
            "userEmail": session.get("email", "system")
        })
        
        return jsonify({
            "message": "Balance updated successfully",
            "oldBalance": old_balance,
            "newBalance": new_balance
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error updating balance: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# ADJUST BALANCE (ADD/SUBTRACT)
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>/adjust", methods=["POST"])
@admin_required
def adjust_balance(card_id):
    try:
        data = request.get_json() or {}
        
        if "amount" not in data:
            return jsonify({"error": "Amount is required"}), 400
        
        adjustment_type = data.get("type", "add")  # 'add' or 'subtract'
        amount = float(data["amount"])
        
        if amount <= 0:
            return jsonify({"error": "Amount must be positive"}), 400
        
        # Get current card data
        card_ref = db.reference(f"rfidCards/{card_id}")
        existing = card_ref.get()
        
        if not existing:
            return jsonify({"error": "RFID card not found"}), 404
        
        old_balance = float(existing.get("balance", 0))
        
        # Calculate new balance
        if adjustment_type == "add":
            new_balance = old_balance + amount
            direction = "increased"
        else:  # subtract
            new_balance = old_balance - amount
            direction = "decreased"
            if new_balance < 0:
                return jsonify({"error": "Insufficient balance"}), 400
        
        # Create adjustment record
        adjustment = {
            "type": adjustment_type,
            "amount": amount,
            "oldBalance": old_balance,
            "newBalance": new_balance,
            "note": data.get("note", f"{adjustment_type.capitalize()} adjustment"),
            "date": {".sv": "timestamp"}
        }
        
        # Update balance and add adjustment to history
        update_data = {
            "balance": new_balance,
            "lastUpdated": {".sv": "timestamp"},
            "lastAdjustment": adjustment
        }
        
        card_ref.update(update_data)
        
        # Add to balance history
        history_ref = db.reference("rfidBalanceHistory")
        history_ref.push({
            "cardId": card_id,
            "cardNumber": existing.get("cardNumber"),
            "type": adjustment_type,
            "amount": amount,
            "oldBalance": old_balance,
            "newBalance": new_balance,
            "note": data.get("note", f"{adjustment_type.capitalize()} adjustment"),
            "timestamp": {".sv": "timestamp"},
            "userId": session.get("uid", "system"),
            "userEmail": session.get("email", "system"),
            "reference": data.get("reference", ""),
            "tollPlaza": data.get("tollPlaza", "") if adjustment_type == "subtract" else None,
            "plateNumber": data.get("plateNumber", "") if adjustment_type == "subtract" else None
        })
        
        return jsonify({
            "message": f"Balance {direction} successfully",
            "oldBalance": old_balance,
            "newBalance": new_balance,
            "amount": amount
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error adjusting balance: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# DELETE RFID CARD
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>", methods=["DELETE"])
@admin_required
def delete_rfid_card(card_id):
    try:
        # Check if card exists
        card_ref = db.reference(f"rfidCards/{card_id}")
        existing = card_ref.get()
        
        if not existing:
            return jsonify({"error": "RFID card not found"}), 404
        
        # Get card data for history
        card_number = existing.get("cardNumber")
        
        # Delete from database
        card_ref.delete()
        
        # Add deletion record to history (optional)
        history_ref = db.reference("rfidBalanceHistory")
        history_ref.push({
            "cardId": card_id,
            "cardNumber": card_number,
            "type": "card_deleted",
            "note": "RFID card deleted from system",
            "timestamp": {".sv": "timestamp"},
            "userId": session.get("uid", "system"),
            "userEmail": session.get("email", "system")
        })
        
        return jsonify({"message": "RFID card deleted successfully"}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error deleting RFID card: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# BULK UPDATE BALANCES
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/bulk/update", methods=["POST"])
@admin_required
def bulk_update_balances():
    try:
        data = request.get_json() or {}
        updates = data.get("updates", [])
        
        if not updates:
            return jsonify({"error": "No updates provided"}), 400
        
        results = {
            "success": [],
            "failed": []
        }
        
        history_ref = db.reference("rfidBalanceHistory")
        
        for update in updates:
            card_id = update.get("id")
            new_balance = update.get("balance")
            
            if not card_id or new_balance is None:
                results["failed"].append({
                    "id": card_id,
                    "error": "Missing id or balance"
                })
                continue
            
            try:
                card_ref = db.reference(f"rfidCards/{card_id}")
                existing = card_ref.get()
                
                if not existing:
                    results["failed"].append({
                        "id": card_id,
                        "error": "Card not found"
                    })
                    continue
                
                old_balance = float(existing.get("balance", 0))
                new_balance_float = float(new_balance)
                
                # Skip if same balance
                if old_balance == new_balance_float:
                    results["success"].append({
                        "id": card_id,
                        "oldBalance": old_balance,
                        "newBalance": new_balance_float,
                        "note": "No change"
                    })
                    continue
                
                # Create adjustment record
                adjustment = {
                    "type": "bulk_update",
                    "oldBalance": old_balance,
                    "newBalance": new_balance_float,
                    "date": {".sv": "timestamp"}
                }
                
                # Update balance
                card_ref.update({
                    "balance": new_balance_float,
                    "lastUpdated": {".sv": "timestamp"},
                    "lastAdjustment": adjustment
                })
                
                # Add to balance history
                history_ref.push({
                    "cardId": card_id,
                    "cardNumber": existing.get("cardNumber"),
                    "type": "bulk_update",
                    "amount": abs(new_balance_float - old_balance),
                    "oldBalance": old_balance,
                    "newBalance": new_balance_float,
                    "note": update.get("note", "Bulk balance update"),
                    "timestamp": {".sv": "timestamp"},
                    "userId": session.get("uid", "system"),
                    "userEmail": session.get("email", "system")
                })
                
                results["success"].append({
                    "id": card_id,
                    "oldBalance": old_balance,
                    "newBalance": new_balance_float
                })
                
            except Exception as e:
                results["failed"].append({
                    "id": card_id,
                    "error": str(e)
                })
        
        return jsonify({
            "message": f"Updated {len(results['success'])} cards, {len(results['failed'])} failed",
            "results": results
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk update: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET BALANCE HISTORY FOR A CARD
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/cards/<card_id>/history", methods=["GET"])
@admin_required
def get_card_history(card_id):
    try:
        # Check if card exists
        card_ref = db.reference(f"rfidCards/{card_id}")
        card = card_ref.get()
        
        if not card:
            return jsonify({"error": "RFID card not found"}), 404
        
        # Get history for this card
        history_ref = db.reference("rfidBalanceHistory")
        all_history = history_ref.get() or {}
        
        history_list = []
        for hist_id, hist_data in all_history.items():
            if hist_data.get("cardId") == card_id:
                hist_data["id"] = hist_id
                history_list.append(hist_data)
        
        # Sort by timestamp descending (newest first)
        history_list.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        
        return jsonify({
            "cardId": card_id,
            "cardNumber": card.get("cardNumber"),
            "history": history_list
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching card history: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET ALL BALANCE HISTORY (for General Ledger)
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/history", methods=["GET"])
@admin_required
def get_all_history():
    try:
        # Get query parameters for filtering
        card_id = request.args.get("cardId")
        start_date = request.args.get("startDate")
        end_date = request.args.get("endDate")
        history_type = request.args.get("type")
        limit = request.args.get("limit", 1000, type=int)
        
        history_ref = db.reference("rfidBalanceHistory")
        all_history = history_ref.get() or {}
        
        history_list = []
        for hist_id, hist_data in all_history.items():
            hist_data["id"] = hist_id
            history_list.append(hist_data)
        
        # Apply filters
        if card_id:
            history_list = [h for h in history_list if h.get("cardId") == card_id]
        
        if history_type:
            history_list = [h for h in history_list if h.get("type") == history_type]
        
        if start_date:
            try:
                start_ts = datetime.fromisoformat(start_date.replace('Z', '+00:00')).timestamp() * 1000
                history_list = [h for h in history_list if h.get("timestamp", 0) >= start_ts]
            except:
                pass
        
        if end_date:
            try:
                end_ts = datetime.fromisoformat(end_date.replace('Z', '+00:00')).timestamp() * 1000
                history_list = [h for h in history_list if h.get("timestamp", 0) <= end_ts]
            except:
                pass
        
        # Sort by timestamp descending (newest first)
        history_list.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        
        # Apply limit
        if limit and limit > 0:
            history_list = history_list[:limit]
        
        # Calculate summary statistics
        total_reloads = sum(h.get("amount", 0) for h in history_list if h.get("type") in ["add", "reload", "initial_balance"])
        total_deductions = sum(h.get("amount", 0) for h in history_list if h.get("type") in ["subtract", "toll_deduction"])
        
        summary = {
            "totalTransactions": len(history_list),
            "totalReloads": total_reloads,
            "totalDeductions": total_deductions,
            "netChange": total_reloads - total_deductions
        }
        
        return jsonify({
            "history": history_list,
            "summary": summary
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching history: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET BALANCE HISTORY SUMMARY (for General Ledger dashboard)
# -----------------------
@admin_rfid_api.route("/api/admin/rfid/history/summary", methods=["GET"])
@admin_required
def get_history_summary():
    try:
        # Get date range parameters
        start_date = request.args.get("startDate")
        end_date = request.args.get("endDate")
        
        history_ref = db.reference("rfidBalanceHistory")
        all_history = history_ref.get() or {}
        
        # Apply date filters if provided
        history_list = []
        for hist_id, hist_data in all_history.items():
            if start_date or end_date:
                timestamp = hist_data.get("timestamp", 0)
                
                if start_date:
                    try:
                        start_ts = datetime.fromisoformat(start_date.replace('Z', '+00:00')).timestamp() * 1000
                        if timestamp < start_ts:
                            continue
                    except:
                        pass
                
                if end_date:
                    try:
                        end_ts = datetime.fromisoformat(end_date.replace('Z', '+00:00')).timestamp() * 1000
                        if timestamp > end_ts:
                            continue
                    except:
                        pass
            
            history_list.append(hist_data)
        
        # Calculate summaries by type
        summary_by_type = {}
        total_amount = 0
        
        for h in history_list:
            h_type = h.get("type", "unknown")
            amount = h.get("amount", 0)
            
            if h_type not in summary_by_type:
                summary_by_type[h_type] = {
                    "count": 0,
                    "total": 0
                }
            
            summary_by_type[h_type]["count"] += 1
            summary_by_type[h_type]["total"] += amount
            total_amount += amount
        
        # Get unique cards count
        unique_cards = set(h.get("cardId") for h in history_list if h.get("cardId"))
        
        return jsonify({
            "totalTransactions": len(history_list),
            "uniqueCards": len(unique_cards),
            "totalAmount": total_amount,
            "summaryByType": summary_by_type,
            "period": {
                "startDate": start_date,
                "endDate": end_date
            }
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching history summary: {str(e)}")
        return jsonify({"error": str(e)}), 500

# -----------------------
# GET TRANSPORT UNITS FOR DROPDOWN
# -----------------------
@admin_rfid_api.route("/api/admin/transport-units/list", methods=["GET"])
@admin_required
def get_transport_units_list():
    try:
        units_ref = db.reference("transportUnits")
        units = units_ref.get() or {}
        
        units_list = []
        for unit_id, unit_data in units.items():
            units_list.append({
                "id": unit_id,
                "name": unit_data.get("transportUnit", ""),
                "plateNumber": unit_data.get("plateNumber", ""),
                "display": f"{unit_data.get('transportUnit', '')} ({unit_data.get('plateNumber', '')})"
            })
        
        # Sort by name
        units_list.sort(key=lambda x: x["name"])
        
        return jsonify({"units": units_list}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching transport units: {str(e)}")
        return jsonify({"error": str(e)}), 500

        # Add to your admin_rfid_api.py or create a new users API file

@admin_rfid_api.route("/api/admin/users/list", methods=["GET"])
@admin_required
def get_users_list():
    try:
        users_ref = db.reference("users")
        users = users_ref.get() or {}
        
        users_list = []
        for user_id, user_data in users.items():
            users_list.append({
                "id": user_id,
                "email": user_data.get("email", ""),
                "firstName": user_data.get("firstName", ""),
                "lastName": user_data.get("lastName", ""),
                "role": user_data.get("role", "")
            })
        
        return jsonify({"users": users_list}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching users: {str(e)}")
        return jsonify({"error": str(e)}), 500