from flask import Blueprint, request, jsonify, session
from firebase_admin import db
from datetime import datetime
import logging

groups_bp = Blueprint('groups', __name__, url_prefix='/api')

# Get current user ID from session (you can adjust this based on your auth system)
def get_current_user_id():
    # Option 1: From session
    if 'user_id' in session:
        return session['user_id']
    
    # Option 2: From request header
    user_id = request.headers.get('X-User-ID')
    if user_id:
        return user_id
    
    # Option 3: Default user for demo (remove in production)
    return 'default_user'

@groups_bp.route('/groups', methods=['GET'])
def get_groups():
    """Get all groups for the current user"""
    try:
        user_id = get_current_user_id()
        groups_ref = db.reference(f'groups/{user_id}')
        groups = groups_ref.get() or {}
        
        return jsonify({
            'success': True,
            'groups': groups
        })
    except Exception as e:
        logging.error(f"Error getting groups: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@groups_bp.route('/groups', methods=['POST'])
def save_groups():
    """Save all groups for the current user"""
    try:
        user_id = get_current_user_id()
        data = request.json
        groups = data.get('groups', {})
        
        groups_ref = db.reference(f'groups/{user_id}')
        groups_ref.set(groups)
        
        return jsonify({
            'success': True,
            'message': 'Groups saved successfully'
        })
    except Exception as e:
        logging.error(f"Error saving groups: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@groups_bp.route('/groups/<group_id>', methods=['PUT'])
def update_group(group_id):
    """Update a specific group"""
    try:
        user_id = get_current_user_id()
        data = request.json
        
        group_ref = db.reference(f'groups/{user_id}/{group_id}')
        group_ref.update({
            'name': data.get('name'),
            'driverIds': data.get('driverIds', []),
            'visible': data.get('visible', True),
            'updatedAt': datetime.now().isoformat()
        })
        
        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error updating group: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@groups_bp.route('/groups/<group_id>', methods=['DELETE'])
def delete_group(group_id):
    """Delete a specific group"""
    try:
        user_id = get_current_user_id()
        group_ref = db.reference(f'groups/{user_id}/{group_id}')
        group_ref.delete()
        
        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"Error deleting group: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500