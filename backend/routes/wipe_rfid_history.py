# /OLStar/backend/scripts/wipe_rfid_history.py

import sys
import os
import firebase_admin
from firebase_admin import credentials, db
import time

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def initialize_firebase():
    """Initialize Firebase Admin SDK"""
    try:
        # Try to get the default app if already initialized
        firebase_admin.get_app()
    except ValueError:
        # Initialize with service account
        cred_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'firebase-service-account.json')
        
        if not os.path.exists(cred_path):
            print(f"❌ Service account key not found at: {cred_path}")
            print("Please download your service account key from Firebase Console")
            print("Project Settings > Service Accounts > Generate New Private Key")
            return False
        
        cred = credentials.Certificate(cred_path)
        
        # Get database URL from environment or use default
        database_url = os.environ.get('FIREBASE_DATABASE_URL', 'https://olstar-5e642-default-rtdb.asia-southeast1.firebasedatabase.app')
        
        firebase_admin.initialize_app(cred, {
            'databaseURL': database_url
        })
        print("✅ Firebase initialized successfully")
    
    return True

def wipe_rfid_history():
    """Delete all data in rfidBalanceHistory node"""
    print("\n🔍 RFID Balance History Wipe Tool")
    print("=" * 50)
    
    # Confirm with user
    print("\n⚠️  WARNING: This will PERMANENTLY DELETE all RFID balance history!")
    print("This action CANNOT be undone.")
    print("\nAffected node: /rfidBalanceHistory")
    
    response = input("\nAre you ABSOLUTELY sure? Type 'DELETE' to confirm: ")
    
    if response != "DELETE":
        print("❌ Operation cancelled.")
        return
    
    # Double confirmation
    print("\n⚠️  FINAL WARNING: This is your last chance!")
    response2 = input("Type 'YES DELETE ALL HISTORY' to proceed: ")
    
    if response2 != "YES DELETE ALL HISTORY":
        print("❌ Operation cancelled.")
        return
    
    try:
        # Initialize Firebase
        if not initialize_firebase():
            return
        
        # Get reference to rfidBalanceHistory node
        history_ref = db.reference('rfidBalanceHistory')
        
        # Check current size
        print("\n📊 Checking current history...")
        current_data = history_ref.get()
        
        if not current_data:
            print("✅ rfidBalanceHistory is already empty.")
            return
        
        record_count = len(current_data)
        print(f"📊 Found {record_count} records in history.")
        
        # Perform deletion
        print("\n🗑️  Deleting all history records...")
        history_ref.delete()
        
        # Verify deletion
        time.sleep(2)  # Wait for Firebase to process
        verify = history_ref.get()
        
        if not verify:
            print(f"\n✅ SUCCESS! Deleted {record_count} history records.")
            print("rfidBalanceHistory node is now empty.")
        else:
            remaining = len(verify)
            print(f"\n⚠️  Partial deletion. {remaining} records remain.")
            
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")

def wipe_specific_card_history(card_id=None):
    """Delete history for a specific card only"""
    if not card_id:
        card_id = input("Enter card ID to wipe history for: ").strip()
    
    if not card_id:
        print("❌ No card ID provided.")
        return
    
    print(f"\n🔍 Wiping history for card: {card_id}")
    print("⚠️  This will delete ALL balance history for this specific card!")
    
    response = input(f"\nType 'YES' to delete history for card {card_id}: ")
    
    if response != "YES":
        print("❌ Operation cancelled.")
        return
    
    try:
        if not initialize_firebase():
            return
        
        history_ref = db.reference('rfidBalanceHistory')
        all_history = history_ref.get() or {}
        
        # Find records for this card
        to_delete = []
        for hist_id, hist_data in all_history.items():
            if hist_data.get('cardId') == card_id:
                to_delete.append(hist_id)
        
        if not to_delete:
            print(f"✅ No history found for card {card_id}")
            return
        
        print(f"📊 Found {len(to_delete)} records to delete.")
        
        # Delete each record
        for hist_id in to_delete:
            history_ref.child(hist_id).delete()
            print(f"  Deleted: {hist_id}")
        
        print(f"\n✅ SUCCESS! Deleted {len(to_delete)} history records for card {card_id}")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")

def wipe_history_before_date():
    """Delete history older than a specific date"""
    print("\n📅 Delete history before a specific date")
    date_str = input("Enter date (YYYY-MM-DD): ").strip()
    
    try:
        from datetime import datetime
        target_date = datetime.strptime(date_str, "%Y-%m-%d")
        target_timestamp = target_date.timestamp() * 1000  # Convert to milliseconds
        
        print(f"⚠️  This will delete ALL history before {date_str}")
        response = input(f"Type 'YES' to confirm: ")
        
        if response != "YES":
            print("❌ Operation cancelled.")
            return
        
        if not initialize_firebase():
            return
        
        history_ref = db.reference('rfidBalanceHistory')
        all_history = history_ref.get() or {}
        
        to_delete = []
        for hist_id, hist_data in all_history.items():
            timestamp = hist_data.get('timestamp', 0)
            if timestamp < target_timestamp:
                to_delete.append(hist_id)
        
        if not to_delete:
            print(f"✅ No history found before {date_str}")
            return
        
        print(f"📊 Found {len(to_delete)} records to delete.")
        
        # Delete each record
        for hist_id in to_delete:
            history_ref.child(hist_id).delete()
        
        print(f"\n✅ SUCCESS! Deleted {len(to_delete)} history records before {date_str}")
        
    except ValueError:
        print("❌ Invalid date format. Use YYYY-MM-DD")
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")

def backup_history():
    """Backup history before wiping"""
    try:
        if not initialize_firebase():
            return
        
        history_ref = db.reference('rfidBalanceHistory')
        data = history_ref.get()
        
        if not data:
            print("No history to backup.")
            return
        
        # Create backup filename with timestamp
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = f"rfid_history_backup_{timestamp}.json"
        
        import json
        with open(backup_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"✅ Backup saved to: {backup_file}")
        return backup_file
        
    except Exception as e:
        print(f"❌ Backup failed: {str(e)}")
        return None

if __name__ == "__main__":
    print("\n" + "="*60)
    print("RFID BALANCE HISTORY MANAGEMENT")
    print("="*60)
    print("\nOptions:")
    print("1. Wipe ALL history (complete node)")
    print("2. Wipe history for specific card")
    print("3. Wipe history before date")
    print("4. Backup only (no wipe)")
    print("5. Exit")
    
    choice = input("\nSelect option (1-5): ").strip()
    
    if choice == "1":
        # Optional: Backup before wipe
        backup = input("Create backup before wiping? (y/n): ").lower()
        if backup == 'y':
            backup_history()
        wipe_rfid_history()
    
    elif choice == "2":
        wipe_specific_card_history()
    
    elif choice == "3":
        wipe_history_before_date()
    
    elif choice == "4":
        backup_history()
    
    elif choice == "5":
        print("Exiting...")
    
    else:
        print("Invalid option")