// Make all functions globally available
window.driverMarkers = {};
window.previousLocations = {};
window.lastValidSpeed = {};
window.lastUpdateTime = {};
window.addressCache = new Map();
window.activeInfoWindow = null;
window.map = null;

// Store all drivers (including those without location)
window.allDrivers = {};  // NEW: Store all drivers by UID
window.activeDriverUids = new Set();  // NEW: Track which drivers have active locations

// Group Management System
window.groups = {};
window.activeGroupId = null;
window.nextGroupId = 1;
window.openGroupPanelId = null;
window.groupsModified = false;
window.cachedDriverList = [];
window.uiUpdateTimer = null;
window.isRendering = false;
window.pendingGroupRebuild = false;  // NEW: Prevent excessive rebuilds

// SweetAlert Toast configuration
const Toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer);
        toast.addEventListener('mouseleave', Swal.resumeTimer);
    }
});

// Check if Google Maps is blocked
function isGoogleMapsBlocked() {
    return typeof google === 'undefined' || !google.maps || !google.maps.Map;
}

// Show error when Google Maps is blocked
function showGoogleMapsBlockedError() {
    const mapContainer = document.getElementById("map");
    if (mapContainer) {
        mapContainer.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center; flex-direction: column;">
                <i class="fas fa-map-marked-alt" style="font-size: 48px; color: #dc3545; margin-bottom: 15px;"></i>
                <h3 style="color: #dc3545; margin-bottom: 10px;">⚠️ Google Maps Blocked</h3>
                <p style="color: #6c757d; margin-bottom: 15px;">Google Maps API is being blocked by an ad blocker or browser extension.</p>
                <div style="background: #f1f3f4; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: left;">
                    <p style="margin: 5px 0;"><strong>Solutions:</strong></p>
                    <ul style="margin: 5px 0 0 20px; color: #5f6368;">
                        <li>Disable ad blocker for this site</li>
                        <li>Disable privacy extensions (uBlock Origin, Privacy Badger, etc.)</li>
                        <li>Try in incognito/private mode</li>
                        <li>Use a different browser</li>
                    </ul>
                </div>
                <button onclick="location.reload()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-sync-alt"></i> Retry
                </button>
            </div>
        `;
    }
}

// Groups Panel collapsible
const groupsPanel = document.getElementById('groupsPanel');
const groupsHeader = document.getElementById('groupsHeader');

if (groupsHeader) {
    groupsHeader.addEventListener('click', (e) => {
        if (e.target.closest('.create-group-btn')) return;
        groupsPanel.classList.toggle('expanded');
    });
}

// ==================== FIREBASE STORAGE FUNCTIONS ====================

// Save groups to Firebase
async function saveGroupsToFirebase() {
    try {
        const toSave = {};
        for (const [id, group] of Object.entries(window.groups)) {
            toSave[id] = {
                name: group.name,
                driverIds: Array.from(group.driverIds),
                visible: group.visible
            };
        }
        
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups: toSave })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save to Firebase');
        }
        
        console.log('Groups saved to Firebase');
        window.groupsModified = true;
    } catch (error) {
        console.error('Error saving to Firebase:', error);
        saveGroupsToStorage();
    }
}

// Load groups from Firebase
async function loadGroupsFromFirebase() {
    try {
        const response = await fetch('/api/groups');
        if (!response.ok) throw new Error('Failed to load from Firebase');
        
        const data = await response.json();
        
        if (data && data.groups && typeof data.groups === 'object') {
            window.groups = {};
            for (const [id, group] of Object.entries(data.groups)) {
                if (!group) continue;
                
                window.groups[id] = {
                    name: group.name || 'Unnamed Group',
                    driverIds: new Set(group.driverIds || []),
                    visible: group.visible !== false
                };
            }
            
            const ids = Object.keys(window.groups).map(Number).filter(id => !isNaN(id));
            if (ids.length > 0) {
                window.nextGroupId = Math.max(...ids) + 1;
            } else {
                window.nextGroupId = 1;
            }
            
            console.log('Groups loaded from Firebase', Object.keys(window.groups).length);
            return true;
        } else {
            console.log('No groups found in Firebase, initializing empty');
            window.groups = {};
            window.nextGroupId = 1;
            return false;
        }
    } catch (error) {
        console.error('Error loading from Firebase:', error);
        return false;
    }
}

// Fallback: Load groups from localStorage
function loadGroupsFromStorage() {
    const saved = localStorage.getItem('fleetGroups');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            window.groups = {};
            for (const [id, group] of Object.entries(parsed)) {
                window.groups[id] = {
                    name: group.name,
                    driverIds: new Set(group.driverIds),
                    visible: group.visible !== false
                };
            }
            const ids = Object.keys(window.groups).map(Number).filter(id => !isNaN(id));
            if (ids.length > 0) {
                window.nextGroupId = Math.max(...ids) + 1;
            }
            console.log('Groups loaded from localStorage');
        } catch(e) { console.warn("Failed to parse groups", e); }
    }
}

// Fallback: Save groups to localStorage
function saveGroupsToStorage() {
    const toSave = {};
    for (const [id, group] of Object.entries(window.groups)) {
        toSave[id] = {
            name: group.name,
            driverIds: Array.from(group.driverIds),
            visible: group.visible
        };
    }
    localStorage.setItem('fleetGroups', JSON.stringify(toSave));
    console.log('Groups saved to localStorage');
    window.groupsModified = true;
}

// ==================== GROUP CRUD OPERATIONS ====================

// Create a new group
window.createGroup = async function(groupName, selectedDriverIds = []) {
    if (!groupName || groupName.trim() === '') {
        Toast.fire({
            icon: 'error',
            title: 'Please enter a group name',
            background: '#fff',
            color: '#333'
        });
        return null;
    }
    
    const groupId = String(window.nextGroupId++);
    window.groups[groupId] = {
        name: groupName.trim(),
        driverIds: new Set(selectedDriverIds),
        visible: true
    };
    
    await saveGroupsToFirebase();
    renderGroupsList(); // Force rebuild only on explicit user action
    
    Toast.fire({
        icon: 'success',
        title: `Group "${groupName}" created successfully!`,
        background: '#fff',
        color: '#333'
    });
    
    return groupId;
};

// Delete a group
window.deleteGroup = async function(groupId) {
    if (!window.groups[groupId]) return;
    
    const groupName = window.groups[groupId].name;
    
    const result = await Swal.fire({
        title: 'Delete Group?',
        html: `Are you sure you want to delete "<strong>${escapeHtml(groupName)}</strong>"?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel',
        background: '#fff'
    });
    
    if (result.isConfirmed) {
        delete window.groups[groupId];
        
        if (window.activeGroupId === groupId) {
            window.activeGroupId = null;
        }
        
        if (window.openGroupPanelId === groupId) {
            window.openGroupPanelId = null;
        }
        
        await saveGroupsToFirebase();
        renderGroupsList();
        applyGroupFilter();
        
        Toast.fire({
            icon: 'success',
            title: `Group "${groupName}" deleted`,
            background: '#fff',
            color: '#333'
        });
    }
};

