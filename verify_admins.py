import firebase_admin
from firebase_admin import credentials, auth
import csv
import sys

cred = credentials.Certificate('backend/firebase-service-account.json')
firebase_admin.initialize_app(cred)

def verify_single_email(email):
    """Verify a single email address"""
    try:
        # Get user by email
        user = auth.get_user_by_email(email)
        
        # Update user to set emailVerified = True
        # The Admin SDK can directly set verification status [citation:2][citation:7]
        auth.update_user(
            user.uid,
            email_verified=True
        )
        print(f"✅ Verified: {email}")
        return True
        
    except auth.UserNotFoundError:
        print(f"❌ User not found: {email}")
        return False
    except Exception as e:
        print(f"❌ Error verifying {email}: {str(e)}")
        return False

def verify_emails_bulk(email_list):
    """Verify multiple emails at once"""
    results = {
        "success": [],
        "failed": []
    }
    
    print(f"\nStarting bulk verification for {len(email_list)} emails...\n")
    
    for email in email_list:
        if verify_single_email(email):
            results["success"].append(email)
        else:
            results["failed"].append(email)
    
    # Print summary
    print("\n" + "="*50)
    print(f"BULK VERIFICATION COMPLETE")
    print("="*50)
    print(f"✅ Successful: {len(results['success'])}")
    print(f"❌ Failed: {len(results['failed'])}")
    
    if results['failed']:
        print("\nFailed emails:")
        for email in results['failed']:
            print(f"  - {email}")
    
    return results

def verify_from_csv(csv_file_path, email_column='email'):
    """Read emails from CSV and verify them"""
    emails = []
    try:
        with open(csv_file_path, 'r') as file:
            reader = csv.DictReader(file)
            for row in reader:
                if email_column in row and row[email_column]:
                    emails.append(row[email_column].strip())
        
        print(f"Loaded {len(emails)} emails from {csv_file_path}")
        return verify_emails_bulk(emails)
        
    except Exception as e:
        print(f"Error reading CSV: {str(e)}")
        return None

def verify_admins_from_database():
    """Specifically verify all users with 'admin' role in your database"""
    from firebase_admin import db
    
    try:
        # Get all users from your Realtime Database
        users_ref = db.reference('/users')
        all_users = users_ref.get() or {}
        
        admin_emails = []
        for uid, user_data in all_users.items():
            if user_data.get('role') == 'admin':
                # Try to get email from different possible locations
                email = user_data.get('email')
                if not email:
                    # Try to get from Firebase Auth by UID
                    try:
                        user_record = auth.get_user(uid)
                        email = user_record.email
                    except:
                        pass
                
                if email:
                    admin_emails.append(email)
        
        print(f"Found {len(admin_emails)} admin users in database")
        return verify_emails_bulk(admin_emails)
        
    except Exception as e:
        print(f"Error reading from database: {str(e)}")
        return None

def verify_specific_admins():
    """Verify a hardcoded list of admin emails (quick option)"""
    admin_emails = [
        "demo.account@gmail.com",
    ]
    
    return verify_emails_bulk(admin_emails)

if __name__ == "__main__":
    print("Firebase Bulk Email Verification Script")
    print("1. Verify specific admin emails (hardcoded)")
    print("2. Verify admins from Firebase Database")
    print("3. Verify from CSV file")
    print("4. Verify single email")
    
    choice = input("\nSelect option (1-4): ").strip()
    
    if choice == "1":
        verify_specific_admins()
    
    elif choice == "2":
        verify_admins_from_database()
    
    elif choice == "3":
        csv_path = input("Enter path to CSV file: ").strip()
        email_col = input("Enter email column name (default: 'email'): ").strip() or 'email'
        verify_from_csv(csv_path, email_col)
    
    elif choice == "4":
        email = input("Enter email to verify: ").strip()
        verify_single_email(email)
    
    else:
        print("Invalid choice")