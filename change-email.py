import firebase_admin
from firebase_admin import auth, credentials
import sys

def initialize_firebase(service_account_path):
    """Initialize Firebase Admin SDK"""
    try:
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
        print("✓ Firebase initialized successfully")
        return True
    except Exception as e:
        print(f"✗ Failed to initialize Firebase: {e}")
        return False

def update_user_email(uid, new_email):
    """Update user's email address"""
    try:
        user = auth.update_user(uid, email=new_email)
        print(f"\n✓ Email updated successfully!")
        print(f"  User UID: {user.uid}")
        print(f"  New Email: {user.email}")
        return True
    except auth.UserNotFoundError:
        print(f"\n✗ User not found with UID: {uid}")
        return False
    except auth.EmailAlreadyExistsError:
        print(f"\n✗ Email '{new_email}' is already in use by another account")
        return False
    except Exception as e:
        print(f"\n✗ Error updating user: {e}")
        return False

def main():
    print("=" * 50)
    print("Firebase Authentication - Email Updater")
    print("=" * 50)
    
    # Get service account file path
    service_account_path = input("\nEnter path to serviceAccountKey.json: ").strip()
    
    # Initialize Firebase
    if not initialize_firebase(service_account_path):
        return
    
    # Get user UID
    uid = input("\nEnter user UID: ").strip()
    
    # Get new email
    new_email = input("Enter new email address: ").strip()
    
    # Confirm action
    print(f"\n⚠️  You are about to change the email for user: {uid}")
    print(f"   New email will be: {new_email}")
    confirm = input("\nAre you sure? (yes/no): ").strip().lower()
    
    if confirm == 'yes':
        update_user_email(uid, new_email)
    else:
        print("\nOperation cancelled.")

if __name__ == "__main__":
    main()