// Update group name
window.updateGroupName = async function(groupId, newName) {
    const group = window.groups[groupId];
    if (!group || !newName.trim()) return false;
    
    group.name = newName.trim();
    await saveGroupsToFirebase();
    renderGroupsList();
    
    Toast.fire({
        icon: 'success',
        title: `Group renamed to "${group.name}"`,
        background: '#fff',
        color: '#333'
    });
    
    return true;
};

// Select a group to show only its drivers on map
window.selectGroup = function(groupId) {
    if (!window.map) {
        Toast.fire({
            icon: 'warning',
            title: 'Map not ready',
            text: 'Please wait for the map to load',
            background: '#fff',
            color: '#333'
        });
        return;
    }
    
    if (groupId === window.activeGroupId) {
        window.activeGroupId = null;
        Toast.fire({
            icon: 'info',
            title: 'Showing all drivers',
            background: '#fff',
            color: '#333'
        });
    } else {
        window.activeGroupId = groupId;
        const group = window.groups[groupId];
        if (group) {
            Toast.fire({
                icon: 'success',
                title: `Showing group: ${group.name}`,
                html: `<span style="font-size: 0.9rem;">${group.driverIds.size} drivers in this group</span>`,
                background: '#fff',
                color: '#333'
            });
        }
    }
    
    document.querySelectorAll('.group-item').forEach(el => {
        if (el.dataset.groupId === groupId && window.activeGroupId === groupId) {
            el.classList.add('active-group');
        } else {
            el.classList.remove('active-group');
        }
    });
    
    applyGroupFilter();
};

// Apply current group filter to map markers
window.applyGroupFilter = function() {
    if (!window.driverMarkers) return;
    
    if (!window.activeGroupId) {
        for (const uid in window.driverMarkers) {
            if (window.driverMarkers[uid]) {
                window.driverMarkers[uid].setVisible(true);
            }
        }
        return;
    }
    
    const group = window.groups[window.activeGroupId];
    if (!group) {
        window.activeGroupId = null;
        for (const uid in window.driverMarkers) {
            if (window.driverMarkers[uid]) {
                window.driverMarkers[uid].setVisible(true);
            }
        }
        return;
    }
    
    const shouldShowGroup = group.visible;
    
    for (const uid in window.driverMarkers) {
        const isInGroup = group.driverIds.has(uid);
        const shouldBeVisible = shouldShowGroup && isInGroup;
        
        if (window.driverMarkers[uid]) {
            window.driverMarkers[uid].setVisible(shouldBeVisible);
        }
    }
};

// Toggle driver assignment panel for a group
window.toggleDriverPanel = function(groupId, event) {
    if (event) event.stopPropagation();
    
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const driversPanel = groupElement.querySelector('.group-drivers');
    if (!driversPanel) return;
    
    if (window.openGroupPanelId === groupId) {
        driversPanel.style.display = 'none';
        window.openGroupPanelId = null;
    } else {
        if (window.openGroupPanelId) {
            const prevOpenElement = document.querySelector(`.group-item[data-group-id="${window.openGroupPanelId}"]`);
            if (prevOpenElement) {
                const prevPanel = prevOpenElement.querySelector('.group-drivers');
                if (prevPanel) prevPanel.style.display = 'none';
            }
        }
        driversPanel.style.display = 'flex';
        window.openGroupPanelId = groupId;
        
        // Use setTimeout to ensure the panel is visible before populating
        setTimeout(() => {
            populateDriverCheckboxes(groupId, true);
        }, 10);
    }
};

// populate driver checkboxes from ALL drivers (not just those with markers)
window.populateDriverCheckboxes = function(groupId, preserveScroll = true) {
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const checkboxesContainer = groupElement.querySelector('.driver-checkboxes');
    if (!checkboxesContainer) return;
    
    const group = window.groups[groupId];
    if (!group) return;
    
    // Save scroll position
    let savedScrollTop = 0;
    if (preserveScroll) {
        savedScrollTop = checkboxesContainer.scrollTop;
    }
    
    // Build driver list from allDrivers
    const drivers = [];
    for (const [uid, driverInfo] of Object.entries(window.allDrivers)) {
        const name = driverInfo.name;
        drivers.push({ uid, name });
    }
    
    drivers.sort((a, b) => a.name.localeCompare(b.name));
    
    if (drivers.length === 0) {
        checkboxesContainer.innerHTML = '<div style="padding: 0.5rem; text-align: center; color: #9aa0a6;">No drivers available</div>';
        return;
    }
    
    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => {
        const existingLabels = checkboxesContainer.querySelectorAll('.driver-checkbox-label');
        
        if (existingLabels.length === drivers.length) {
            // Update in place - preserves checkbox states
            existingLabels.forEach((label, index) => {
                const checkbox = label.querySelector('.driver-checkbox');
                const span = label.querySelector('span');
                const driver = drivers[index];
                
                if (checkbox && span) {
                    if (span.textContent !== driver.name) {
                        span.textContent = driver.name;
                    }
                    // Don't change checkbox checked state - preserve user's selection
                    // const shouldBeChecked = group.driverIds.has(driver.uid);
                    // if (checkbox.checked !== shouldBeChecked) {
                    //     checkbox.checked = shouldBeChecked;
                    // }
                }
            });
        } else {
            // Only rebuild if driver count changed significantly
            const fragment = document.createDocumentFragment();
            drivers.forEach(driver => {
                const label = document.createElement('label');
                label.className = 'driver-checkbox-label';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'driver-checkbox';
                checkbox.value = driver.uid;
                checkbox.checked = group.driverIds.has(driver.uid);
                
                const span = document.createElement('span');
                span.textContent = driver.name;
                
                label.appendChild(checkbox);
                label.appendChild(span);
                fragment.appendChild(label);
            });
            
            checkboxesContainer.innerHTML = '';
            checkboxesContainer.appendChild(fragment);
        }
        
        // Restore scroll position
        if (preserveScroll && savedScrollTop) {
            checkboxesContainer.scrollTop = savedScrollTop;
        }
    });
};

// Save driver assignments for a group
window.saveDriverAssignments = async function(groupId, event) {
    if (event) event.stopPropagation();
    
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const driversPanel = groupElement.querySelector('.group-drivers');
    if (!driversPanel) return;
    
    const checkboxes = driversPanel.querySelectorAll('.driver-checkbox:checked');
    const selectedDriverIds = Array.from(checkboxes).map(cb => cb.value);
    
    const group = window.groups[groupId];
    if (group) {
        group.driverIds.clear();
        selectedDriverIds.forEach(id => group.driverIds.add(id));
        
        await saveGroupsToFirebase();
        
        // Close the panel
        driversPanel.style.display = 'none';
        window.openGroupPanelId = null;
        
        // Update only the driver count for this group instead of full rebuild
        const countElement = groupElement.querySelector('.group-count');
        if (countElement) {
            countElement.textContent = `(${group.driverIds.size})`;
        }
        
        // Update the group item active styling if needed
        if (window.activeGroupId === groupId) {
            applyGroupFilter();
        }
        
        Toast.fire({
            icon: 'success',
            title: 'Drivers Updated',
            html: `Updated drivers for "<strong>${escapeHtml(group.name)}</strong>"<br><span style="font-size: 0.85rem;">${selectedDriverIds.length} drivers assigned</span>`,
            background: '#fff',
            color: '#333'
        });
    }
};

