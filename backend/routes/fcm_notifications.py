# backend/routes/fcm_notifications.py
import requests
import os
from flask import Blueprint, request, jsonify
from decorators import admin_required
import firebase_admin
from firebase_admin import db, messaging
from datetime import datetime
import json

fcm_notifications = Blueprint("fcm_notifications", __name__)

@admin_required
@fcm_notifications.route("/api/driver/ring/<transaction_id>", methods=["POST"])
def ring_driver(transaction_id):
    """
    Send FCM notification to ring driver's phone for upcoming trip
    Using your existing RTDB structure
    """
    try:
        # Get schedule data from your schedules node
        schedule_ref = db.reference(f"schedules/{transaction_id}")
        schedule = schedule_ref.get()
        
        if not schedule:
            return jsonify({
                "success": False, 
                "error": "Schedule not found"
            }), 404
        
        # Get driver name from the current object
        driver_name = schedule.get("current", {}).get("driverName", "")
        
        if not driver_name or driver_name == "Unassigned":
            return jsonify({
                "success": False, 
                "error": "No driver assigned to this trip"
            }), 400
        
        # Find driver in users collection (where role = "driver")
        users_ref = db.reference("users")
        users = users_ref.get() or {}
        
        driver_token = None
        driver_id = None
        driver_data = None
        
        # Search for the driver in users collection
        for uid, user_data in users.items():
            # Check if user has role "driver" and name matches
            if (user_data.get("role") == "driver" and 
                f"{user_data.get('firstName', '')} {user_data.get('middleName', '')} {user_data.get('lastName', '')}".replace('  ', ' ').strip() == driver_name):
                
                driver_token = user_data.get("fcm_token")  # You'll need to add this field
                driver_id = uid
                driver_data = user_data
                break
        
        if not driver_token:
            # Driver hasn't registered FCM token yet
            return jsonify({
                "success": False,
                "error": "Driver not registered for push notifications",
                "driver_phone": driver_data.get("phone") if driver_data else None,
                "driver_name": driver_name
            }), 404
        
        # Get trip details for notification
        trip_number = schedule.get("tripNumber", "N/A")
        pickup_time = schedule.get("time", "")
        client_name = schedule.get("clientName", "")
        pickup_location = schedule.get("pickup", "")
        dropoff_location = schedule.get("dropOff", "")
        
        # Create FCM message using Firebase Admin SDK
        message = messaging.Message(
            notification=messaging.Notification(
                title="🔔 URGENT: Upcoming Trip Alert!",
                body=f"Trip #{trip_number} at {pickup_time} - {client_name}",
            ),
            data={
                "transaction_id": transaction_id,
                "trip_number": str(trip_number),
                "time": pickup_time,
                "client": client_name,
                "pickup": pickup_location,
                "dropoff": dropoff_location,
                "driver_name": driver_name,
                "type": "trip_alert",
                "action": "ring_driver",
                "priority": "high",
                "sound": "alarm"
            },
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    sound="default",
                    channel_id="trip_alerts",
                    priority="max",
                    default_vibrate_timings=True,
                    default_sound=True,
                    tag=f"trip_{transaction_id}"
                ),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        sound="default",
                        badge=1,
                        category="TRIP_ALERT"
                    ),
                ),
            ),
            token=driver_token,
        )
        
        # Send the message
        response = messaging.send(message)
        
        # Log the ring action (create new node for rings)
        rings_ref = db.reference(f"rings/{transaction_id}")
        ring_log = rings_ref.push({
            "driver_id": driver_id,
            "driver_name": driver_name,
            "timestamp": datetime.now().isoformat(),
            "status": "sent",
            "fcm_message_id": response,
            "trip_details": {
                "trip_number": trip_number,
                "time": pickup_time,
                "client": client_name
            }
        })
        
        # Update schedule with ring information
        schedule_ref.update({
            "lastRingTime": datetime.now().isoformat(),
            "ringCount": (schedule.get("ringCount", 0) or 0) + 1
        })
        
        return jsonify({
            "success": True,
            "message": f"Ring notification sent to {driver_name}",
            "fcm_message_id": response,
            "ring_log_id": ring_log.key
        }), 200
        
    except firebase_admin.exceptions.FirebaseError as e:
        print(f"Firebase error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        print(f"Error ringing driver: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@admin_required
@fcm_notifications.route("/api/driver/register-token", methods=["POST"])
def register_driver_token():
    """
    Endpoint for drivers to register their FCM token
    Updates the user record with fcm_token field
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")  # Firebase UID
        fcm_token = data.get("fcm_token")
        device_info = data.get("device_info", {})
        
        if not user_id or not fcm_token:
            return jsonify({
                "success": False, 
                "error": "Missing user_id or fcm_token"
            }), 400
        
        # Update user record with FCM token
        user_ref = db.reference(f"users/{user_id}")
        user = user_ref.get()
        
        if not user:
            return jsonify({
                "success": False,
                "error": "User not found"
            }), 404
        
        # Check if user is a driver
        if user.get("role") != "driver":
            return jsonify({
                "success": False,
                "error": "User is not a driver"
            }), 403
        
        # Update the user with FCM token
        user_ref.update({
            "fcm_token": fcm_token,
            "last_token_update": datetime.now().isoformat(),
            "device_info": device_info,
            "notifications_enabled": True
        })
        
        return jsonify({
            "success": True,
            "message": "FCM token registered successfully",
            "user_id": user_id
        }), 200
        
    except Exception as e:
        print(f"Error registering token: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@admin_required
@fcm_notifications.route("/api/driver/unregister-token", methods=["POST"])
def unregister_driver_token():
    """
    Remove FCM token when driver logs out
    """
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        
        if not user_id:
            return jsonify({"success": False, "error": "Missing user_id"}), 400
        
        user_ref = db.reference(f"users/{user_id}")
        user_ref.update({
            "fcm_token": None,
            "last_token_removed": datetime.now().isoformat(),
            "notifications_enabled": False
        })
        
        return jsonify({
            "success": True,
            "message": "Token unregistered"
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@admin_required
@fcm_notifications.route("/api/driver/ring-history/<transaction_id>", methods=["GET"])
def get_ring_history(transaction_id):
    """
    Get ring history for a specific trip
    """
    try:
        rings_ref = db.reference(f"rings/{transaction_id}")
        rings = rings_ref.get() or {}
        
        ring_list = []
        for ring_id, ring_data in rings.items():
            ring_data["id"] = ring_id
            ring_list.append(ring_data)
        
        # Sort by timestamp (newest first)
        ring_list.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        
        return jsonify({
            "success": True,
            "transaction_id": transaction_id,
            "rings": ring_list,
            "total_rings": len(ring_list)
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@admin_required
@fcm_notifications.route("/api/drivers/list", methods=["GET"])
def list_drivers():
    """
    List all drivers with their notification status
    """
    try:
        users_ref = db.reference("users")
        users = users_ref.get() or {}
        
        drivers = []
        for uid, user_data in users.items():
            if user_data.get("role") == "driver":
                # Construct full name
                first = user_data.get("firstName", "")
                middle = user_data.get("middleName", "")
                last = user_data.get("lastName", "")
                full_name = f"{first} {middle} {last}".replace("  ", " ").strip()
                
                drivers.append({
                    "id": uid,
                    "name": full_name,
                    "firstName": first,
                    "lastName": last,
                    "phone": user_data.get("phone"),
                    "email": user_data.get("email"),
                    "has_token": bool(user_data.get("fcm_token")),
                    "notifications_enabled": user_data.get("notifications_enabled", False),
                    "last_token_update": user_data.get("last_token_update"),
                    "active": user_data.get("active", False)
                })
        
        return jsonify({
            "success": True,
            "drivers": drivers,
            "total": len(drivers)
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@admin_required
@fcm_notifications.route("/api/schedules/<transaction_id>/ring-status", methods=["GET"])
def get_ring_status(transaction_id):
    """
    Get ring status for a specific schedule
    """
    try:
        schedule_ref = db.reference(f"schedules/{transaction_id}")
        schedule = schedule_ref.get()
        
        if not schedule:
            return jsonify({"success": False, "error": "Schedule not found"}), 404
        
        return jsonify({
            "success": True,
            "transaction_id": transaction_id,
            "lastRingTime": schedule.get("lastRingTime"),
            "ringCount": schedule.get("ringCount", 0)
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@admin_required
@fcm_notifications.route("/api/admin/migrate-driver-fields", methods=["POST"])
def migrate_driver_fields():
    """
    One-time migration to add fcm_token and notifications_enabled to all drivers
    """
    try:
        # Get all users
        users_ref = db.reference("users")
        users = users_ref.get() or {}
        
        updated_count = 0
        skipped_count = 0
        
        for uid, user_data in users.items():
            # Only update drivers
            if user_data.get("role") == "driver":
                # Check if fields already exist
                needs_update = False
                updates = {}
                
                if "fcm_token" not in user_data:
                    updates["fcm_token"] = ""
                    needs_update = True
                    
                if "notifications_enabled" not in user_data:
                    updates["notifications_enabled"] = True
                    needs_update = True
                
                if needs_update:
                    user_ref = db.reference(f"users/{uid}")
                    user_ref.update(updates)
                    updated_count += 1
                    print(f"Updated driver: {user_data.get('firstName')} {user_data.get('lastName')}")
                else:
                    skipped_count += 1
        
        return jsonify({
            "success": True,
            "message": "Driver fields migration complete",
            "updated": updated_count,
            "skipped": skipped_count
        }), 200
        
    except Exception as e:
        print(f"Migration error: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500