// Cancel driver assignments
window.cancelDriverAssignments = function(groupId, event) {
    if (event) event.stopPropagation();
    
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const driversPanel = groupElement.querySelector('.group-drivers');
    if (driversPanel) {
        driversPanel.style.display = 'none';
        window.openGroupPanelId = null;
    }
};

// Optimized render groups list - ONLY rebuilds when groups actually change
function renderGroupsList() {
    if (window.isRendering) return;
    window.isRendering = true;
    
    const groupsContainer = document.getElementById('groupsList');
    if (!groupsContainer) {
        window.isRendering = false;
        return;
    }
    
    const groupsArray = Object.entries(window.groups);
    
    if (groupsArray.length === 0) {
        groupsContainer.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #9aa0a6; font-size: 0.85rem;">
                <i class="fas fa-users-slash" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
                No groups yet<br>
                <span style="font-size: 0.75rem;">Click + to create a group</span>
            </div>
        `;
        window.groupsModified = false;
        window.isRendering = false;
        return;
    }
    
    // Check if we need to rebuild or just update counts
    const existingGroups = groupsContainer.querySelectorAll('.group-item');
    if (existingGroups.length === groupsArray.length && !window.groupsModified) {
        // Just update counts and names without full rebuild
        groupsArray.forEach(([groupId, group]) => {
            const groupElement = groupsContainer.querySelector(`.group-item[data-group-id="${groupId}"]`);
            if (groupElement) {
                const countElement = groupElement.querySelector('.group-count');
                if (countElement && countElement.textContent !== `(${group.driverIds.size})`) {
                    countElement.textContent = `(${group.driverIds.size})`;
                }
                const nameElement = groupElement.querySelector('.group-name');
                if (nameElement && nameElement.textContent !== group.name) {
                    nameElement.textContent = group.name;
                }
                const iconElement = groupElement.querySelector('.group-info i');
                if (iconElement && window.activeGroupId === groupId) {
                    iconElement.style.color = '#1a73e8';
                    groupElement.classList.add('active-group');
                } else if (iconElement) {
                    iconElement.style.color = '#5f6368';
                    groupElement.classList.remove('active-group');
                }
            }
        });
        window.groupsModified = false;
        window.isRendering = false;
        return;
    }
    
    // Full rebuild only when necessary (group added/deleted/renamed)
    requestAnimationFrame(() => {
        const html = groupsArray.map(([groupId, group]) => {
            const isActive = window.activeGroupId === groupId;
            const driverCount = group.driverIds.size;
            const isPanelOpen = window.openGroupPanelId === groupId;
            
            return `
                <div class="group-item ${isActive ? 'active-group' : ''}" data-group-id="${groupId}">
                    <div class="group-header">
                        <div class="group-info" data-group-id="${groupId}">
                            <i class="fas fa-layer-group" style="font-size: 0.9rem; width: 20px; color: ${isActive ? '#1a73e8' : '#5f6368'}"></i>
                            <span class="group-name">${escapeHtml(group.name)}</span>
                            <span class="group-count">(${driverCount})</span>
                        </div>
                        <div class="group-actions">
                            <button class="group-action-btn group-assign" data-group-id="${groupId}" data-action="assign" title="Assign Drivers">
                                <i class="fas fa-user-plus"></i>
                            </button>
                            <button class="group-action-btn group-edit" data-group-id="${groupId}" data-action="edit" title="Edit Group Name">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="group-action-btn group-delete" data-group-id="${groupId}" data-action="delete" title="Delete Group">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="group-drivers" data-group-id="${groupId}" style="display: ${isPanelOpen ? 'flex' : 'none'};">
                        <div class="driver-selector">
                            <div class="driver-selector-header">
                                <span><i class="fas fa-users"></i> Assign Drivers to "${escapeHtml(group.name)}"</span>
                                <div class="selector-actions">
                                    <button class="done-assigning-btn" data-group-id="${groupId}"><i class="fas fa-check"></i> Save</button>
                                    <button class="cancel-assigning-btn" data-group-id="${groupId}"><i class="fas fa-times"></i> Cancel</button>
                                </div>
                            </div>
                            <div class="driver-checkboxes" data-group-id="${groupId}">
                                <div style="padding: 0.5rem; text-align: center; color: #9aa0a6;">Loading drivers...</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        groupsContainer.innerHTML = html;
        
        // Attach event listeners
        groupsArray.forEach(([groupId]) => {
            const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
            if (!groupElement) return;
            
            const groupInfo = groupElement.querySelector('.group-info');
            if (groupInfo) {
                groupInfo.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.selectGroup(groupId);
                });
            }
            
            const assignBtn = groupElement.querySelector('.group-assign');
            if (assignBtn) {
                assignBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.toggleDriverPanel(groupId, e);
                });
            }
            
            const editBtn = groupElement.querySelector('.group-edit');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showEditGroupDialog(groupId);
                });
            }
            
            const deleteBtn = groupElement.querySelector('.group-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.deleteGroup(groupId);
                });
            }
            
            const saveBtn = groupElement.querySelector('.done-assigning-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.saveDriverAssignments(groupId, e);
                });
            }
            
            const cancelBtn = groupElement.querySelector('.cancel-assigning-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.cancelDriverAssignments(groupId, e);
                });
            }
        });
        
        if (window.openGroupPanelId && window.groups[window.openGroupPanelId]) {
            populateDriverCheckboxes(window.openGroupPanelId);
        }
        
        window.groupsModified = false;
        window.isRendering = false;
    });
}

// Show edit group dialog with SweetAlert
async function showEditGroupDialog(groupId) {
    const group = window.groups[groupId];
    if (!group) return;
    
    const { value: newName } = await Swal.fire({
        title: 'Edit Group Name',
        input: 'text',
        inputLabel: 'Enter new group name',
        inputValue: group.name,
        showCancelButton: true,
        confirmButtonColor: '#1a73e8',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'Group name cannot be empty!';
            }
        }
    });
    
    if (newName && newName.trim() !== group.name) {
        await window.updateGroupName(groupId, newName.trim());
    }
}

// Show create group dialog with SweetAlert
async function showCreateGroupDialog() {
    const { value: groupName } = await Swal.fire({
        title: 'Create New Group',
        input: 'text',
        inputLabel: 'Enter group name',
        inputPlaceholder: 'e.g., Morning Shift, VIP Drivers, etc.',
        showCancelButton: true,
        confirmButtonColor: '#1a73e8',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Create',
        cancelButtonText: 'Cancel',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'Group name cannot be empty!';
            }
        }
    });
    
    if (groupName) {
        await window.createGroup(groupName, []);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Initialize groups
async function initializeGroups() {
    const loaded = await loadGroupsFromFirebase();
    if (!loaded) {
        loadGroupsFromStorage();
    }
    renderGroupsList();
    
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        const newBtn = createGroupBtn.cloneNode(true);
        createGroupBtn.parentNode.replaceChild(newBtn, createGroupBtn);
        newBtn.addEventListener('click', showCreateGroupDialog);
    }
}

// POLLING EVERY 1 SECOND
window.pollingInterval = null;
window.pollingDelay = 1000;
window.lastDataHash = {};
window.isUpdating = false;

const origin = { lat: 14.5222733, lng: 120.999655 };

const fixedLocations = [
    {
        id: "grand_west",
        name: "Grand West",
        fullName: "Grand Westside Manila Bay",
        lat: 14.5199,
        lng: 120.9828,
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    },
    {
        id: "nobu",
        name: "Nobu",
        fullName: "Nobu Hotel, City of Dreams Manila",
        lat: 14.523997,
        lng: 120.9930,
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    },
    {
        id: "hyatt",
        name: "Hyatt",
        fullName: "Hyatt Regency Manila, City of Dreams",
        lat: 14.52265,
        lng: 120.9927,
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    },
    {
        id: "solaire",
        name: "Solaire",
        fullName: "Entertainment City, 1 Aseana Ave, Tambo, Parañaque",
        lat: 14.5241,
        lng: 120.9808,
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    },
    {
        id: "moa_arena",
        name: "MOA Arena",
        fullName: "SM Mall of Asia Arena",
        lat: 14.531944,
        lng: 120.983611,
        icon: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    }
];

// Function to create fixed location markers
function createFixedLocationMarkers() {
    if (!window.map) {
        console.log("Map not ready yet, waiting...");
        setTimeout(createFixedLocationMarkers, 500);
        return;
    }
    
    console.log("Creating fixed location markers...");
    
    fixedLocations.forEach(location => {
        const marker = new google.maps.Marker({
            position: { lat: location.lat, lng: location.lng },
            map: window.map,
            title: location.fullName,
            animation: google.maps.Animation.DROP,
            icon: {
                url: location.icon,
                scaledSize: new google.maps.Size(32, 32),
                labelOrigin: new google.maps.Point(16, 32)
            },
            optimized: false
        });
        
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="min-width: 200px; padding: 12px; font-family: 'Segoe UI', Arial, sans-serif;">
                    <div style="font-size: 16px; font-weight: bold; color: #1a73e8; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 20px;">📍</span>
                        <span>${location.name}</span>
                    </div>
                    <div style="font-size: 12px; color: #5f6368; margin-bottom: 8px;">
                        ${location.fullName}
                    </div>
                    <div style="font-size: 11px; color: #9aa0a6; border-top: 1px solid #e8eaed; padding-top: 6px;">
                        ${location.lat.toFixed(4)}°, ${location.lng.toFixed(4)}°
                    </div>
                </div>
            `
        });
        
        marker.addListener("click", () => {
            closeActiveInfoWindow();
            infoWindow.open(window.map, marker);
            window.activeInfoWindow = infoWindow;
            
            if (typeof Toast !== 'undefined') {
                Toast.fire({
                    icon: 'info',
                    title: location.name,
                    text: location.fullName,
                    timer: 2000
                });
            }
        });
        
        console.log(`✅ Added marker for: ${location.name}`);
    });
}

let trafficLayer;
let trafficVisible = false;

// Initialize Google Map
function initializeMap() {
    console.log("initializeMap called");
    
    if (isGoogleMapsBlocked()) {
        console.error("Google Maps is blocked");
        showGoogleMapsBlockedError();
        return;
    }
    
    const mapContainer = document.getElementById("map");
    if (!mapContainer) {
        console.error("Map container not found");
        setTimeout(initializeMap, 500);
        return;
    }

    try {
        window.map = new google.maps.Map(mapContainer, {
            center: origin,
            zoom: 14,
            mapTypeId: "roadmap",
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true
        });

        new google.maps.Marker({
            position: origin,
            map: window.map,
            title: "My Garage",
            icon: {
                url: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
                scaledSize: new google.maps.Size(32, 32)
            }
        });

        createFixedLocationMarkers();

        trafficLayer = new google.maps.TrafficLayer();

        const trafficBtn = document.getElementById("btnToggleTraffic");
        if (trafficBtn) {
            const newTrafficBtn = trafficBtn.cloneNode(true);
            trafficBtn.parentNode.replaceChild(newTrafficBtn, trafficBtn);
            newTrafficBtn.addEventListener("click", () => {
                trafficVisible = !trafficVisible;
                if (trafficVisible) {
                    trafficLayer.setMap(window.map);
                    newTrafficBtn.innerHTML = '<i class="fas fa-map"></i> Hide Traffic';
                    newTrafficBtn.classList.add("active");
                    Toast.fire({
                        icon: 'info',
                        title: 'Traffic layer enabled',
                        timer: 1500
                    });
                } else {
                    trafficLayer.setMap(null);
                    newTrafficBtn.innerHTML = '<i class="fas fa-map"></i> Show Traffic';
                    newTrafficBtn.classList.remove("active");
                    Toast.fire({
                        icon: 'info',
                        title: 'Traffic layer disabled',
                        timer: 1500
                    });
                }
            });
        }

        window.map.addListener("click", () => {
            closeActiveInfoWindow();
        });

        initializeGroups();
        startPollingDrivers();
        
        google.maps.event.trigger(window.map, 'resize');
        console.log("Map initialized successfully");
        
        Toast.fire({
            icon: 'success',
            title: 'Map Loaded',
            text: 'Tracking drivers in real-time',
            timer: 2000
        });
        
    } catch (error) {
        console.error("Error initializing map:", error);
        if (error.message && error.message.includes('Map is not a constructor')) {
            showGoogleMapsBlockedError();
        } else {
            showMapError("Failed to initialize map. Please refresh the page.");
        }
    }
}

window.initMap = function() {
    setTimeout(initializeMap, 100);
};

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM ready, checking for map...");
    if (!isGoogleMapsBlocked() && document.getElementById('map')) {
        setTimeout(initializeMap, 100);
    }
});

function showMapError(message) {
    const mapContainer = document.getElementById("map");
    if (mapContainer) {
        mapContainer.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center; flex-direction: column;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #dc3545; margin-bottom: 15px;"></i>
                <p style="color: #dc3545; margin-bottom: 10px;">⚠️ ${message}</p>
                <button onclick="location.reload()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-sync-alt"></i> Refresh Page
                </button>
            </div>
        `;
    }
}

function closeActiveInfoWindow() {
    if (window.activeInfoWindow) {
        window.activeInfoWindow.close();
        window.activeInfoWindow = null;
    }
}

function startPollingDrivers() {
    if (typeof firebase === 'undefined' || !firebase.database) {
        console.error("Firebase not initialized, retrying...");
        setTimeout(startPollingDrivers, 1000);
        return;
    }

    if (window.pollingInterval) {
        clearInterval(window.pollingInterval);
    }

    fetchDriversData();

    window.pollingInterval = setInterval(() => {
        fetchDriversData();
    }, window.pollingDelay);

    console.log(`Polling started - fetching driver data every ${window.pollingDelay} ms`);
}

// FETCH ALL DRIVERS with role "driver"
async function fetchDriversData() {
    if (window.isUpdating) return;
    window.isUpdating = true;

    try {
        const usersRef = firebase.database().ref("users");
        const snapshot = await usersRef.once("value");
        const users = snapshot.val();
        
        if (!users) {
            // Clear all drivers if no users
            window.allDrivers = {};
            window.activeDriverUids.clear();
            clearAllMarkers();
            // Update UI only, don't rebuild groups
            if (window.updateDriverPanelList) setTimeout(window.updateDriverPanelList, 50);
            // Only update checkboxes if panel is open - don't rebuild groups
            if (window.openGroupPanelId && window.groups[window.openGroupPanelId]) {
                updateDriverCheckboxesOnly(window.openGroupPanelId);
            }
            window.isUpdating = false;
            return;
        }

        const now = Date.now();
        let markersChanged = false;
        const currentDriverUids = new Set();
        
        // Process ALL users, filter by role "driver"
        for (const [uid, user] of Object.entries(users)) {
            const role = user.role || "";
            if (role.toLowerCase() !== "driver") {
                if (window.driverMarkers[uid]) {
                    removeDriverMarker(uid);
                    markersChanged = true;
                }
                continue;
            }
            
            currentDriverUids.add(uid);
            const firstName = user.firstName || "";
            const lastName = user.lastName || "";
            const fullName = `${firstName} ${lastName}`.trim() || "Driver";
            
            // Store in allDrivers regardless of location
            window.allDrivers[uid] = {
                name: fullName,
                firstName: firstName,
                lastName: lastName,
                phone: user.phone || "",
                email: user.email || ""
            };
            
            const loc = user.currentLocation;
            
            if (!loc || loc.latitude == null || loc.longitude == null) {
                if (window.driverMarkers[uid]) {
                    removeDriverMarker(uid);
                    markersChanged = true;
                }
                continue;
            }
            
            currentDriverUids.add(uid);
            window.activeDriverUids.add(uid);
            
            if (!loc.timestamp) {
                loc.timestamp = now;
            }
            
            const speedVal = user.currentSpeed || loc.speed || 0;
            const locationHash = `${uid}_${loc.latitude.toFixed(6)}_${loc.longitude.toFixed(6)}_${loc.timestamp}_${speedVal}`;
            
            if (window.lastDataHash[uid] !== locationHash) {
                window.lastDataHash[uid] = locationHash;
                processDriverUpdate(uid, user, loc, now);
                markersChanged = true;
            }
        }
        
        // Remove drivers that are no longer drivers
        for (const uid of Object.keys(window.driverMarkers)) {
            if (!currentDriverUids.has(uid)) {
                removeDriverMarker(uid);
                markersChanged = true;
            }
        }
        
        // Only update UI elements, don't rebuild groups
        if (window.updateDriverPanelList) {
            setTimeout(window.updateDriverPanelList, 50);
        }
        
        // Update checkboxes if panel is open - WITHOUT rebuilding
        if (window.openGroupPanelId && window.groups[window.openGroupPanelId]) {
            updateDriverCheckboxesOnly(window.openGroupPanelId);
        }
        
        // Only update group counts, not full rebuild
        updateGroupCountsOnly();
        
    } catch (error) {
        console.error("Error fetching drivers:", error);
    } finally {
        window.isUpdating = false;
    }
}

// NEW: Update checkboxes without rebuilding the entire group list
function updateDriverCheckboxesOnly(groupId) {
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const checkboxesContainer = groupElement.querySelector('.driver-checkboxes');
    if (!checkboxesContainer) return;
    
    const group = window.groups[groupId];
    if (!group) return;
    
    const drivers = [];
    for (const [uid, driverInfo] of Object.entries(window.allDrivers)) {
        drivers.push({ uid, name: driverInfo.name });
    }
    drivers.sort((a, b) => a.name.localeCompare(b.name));
    
    const existingLabels = checkboxesContainer.querySelectorAll('.driver-checkbox-label');
    
    if (existingLabels.length === drivers.length) {
        // Just update names, preserve checked states
        existingLabels.forEach((label, index) => {
            const span = label.querySelector('span');
            const driver = drivers[index];
            if (span && span.textContent !== driver.name) {
                span.textContent = driver.name;
            }
        });
    } else {
        // Only rebuild if count changed
        populateDriverCheckboxes(groupId, true);
    }
}

function updateGroupCountsOnly() {
    for (const [groupId, group] of Object.entries(window.groups)) {
        const countElement = document.querySelector(`.group-item[data-group-id="${groupId}"] .group-count`);
        if (countElement && countElement.textContent !== `(${group.driverIds.size})`) {
            countElement.textContent = `(${group.driverIds.size})`;
        }
    }
}

// Helper function to remove a driver marker
function removeDriverMarker(uid) {
    if (window.activeInfoWindow && window.driverMarkers[uid]?.infoWindow === window.activeInfoWindow) {
        closeActiveInfoWindow();
    }
    if (window.driverMarkers[uid]) {
        window.driverMarkers[uid].setMap(null);
        delete window.driverMarkers[uid];
    }
    delete window.previousLocations[uid];
    delete window.lastValidSpeed[uid];
    delete window.lastUpdateTime[uid];
    delete window.lastDataHash[uid];
}

// Helper function to clear all markers
function clearAllMarkers() {
    for (const uid in window.driverMarkers) {
        if (window.driverMarkers[uid]) {
            window.driverMarkers[uid].setMap(null);
        }
    }
    window.driverMarkers = {};
    window.previousLocations = {};
    window.lastValidSpeed = {};
    window.lastUpdateTime = {};
    window.lastDataHash = {};
    window.activeDriverUids.clear();
}

function processDriverUpdate(uid, user, loc, timestamp) {
    let speedKmh = 0;
    
    if (user.currentSpeed !== undefined && user.currentSpeed !== null) {
        speedKmh = user.currentSpeed;
    } else if (loc.speed !== undefined && loc.speed !== null) {
        speedKmh = loc.speed;
    } else {
        if (window.previousLocations[uid]) {
            speedKmh = calculateSpeed(uid, loc, window.previousLocations[uid]);
        } else {
            window.lastValidSpeed[uid] = 0;
            speedKmh = 0;
        }
    }
    
    speedKmh = typeof speedKmh === 'number' ? speedKmh : 0;
    
    window.previousLocations[uid] = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp || timestamp
    };
    
    if (window.driverMarkers[uid]) {
        const marker = window.driverMarkers[uid];
        const newPosition = { lat: loc.latitude, lng: loc.longitude };
        marker.setPosition(newPosition);
        marker.setTitle(`${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver");
        marker.userData = { user, loc, speedKmh, lastUpdate: loc.timestamp || timestamp };
        
        if (window.activeInfoWindow && marker.infoWindow === window.activeInfoWindow) {
            updateInfoWindowContent(marker, user, loc, speedKmh);
        }
        
        if (window.activeGroupId) {
            const group = window.groups[window.activeGroupId];
            if (group) {
                const isInGroup = group.driverIds.has(uid);
                marker.setVisible(group.visible && isInGroup);
            }
        } else {
            marker.setVisible(true);
        }
    } else {
        createDriverMarker(uid, user, loc, speedKmh, timestamp);
    }
}

function createDriverMarker(uid, user, loc, speedKmh, timestamp) {
    let initialVisibility = true;
    if (window.activeGroupId) {
        const group = window.groups[window.activeGroupId];
        if (group) {
            initialVisibility = group.visible && group.driverIds.has(uid);
        }
    }
    
    const marker = new google.maps.Marker({
        position: { lat: loc.latitude, lng: loc.longitude },
        map: window.map,
        title: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver",
        animation: google.maps.Animation.DROP,
        visible: initialVisibility
    });
    
    const infoWindow = new google.maps.InfoWindow({
        content: createInfoWindowContent(user, loc, speedKmh, "Loading address...")
    });
    
    infoWindow.addListener("closeclick", () => {
        if (window.activeInfoWindow === infoWindow) {
            window.activeInfoWindow = null;
        }
    });
    
    marker.userData = { user, loc, speedKmh, lastUpdate: loc.timestamp || timestamp };
    marker.infoWindow = infoWindow;
    
    marker.addListener("click", (event) => {
        event.stop();
        closeActiveInfoWindow();
        
        const currentData = marker.userData;
        const driverName = `${currentData.user.firstName || ''} ${currentData.user.lastName || ''}`.trim() || 'Driver';
        
        reverseGeocode(currentData.loc.latitude, currentData.loc.longitude).then(address => {
            infoWindow.setContent(createInfoWindowContent(
                currentData.user, 
                currentData.loc, 
                currentData.speedKmh, 
                address
            ));
            infoWindow.open(window.map, marker);
            window.activeInfoWindow = infoWindow;
            
            Toast.fire({
                icon: 'info',
                title: driverName,
                html: `<span style="font-size: 0.85rem;">Speed: ${currentData.speedKmh.toFixed(1)} km/h</span>`,
                timer: 1500,
                background: '#fff',
                color: '#333'
            });
        });
    });
    
    window.driverMarkers[uid] = marker;
    
    reverseGeocode(loc.latitude, loc.longitude).then(address => {
        if (marker.infoWindow && marker.infoWindow.getContent().includes("Loading address...")) {
            marker.infoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
        }
    });
}

function calculateSpeed(uid, currentLoc, prevLoc) {
    if (!prevLoc) {
        window.lastValidSpeed[uid] = 0;
        return 0;
    }

    const currentTime = currentLoc.timestamp || Date.now();
    const prevTime = prevLoc.timestamp;
    
    const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(prevLoc.latitude, prevLoc.longitude),
        new google.maps.LatLng(currentLoc.latitude, currentLoc.longitude)
    );
    
    const timeDiffSec = (currentTime - prevTime) / 1000;
    const MIN_TIME_DIFF = 0.5;
    const MAX_TIME_DIFF = 30;
    const MIN_DISTANCE = 1;
    
    let speedKmh = 0;
    
    if (timeDiffSec >= MIN_TIME_DIFF && timeDiffSec <= MAX_TIME_DIFF) {
        if (distanceMeters >= MIN_DISTANCE) {
            speedKmh = (distanceMeters / timeDiffSec) * 3.6;
            
            if (window.lastValidSpeed[uid] > 0) {
                const maxChange = window.lastValidSpeed[uid] * 0.8;
                if (Math.abs(speedKmh - window.lastValidSpeed[uid]) > maxChange) {
                    speedKmh = window.lastValidSpeed[uid] + (Math.sign(speedKmh - window.lastValidSpeed[uid]) * maxChange);
                }
            }
            
            speedKmh = Math.min(speedKmh, 180);
            window.lastValidSpeed[uid] = speedKmh;
        } else {
            if (window.lastValidSpeed[uid] > 0) {
                speedKmh = Math.max(0, window.lastValidSpeed[uid] * 0.9);
                if (speedKmh < 0.3) speedKmh = 0;
                window.lastValidSpeed[uid] = speedKmh;
            }
        }
    } else {
        if (window.lastUpdateTime[uid] && (currentTime - window.lastUpdateTime[uid]) > MAX_TIME_DIFF * 1000) {
            speedKmh = 0;
            window.lastValidSpeed[uid] = 0;
        } else {
            speedKmh = window.lastValidSpeed[uid] || 0;
        }
    }
    
    window.lastUpdateTime[uid] = currentTime;
    return Math.max(0, speedKmh);
}

async function reverseGeocode(lat, lng) {
    const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    
    if (window.addressCache.has(cacheKey)) {
        const cached = window.addressCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 3600000) {
            return cached.address;
        }
    }

    try {
        const googleAddress = await tryGoogleGeocode(lat, lng);
        if (googleAddress) {
            window.addressCache.set(cacheKey, {
                address: googleAddress,
                timestamp: Date.now()
            });
            return googleAddress;
        }
    } catch (error) {
        console.warn("Google Geocoding failed:", error);
    }

    try {
        const osmAddress = await tryOpenStreetMapGeocode(lat, lng);
        if (osmAddress) {
            window.addressCache.set(cacheKey, {
                address: osmAddress,
                timestamp: Date.now()
            });
            return osmAddress;
        }
    } catch (error) {
        console.warn("OpenStreetMap Geocoding failed:", error);
    }

    const approximateLocation = getApproximateLocation(lat, lng);
    window.addressCache.set(cacheKey, {
        address: approximateLocation,
        timestamp: Date.now()
    });
    return approximateLocation;
}

async function tryGoogleGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=AIzaSyBZwE8kSgkloKvNgOEKhJUVyNS2He2NqT0`
        );
        const data = await response.json();
        
        if (data.status === "OK" && data.results.length > 0) {
            return data.results[0].formatted_address;
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function tryOpenStreetMapGeocode(lat, lng) {
    try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
            {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'FleetTrackingApp/1.0'
                }
            }
        );
        const data = await response.json();
        return data.display_name || null;
    } catch (error) {
        return null;
    }
}

function getApproximateLocation(lat, lng) {
    const manilaAreas = {
        '14.60,121.00': 'Quezon City',
        '14.58,120.98': 'Manila',
        '14.55,121.02': 'Makati',
        '14.53,121.00': 'Pasay',
        '14.56,121.05': 'Pasig',
        '14.54,121.04': 'Taguig',
        '14.62,121.03': 'Marikina',
        '14.47,120.98': 'Parañaque',
        '14.52,121.05': 'Mandaluyong'
    };
    
    let nearestArea = "Metro Manila";
    let minDistance = Infinity;
    const radius = 0.05;
    
    Object.entries(manilaAreas).forEach(([coords, area]) => {
        const [areaLat, areaLng] = coords.split(',').map(Number);
        const distance = Math.sqrt(
            Math.pow(lat - areaLat, 2) + 
            Math.pow(lng - areaLng, 2)
        );
        
        if (distance < minDistance && distance < radius) {
            minDistance = distance;
            nearestArea = area;
        }
    });
    
    if (minDistance < radius) {
        return `Near ${nearestArea}, Metro Manila`;
    }
    
    return `Location at ${lat.toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${lng.toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
}

function createInfoWindowContent(user, loc, speedKmh, address) {
    let speedColor = "#4CAF50";
    let speedIcon = "🚗";
    
    if (speedKmh > 80) {
        speedColor = "#F44336";
        speedIcon = "🚀";
    } else if (speedKmh > 40) {
        speedColor = "#FF9800";
        speedIcon = "⚡";
    } else if (speedKmh > 0) {
        speedIcon = "🚙";
    } else {
        speedIcon = "🅿️";
    }
    
    const timestamp = loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'Just now';
    
    return `
        <div style="min-width: 280px; max-width: 320px; padding: 15px; font-family: 'Segoe UI', Arial, sans-serif; background: white; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px; border-bottom: 2px solid #4285f4; padding-bottom: 8px; color: #1a73e8; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 24px;">👤</span>
                <span>${escapeHtml(user.firstName || "")} ${escapeHtml(user.lastName || "")}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; margin-bottom: 12px;">
                <div style="font-weight: 600; color: #5f6368;">Role:</div>
                <div style="color: #202124;">${escapeHtml(user.role || "driver")}</div>
                
                <div style="font-weight: 600; color: #5f6368;">Speed:</div>
                <div style="color: ${speedColor}; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                    <span>${speedIcon}</span>
                    <span>${speedKmh.toFixed(1)} km/h</span>
                </div>
                
                <div style="font-weight: 600; color: #5f6368;">Status:</div>
                <div style="color: #202124;">
                    ${speedKmh > 0 ? '<span style="color: #4CAF50;">● Moving</span>' : '<span style="color: #9e9e9e;">● Stationary</span>'}
                </div>
            </div>
            
            <div style="margin-bottom: 12px; background: #f8f9fa; padding: 10px; border-radius: 6px;">
                <div style="font-weight: 600; color: #5f6368; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                    <span>📍</span> Location
                </div>
                <div style="color: #202124; word-wrap: break-word; font-size: 14px; line-height: 1.4;">
                    ${escapeHtml(address)}
                </div>
                <div style="color: #5f6368; font-size: 12px; margin-top: 6px; font-family: monospace;">
                    ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
                </div>
            </div>
            
            <div style="color: #9aa0a6; font-size: 11px; border-top: 1px solid #e8eaed; padding-top: 8px; display: flex; align-items: center; gap: 4px;">
                <span>🕒</span>
                Last updated: ${timestamp}
            </div>
        </div>
    `;
}

function updateInfoWindowContent(marker, user, loc, speedKmh) {
    if (!marker.infoWindow || marker.infoWindow !== window.activeInfoWindow) return;
    
    reverseGeocode(loc.latitude, loc.longitude).then(address => {
        if (window.activeInfoWindow === marker.infoWindow) {
            marker.infoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
        }
    });
}

window.addEventListener('beforeunload', () => {
    if (window.pollingInterval) {
        clearInterval(window.pollingInterval);
    }
    if (window.uiUpdateTimer) {
        clearTimeout(window.uiUpdateTimer);
    }
});

window.showToastMessage = function(message) {
    Toast.fire({
        icon: 'info',
        title: message,
        timer: 2000,
        background: '#fff',
        color: '#333'
    });
};

window.focusOnDriver = function(uid, driverName) {
    const marker = window.driverMarkers[uid];
    
    if (!marker) {
        Toast.fire({
            icon: 'error',
            title: 'Driver not found',
            text: `${driverName} location not available`,
            background: '#fff',
            color: '#333'
        });
        return;
    }
    
    if (!window.map) {
        Toast.fire({
            icon: 'warning',
            title: 'Map not ready',
            text: 'Please wait for the map to load',
            background: '#fff',
            color: '#333'
        });
        return;
    }
    
    try {
        const position = marker.getPosition();
        if (!position) return;
        
        window.map.setCenter(position);
        window.map.setZoom(17);
        
        if (window.activeInfoWindow) {
            window.activeInfoWindow.close();
            window.activeInfoWindow = null;
        }
        
        const currentData = marker.userData;
        if (!currentData || !currentData.loc) return;
        
        reverseGeocode(currentData.loc.latitude, currentData.loc.longitude).then(address => {
            const infoContent = createInfoWindowContent(
                currentData.user, 
                currentData.loc, 
                currentData.speedKmh, 
                address
            );
            
            marker.infoWindow.setContent(infoContent);
            marker.infoWindow.open(window.map, marker);
            window.activeInfoWindow = marker.infoWindow;
            
            Toast.fire({
                icon: 'success',
                title: `📍 Focused on ${driverName}`,
                timer: 1500,
                background: '#fff',
                color: '#333'
            });
        });
        
    } catch (error) {
        console.error("Error focusing on driver:", error);
    }
};

// Driver panel list - shows ALL drivers (including those without location)
window.updateDriverPanelList = function() {
    const driverListEl = document.getElementById('driverList');
    const driverCountEl = document.getElementById('driverCount');
    
    if (!driverListEl) return;
    
    const drivers = [];
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    for (const [uid, driverInfo] of Object.entries(window.allDrivers)) {
        const marker = window.driverMarkers[uid];
        const isActive = marker && marker.userData;
        const speedKmh = isActive ? marker.userData.speedKmh : 0;
        const lastUpdate = isActive ? marker.userData.lastUpdate : 0;
        const isStale = isActive && lastUpdate && (now - lastUpdate) > FIVE_MINUTES;
        
        drivers.push({
            uid,
            name: driverInfo.name,
            speed: isActive ? speedKmh : 0,
            isActive: isActive,
            isStale: isStale
        });
    }
    
    drivers.sort((a, b) => a.name.localeCompare(b.name));
    
    driverCountEl.textContent = drivers.length;
    
    if (drivers.length === 0) {
        driverListEl.innerHTML = '<div style="padding: 2rem; text-align: center; color: #6c757d;"><i class="fas fa-truck" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>No drivers found</div>';
        return;
    }
    
    const existingItems = driverListEl.querySelectorAll('.driver-item');
    
    if (existingItems.length !== drivers.length) {
        rebuildDriverList(drivers);
        return;
    }
    
    let needsRebuild = false;
    
    drivers.forEach((driver, index) => {
        const existingItem = existingItems[index];
        if (!existingItem) {
            needsRebuild = true;
            return;
        }
        
        const existingUid = existingItem.getAttribute('data-uid');
        if (existingUid !== driver.uid) {
            needsRebuild = true;
            return;
        }
        
        const nameElement = existingItem.querySelector('.driver-name');
        if (nameElement) {
            const nameWithoutBadge = nameElement.childNodes[0]?.nodeValue || '';
            const newNameText = escapeHtml(driver.name);
            if (nameWithoutBadge.trim() !== newNameText) {
                const staleBadgeSpan = nameElement.querySelector('span');
                if (staleBadgeSpan) {
                    nameElement.innerHTML = `${escapeHtml(driver.name)} ${staleBadgeSpan.outerHTML}`;
                } else {
                    nameElement.innerHTML = escapeHtml(driver.name);
                }
            }
        }
        
        const staleBadgeSpan = existingItem.querySelector('.driver-name span');
        if (!driver.isActive) {
            existingItem.classList.add('stale-driver');
            if (!staleBadgeSpan) {
                const nameElement2 = existingItem.querySelector('.driver-name');
                if (nameElement2 && !nameElement2.innerHTML.includes('offline')) {
                    nameElement2.innerHTML = `${escapeHtml(driver.name)} <span style="margin-left: 6px; font-size: 0.6rem; color: #ff9800;">📍 offline</span>`;
                }
            }
        } else if (driver.isStale) {
            existingItem.classList.add('stale-driver');
            if (staleBadgeSpan && staleBadgeSpan.textContent !== '⏳ stale') {
                const nameElement2 = existingItem.querySelector('.driver-name');
                if (nameElement2) {
                    nameElement2.innerHTML = `${escapeHtml(driver.name)} <span style="margin-left: 6px; font-size: 0.6rem; color: #ff9800;">⏳ stale</span>`;
                }
            }
        } else {
            existingItem.classList.remove('stale-driver');
            if (staleBadgeSpan) {
                const nameElement2 = existingItem.querySelector('.driver-name');
                if (nameElement2) {
                    nameElement2.innerHTML = escapeHtml(driver.name);
                }
            }
        }
        
        const speedBadge = existingItem.querySelector('.speed-badge');
        if (speedBadge) {
            if (!driver.isActive) {
                speedBadge.innerHTML = `📱 Waiting for location...`;
                speedBadge.className = 'speed-badge speed-offline';
            } else {
                let speedClass = 'speed-normal';
                let speedText = 'Normal';
                let speedIcon = '🚗';
                
                if (driver.speed > 60) {
                    speedClass = 'speed-speeding';
                    speedText = 'Speeding!';
                    speedIcon = '🚨';
                } else if (driver.speed > 30) {
                    speedClass = 'speed-moderate';
                    speedText = 'Moderate';
                    speedIcon = '⚡';
                } else if (driver.speed === 0) {
                    speedIcon = '🅿️';
                }
                
                const newSpeedText = `${speedIcon} ${driver.speed.toFixed(1)} km/h`;
                const newClass = `speed-badge ${speedClass}`;
                
                if (speedBadge.textContent !== newSpeedText) {
                    speedBadge.innerHTML = `${speedIcon} ${driver.speed.toFixed(1)} km/h`;
                }
                if (speedBadge.className !== newClass) {
                    speedBadge.className = newClass;
                }
                
                const speedTextSpan = existingItem.querySelector('.driver-speed span:last-child');
                if (speedTextSpan && speedTextSpan.textContent !== speedText) {
                    speedTextSpan.textContent = speedText;
                }
            }
        }
        
        const avatar = existingItem.querySelector('.driver-avatar');
        if (avatar) {
            const initials = driver.name.split(' ').map(n => n[0]).join('').toUpperCase();
            if (avatar.textContent !== (initials || 'D')) {
                avatar.textContent = initials || 'D';
            }
        }
    });
    
    if (needsRebuild) {
        rebuildDriverList(drivers);
    }
};

function rebuildDriverList(drivers) {
    const driverListEl = document.getElementById('driverList');
    if (!driverListEl) return;
    
    const html = drivers.map(driver => {
        let speedClass = 'speed-normal';
        let speedText = 'Normal';
        let speedIcon = '🚗';
        let speedDisplay = '';
        
        if (!driver.isActive) {
            speedDisplay = '📱 Waiting for location...';
            speedClass = 'speed-offline';
        } else if (driver.speed > 60) {
            speedClass = 'speed-speeding';
            speedText = 'Speeding!';
            speedIcon = '🚨';
            speedDisplay = `${speedIcon} ${driver.speed.toFixed(1)} km/h`;
        } else if (driver.speed > 30) {
            speedClass = 'speed-moderate';
            speedText = 'Moderate';
            speedIcon = '⚡';
            speedDisplay = `${speedIcon} ${driver.speed.toFixed(1)} km/h`;
        } else if (driver.speed === 0) {
            speedDisplay = `🅿️ ${driver.speed.toFixed(1)} km/h`;
        } else {
            speedDisplay = `${speedIcon} ${driver.speed.toFixed(1)} km/h`;
        }
        
        const initials = driver.name.split(' ').map(n => n[0]).join('').toUpperCase();
        let staleClass = '';
        let staleBadge = '';
        
        if (!driver.isActive) {
            staleClass = 'stale-driver';
            staleBadge = '<span style="margin-left: 6px; font-size: 0.6rem; color: #ff9800;">📍 offline</span>';
        } else if (driver.isStale) {
            staleClass = 'stale-driver';
            staleBadge = '<span style="margin-left: 6px; font-size: 0.6rem; color: #ff9800;">⏳ stale</span>';
        }
        
        return `
            <div class="driver-item ${staleClass}" data-uid="${driver.uid}" data-driver-name="${driver.name}" style="cursor: pointer;">
                <div class="driver-avatar">${initials || 'D'}</div>
                <div class="driver-info">
                    <div class="driver-name">${escapeHtml(driver.name)} ${staleBadge}</div>
                    <div class="driver-speed">
                        <span class="speed-badge ${speedClass}">
                            ${!driver.isActive ? '📱 Waiting for location...' : speedDisplay}
                        </span>
                        ${driver.isActive ? `<span style="margin-left: 6px; font-size: 0.65rem;">${speedText}</span>` : ''}
                    </div>
                </div>
                <i class="fas ${driver.isActive ? 'fa-location-dot' : 'fa-circle-info'}" style="color: ${driver.isActive ? '#ffb347' : '#9aa0a6'};"></i>
            </div>
        `;
    }).join('');
    
    driverListEl.innerHTML = html;
    
    const driverItems = document.querySelectorAll('.driver-item');
    driverItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const uid = this.getAttribute('data-uid');
            const driverName = this.getAttribute('data-driver-name');
            window.focusOnDriver(uid, driverName);
        });
    });
}

const driverPanel = document.getElementById('driverPanel');
const panelHeader = document.getElementById('panelHeader');
if (panelHeader) {
    panelHeader.addEventListener('click', () => {
        driverPanel.classList.toggle('expanded');
    });
}

setInterval(() => {
    if (window.updateDriverPanelList) window.updateDriverPanelList();
}, 2000);

window.gm_authFailure = function() {
    console.error('Google Maps authentication failed');
    showGoogleMapsBlockedError();
};

console.log("TRACK DRIVERS SCRIPT LOADED - With SweetAlert2 & Firebase Cloud Storage - OPTIMIZED");