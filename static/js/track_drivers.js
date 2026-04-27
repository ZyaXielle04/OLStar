// Make all functions globally available
window.driverMarkers = {};
window.previousLocations = {};
window.lastValidSpeed = {};
window.lastUpdateTime = {};
window.addressCache = new Map();
window.activeInfoWindow = null;
window.map = null;

// Group Management System
window.groups = {};
window.activeGroupId = null;
window.nextGroupId = 1;
window.openGroupPanelId = null; // Track which group's driver selection panel is open

// Load groups from localStorage
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
        } catch(e) { console.warn("Failed to parse groups", e); }
    }
}

// Save groups to localStorage
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
}

// Create a new group
window.createGroup = function(groupName, selectedDriverIds = []) {
    if (!groupName || groupName.trim() === '') {
        showToastMessage('Please enter a group name');
        return null;
    }
    
    const groupId = String(window.nextGroupId++);
    window.groups[groupId] = {
        name: groupName.trim(),
        driverIds: new Set(selectedDriverIds),
        visible: true
    };
    
    saveGroupsToStorage();
    renderGroupsList();
    showToastMessage(`Group "${groupName}" created`);
    return groupId;
};

// Delete a group
window.deleteGroup = function(groupId) {
    if (!window.groups[groupId]) return;
    
    const groupName = window.groups[groupId].name;
    delete window.groups[groupId];
    
    if (window.activeGroupId === groupId) {
        window.activeGroupId = null;
    }
    
    if (window.openGroupPanelId === groupId) {
        window.openGroupPanelId = null;
    }
    
    saveGroupsToStorage();
    renderGroupsList();
    applyGroupFilter();
    showToastMessage(`Group "${groupName}" deleted`);
};

// Update group name
window.updateGroupName = function(groupId, newName) {
    const group = window.groups[groupId];
    if (!group || !newName.trim()) return false;
    
    group.name = newName.trim();
    saveGroupsToStorage();
    renderGroupsList();
    return true;
};

// Select a group to show only its drivers on map
window.selectGroup = function(groupId) {
    if (groupId === window.activeGroupId) {
        window.activeGroupId = null;
        showToastMessage('Showing all drivers');
    } else {
        window.activeGroupId = groupId;
        const group = window.groups[groupId];
        if (group) {
            showToastMessage(`Showing group: ${group.name} (${group.driverIds.size} drivers)`);
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
        // Close this panel
        driversPanel.style.display = 'none';
        window.openGroupPanelId = null;
    } else {
        // Close any open panel first
        if (window.openGroupPanelId) {
            const prevOpenElement = document.querySelector(`.group-item[data-group-id="${window.openGroupPanelId}"]`);
            if (prevOpenElement) {
                const prevPanel = prevOpenElement.querySelector('.group-drivers');
                if (prevPanel) prevPanel.style.display = 'none';
            }
        }
        // Open this panel
        driversPanel.style.display = 'flex';
        window.openGroupPanelId = groupId;
        populateDriverCheckboxes(groupId);
    }
};

// Populate driver checkboxes
function populateDriverCheckboxes(groupId) {
    const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupElement) return;
    
    const checkboxesContainer = groupElement.querySelector('.driver-checkboxes');
    if (!checkboxesContainer) return;
    
    const group = window.groups[groupId];
    if (!group) return;
    
    const drivers = [];
    for (const [uid, marker] of Object.entries(window.driverMarkers)) {
        if (marker && marker.userData) {
            const name = `${marker.userData.user.firstName || ''} ${marker.userData.user.lastName || ''}`.trim() || 'Driver';
            drivers.push({ uid, name });
        }
    }
    
    if (drivers.length === 0) {
        checkboxesContainer.innerHTML = '<div style="padding: 0.5rem; text-align: center; color: #9aa0a6;">No drivers available</div>';
        return;
    }
    
    checkboxesContainer.innerHTML = drivers.map(driver => `
        <label class="driver-checkbox-label">
            <input type="checkbox" class="driver-checkbox" value="${driver.uid}" ${group.driverIds.has(driver.uid) ? 'checked' : ''}>
            <span>${escapeHtml(driver.name)}</span>
        </label>
    `).join('');
}

// Save driver assignments for a group
window.saveDriverAssignments = function(groupId, event) {
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
        saveGroupsToStorage();
        
        // Close the panel
        driversPanel.style.display = 'none';
        window.openGroupPanelId = null;
        
        // Re-render groups list to update count
        renderGroupsList();
        
        // Reapply filter if this group is active
        if (window.activeGroupId === groupId) {
            applyGroupFilter();
        }
        showToastMessage(`Updated drivers for "${group.name}"`);
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

// Render the groups list in UI (bottom-left)
function renderGroupsList() {
    const groupsContainer = document.getElementById('groupsList');
    if (!groupsContainer) return;
    
    const groupsArray = Object.entries(window.groups);
    
    if (groupsArray.length === 0) {
        groupsContainer.innerHTML = `
            <div style="padding: 0.8rem; text-align: center; color: #9aa0a6; font-size: 0.85rem;">
                <i class="fas fa-users-slash"></i> No groups yet<br>
                <span style="font-size: 0.75rem;">Click + to create a group</span>
            </div>
        `;
        return;
    }
    
    groupsContainer.innerHTML = groupsArray.map(([groupId, group]) => {
        const isActive = window.activeGroupId === groupId;
        const driverCount = group.driverIds.size;
        const isPanelOpen = window.openGroupPanelId === groupId;
        
        return `
            <div class="group-item ${isActive ? 'active-group' : ''}" data-group-id="${groupId}">
                <div class="group-header">
                    <div class="group-info" data-group-id="${groupId}">
                        <i class="fas fa-layer-group" style="font-size: 0.9rem; width: 20px;"></i>
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
                                <button class="done-assigning-btn" data-group-id="${groupId}">✅ Save</button>
                                <button class="cancel-assigning-btn" data-group-id="${groupId}">✖️ Cancel</button>
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
    
    // Attach event listeners
    groupsArray.forEach(([groupId]) => {
        const groupElement = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
        if (!groupElement) return;
        
        // Click on group info selects the group
        const groupInfo = groupElement.querySelector('.group-info');
        if (groupInfo) {
            groupInfo.addEventListener('click', (e) => {
                e.stopPropagation();
                window.selectGroup(groupId);
            });
        }
        
        // Assign button - opens driver assignment panel
        const assignBtn = groupElement.querySelector('.group-assign');
        if (assignBtn) {
            assignBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.toggleDriverPanel(groupId, e);
            });
        }
        
        // Edit button
        const editBtn = groupElement.querySelector('.group-edit');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showEditGroupDialog(groupId);
            });
        }
        
        // Delete button
        const deleteBtn = groupElement.querySelector('.group-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete group "${window.groups[groupId]?.name}"?`)) {
                    window.deleteGroup(groupId);
                }
            });
        }
        
        // Save button
        const saveBtn = groupElement.querySelector('.done-assigning-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.saveDriverAssignments(groupId, e);
            });
        }
        
        // Cancel button
        const cancelBtn = groupElement.querySelector('.cancel-assigning-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.cancelDriverAssignments(groupId, e);
            });
        }
    });
    
    // If a panel is supposed to be open, populate its checkboxes
    if (window.openGroupPanelId && window.groups[window.openGroupPanelId]) {
        populateDriverCheckboxes(window.openGroupPanelId);
    }
}

function showEditGroupDialog(groupId) {
    const group = window.groups[groupId];
    if (!group) return;
    
    const newName = prompt('Enter new group name:', group.name);
    if (newName && newName.trim() && newName.trim() !== group.name) {
        window.updateGroupName(groupId, newName.trim());
    }
}

function showCreateGroupDialog() {
    const groupName = prompt('Enter group name:');
    if (groupName && groupName.trim()) {
        window.createGroup(groupName, []);
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

// Insert group panel UI into the page
function injectGroupPanelUI() {
    if (document.getElementById('groupPanel')) return;
    
    const mapContainer = document.querySelector('.map-container');
    
    const groupPanel = document.createElement('div');
    groupPanel.id = 'groupPanel';
    groupPanel.className = 'group-panel';
    groupPanel.innerHTML = `
        <div class="group-panel-header">
            <h3><i class="fas fa-users"></i> Driver Groups</h3>
            <button id="createGroupBtn" class="create-group-btn" title="Create New Group">
                <i class="fas fa-plus"></i>
            </button>
        </div>
        <div id="groupsList" class="groups-list">
            <div style="padding: 0.8rem; text-align: center; color: #9aa0a6;">Loading groups...</div>
        </div>
    `;
    
    if (mapContainer) {
        mapContainer.appendChild(groupPanel);
    } else {
        document.body.appendChild(groupPanel);
    }
    
    const createBtn = document.getElementById('createGroupBtn');
    if (createBtn) {
        createBtn.addEventListener('click', showCreateGroupDialog);
    }
    
    // Add CSS for group panel
    if (!document.getElementById('group-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'group-panel-styles';
        style.textContent = `
            .group-panel {
                position: absolute;
                bottom: 20px;
                left: 20px;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000;
                font-family: 'Inter', sans-serif;
                overflow: hidden;
            }
            
            .group-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: #1a73e8;
                color: white;
            }
            
            .group-panel-header h3 {
                margin: 0;
                font-size: 1rem;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .create-group-btn {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            
            .create-group-btn:hover {
                background: rgba(255,255,255,0.3);
            }
            
            .groups-list {
                max-height: 350px;
                overflow-y: auto;
                background: white;
            }
            
            .group-item {
                border-bottom: 1px solid #e8eaed;
            }
            
            .group-item.active-group {
                background: #e8f0fe;
                border-left: 3px solid #1a73e8;
            }
            
            .group-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
            }
            
            .group-header:hover {
                background: #f8f9fa;
            }
            
            .group-info {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                cursor: pointer;
            }
            
            .group-name {
                font-size: 0.9rem;
                font-weight: 500;
                color: #202124;
            }
            
            .group-count {
                font-size: 0.75rem;
                color: #5f6368;
                background: #f1f3f4;
                padding: 2px 6px;
                border-radius: 12px;
            }
            
            .group-actions {
                display: flex;
                gap: 4px;
            }
            
            .group-action-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 6px;
                border-radius: 4px;
                color: #5f6368;
                font-size: 0.8rem;
                transition: all 0.2s;
            }
            
            .group-action-btn:hover {
                background: #e8eaed;
            }
            
            .group-delete:hover {
                color: #dc3545;
            }
            
            .group-edit:hover {
                color: #1a73e8;
            }
            
            .group-assign:hover {
                color: #1a73e8;
            }
            
            .group-drivers {
                display: none;
                flex-direction: column;
                padding: 12px;
                background: #f8f9fa;
                border-top: 1px solid #e8eaed;
            }
            
            .driver-selector-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                font-size: 0.85rem;
                font-weight: 500;
                color: #202124;
                padding-bottom: 8px;
                border-bottom: 1px solid #e8eaed;
            }
            
            .selector-actions {
                display: flex;
                gap: 8px;
            }
            
            .done-assigning-btn, .cancel-assigning-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 0.75rem;
                transition: all 0.2s;
            }
            
            .done-assigning-btn {
                background: #1a73e8;
                color: white;
            }
            
            .done-assigning-btn:hover {
                background: #1557b0;
            }
            
            .cancel-assigning-btn {
                background: #e8eaed;
                color: #5f6368;
            }
            
            .cancel-assigning-btn:hover {
                background: #dadce0;
            }
            
            .driver-checkboxes {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 200px;
                overflow-y: auto;
            }
            
            .driver-checkbox-label {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 0.85rem;
                padding: 6px 8px;
                cursor: pointer;
                border-radius: 6px;
                transition: background 0.2s;
            }
            
            .driver-checkbox-label:hover {
                background: #e8eaed;
            }
            
            .driver-checkbox-label input {
                cursor: pointer;
            }
            
            @media (max-width: 768px) {
                .group-panel {
                    width: 280px;
                    bottom: 10px;
                    left: 10px;
                }
                .groups-list {
                    max-height: 250px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    loadGroupsFromStorage();
    renderGroupsList();
}

// POLLING EVERY 1 SECOND
window.pollingInterval = null;
window.pollingDelay = 1000;
window.lastDataHash = {};
window.isUpdating = false;

const origin = { lat: 14.5222733, lng: 120.999655 };
let trafficLayer;
let trafficVisible = false;

// ---------------- Initialize Google Map ----------------
window.initMap = function() {
  console.log("initMap called");
  
  const mapContainer = document.getElementById("map");
  if (!mapContainer) {
    console.error("Map container not found, retrying...");
    setTimeout(window.initMap, 500);
    return;
  }

  if (typeof google === 'undefined' || !google.maps) {
    console.error("Google Maps API not loaded");
    return;
  }

  try {
    window.map = new google.maps.Map(mapContainer, {
      center: origin,
      zoom: 18,
      mapTypeId: "roadmap",
      mapId: "DEMO_MAP_ID",
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true
    });

    // Origin Marker (Garage)
    new google.maps.Marker({
      position: origin,
      map: window.map,
      title: "My Garage",
      icon: {
        url: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
        scaledSize: new google.maps.Size(32, 32)
      }
    });

    // Initialize Traffic Layer
    trafficLayer = new google.maps.TrafficLayer();

    const trafficBtn = document.getElementById("btnToggleTraffic");
    if (trafficBtn) {
      trafficBtn.replaceWith(trafficBtn.cloneNode(true));
      const newTrafficBtn = document.getElementById("btnToggleTraffic");
      newTrafficBtn.addEventListener("click", () => {
        trafficVisible = !trafficVisible;
        if (trafficVisible) {
          trafficLayer.setMap(window.map);
          newTrafficBtn.innerText = "Hide Traffic";
          newTrafficBtn.classList.add("active");
        } else {
          trafficLayer.setMap(null);
          newTrafficBtn.innerText = "Show Traffic";
          newTrafficBtn.classList.remove("active");
        }
      });
    }

    // LOGOUT BUTTON
    const logoutBtn = document.getElementById("btnLogout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        console.log("Logout clicked - redirecting to login");
        
        fetch('/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin'
        }).catch(err => console.warn("Logout fetch error:", err));
        
        localStorage.clear();
        sessionStorage.clear();
        
        showToastMessage("Logging out...");
        
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
      });
    }

    window.map.addListener("click", () => {
      closeActiveInfoWindow();
    });

    // Inject group panel UI
    injectGroupPanelUI();
    
    // START POLLING
    startPollingDrivers();
    
    google.maps.event.trigger(window.map, 'resize');
    console.log(`Map initialized successfully - Polling mode active (every ${window.pollingDelay} ms)`);
    
  } catch (error) {
    console.error("Error initializing map:", error);
    showMapError("Failed to initialize map. Please refresh the page.");
  }
};

// ---------------- Show Map Error ----------------
function showMapError(message) {
  const mapContainer = document.getElementById("map");
  if (mapContainer) {
    mapContainer.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; height: 100%; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
        <div>
          <p style="color: #dc3545; margin-bottom: 10px;">⚠️ ${message}</p>
          <button onclick="location.reload()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Refresh Page
          </button>
        </div>
      </div>
    `;
  }
}

// ---------------- Close Active Info Window Helper ----------------
function closeActiveInfoWindow() {
  if (window.activeInfoWindow) {
    window.activeInfoWindow.close();
    window.activeInfoWindow = null;
  }
}

// ---------------- START POLLING ----------------
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

// ---------------- Fetch ALL drivers ----------------
async function fetchDriversData() {
  if (window.isUpdating) {
    return;
  }

  window.isUpdating = true;

  try {
    const usersRef = firebase.database().ref("users");
    const snapshot = await usersRef.once("value");
    const users = snapshot.val();
    
    if (!users) {
      const allUids = Object.keys(window.driverMarkers);
      if (allUids.length > 0) {
        allUids.forEach(uid => {
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
        });
        if (window.updateDriverPanelList) setTimeout(window.updateDriverPanelList, 50);
      }
      window.isUpdating = false;
      return;
    }

    const now = Date.now();

    for (const [uid, user] of Object.entries(users)) {
      const loc = user.currentLocation;
      
      if (!loc || loc.latitude == null || loc.longitude == null) {
        if (window.driverMarkers[uid]) {
          if (window.activeInfoWindow && window.driverMarkers[uid]?.infoWindow === window.activeInfoWindow) {
            closeActiveInfoWindow();
          }
          window.driverMarkers[uid].setMap(null);
          delete window.driverMarkers[uid];
          delete window.previousLocations[uid];
          delete window.lastValidSpeed[uid];
          delete window.lastUpdateTime[uid];
          delete window.lastDataHash[uid];
        }
        continue;
      }
      
      if (!loc.timestamp) {
        loc.timestamp = now;
      }
      
      const speedVal = user.currentSpeed || loc.speed || 0;
      const locationHash = `${uid}_${loc.latitude.toFixed(6)}_${loc.longitude.toFixed(6)}_${loc.timestamp}_${speedVal}`;
      
      if (window.lastDataHash[uid] !== locationHash) {
        window.lastDataHash[uid] = locationHash;
        processDriverUpdate(uid, user, loc, now);
      }
    }
    
    Object.keys(window.driverMarkers).forEach(uid => {
      if (!users[uid] || !users[uid].currentLocation) {
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
    });
    
    if (window.updateDriverPanelList) {
      setTimeout(window.updateDriverPanelList, 50);
    }
    
    // Only update groups list if no panel is open, or update counts without closing panels
    if (window.openGroupPanelId) {
      // Just update the driver checkboxes content without re-rendering everything
      populateDriverCheckboxes(window.openGroupPanelId);
      // Update group counts without closing panels
      updateGroupCountsOnly();
    } else {
      renderGroupsList();
    }
    
  } catch (error) {
    console.error("Error fetching drivers:", error);
  } finally {
    window.isUpdating = false;
  }
}

// Update only group counts without re-rendering the entire list
function updateGroupCountsOnly() {
    for (const [groupId, group] of Object.entries(window.groups)) {
        const countElement = document.querySelector(`.group-item[data-group-id="${groupId}"] .group-count`);
        if (countElement) {
            countElement.textContent = `(${group.driverIds.size})`;
        }
    }
}

// ---------------- Process Individual Driver Update ----------------
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

// ---------------- Create New Driver Marker ----------------
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
    reverseGeocode(currentData.loc.latitude, currentData.loc.longitude).then(address => {
      infoWindow.setContent(createInfoWindowContent(
        currentData.user, 
        currentData.loc, 
        currentData.speedKmh, 
        address
      ));
      infoWindow.open(window.map, marker);
      window.activeInfoWindow = infoWindow;
    });
  });
  
  window.driverMarkers[uid] = marker;
  
  reverseGeocode(loc.latitude, loc.longitude).then(address => {
    if (marker.infoWindow && marker.infoWindow.getContent().includes("Loading address...")) {
      marker.infoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
    }
  });
}

// ---------------- Calculate Speed ----------------
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

// ---------------- Geocoding Functions ----------------
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
    '14.60,121.00': 'Quebec City',
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
        <span>${user.firstName || ""} ${user.lastName || ""}</span>
      </div>
      
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; margin-bottom: 12px;">
        <div style="font-weight: 600; color: #5f6368;">Role:</div>
        <div style="color: #202124;">${user.role || "driver"}</div>
        
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
          ${address}
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

// Clean up polling on page unload
window.addEventListener('beforeunload', () => {
  if (window.pollingInterval) {
    clearInterval(window.pollingInterval);
  }
});

// Toast message helper
window.showToastMessage = function(message) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  if (toast && toastMessage) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }
};

// Focus on driver from panel
window.focusOnDriver = function(uid, driverName) {
  console.log("Focusing on driver:", uid, driverName);
  const marker = window.driverMarkers[uid];
  
  if (!marker) {
    console.error("Marker not found for uid:", uid);
    window.showToastMessage(`⚠️ Driver ${driverName} location not available`);
    return;
  }
  
  if (!window.map) {
    console.error("Map not found");
    return;
  }
  
  try {
    const position = marker.getPosition();
    if (!position) {
      console.error("Marker has no position");
      return;
    }
    
    window.map.setCenter(position);
    window.map.setZoom(17);
    
    if (window.activeInfoWindow) {
      window.activeInfoWindow.close();
      window.activeInfoWindow = null;
    }
    
    const currentData = marker.userData;
    if (!currentData || !currentData.loc) {
      console.error("No location data for marker");
      return;
    }
    
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
      window.showToastMessage(`📍 Focused on ${driverName}`);
    }).catch(error => {
      console.error("Geocoding error:", error);
      marker.infoWindow.open(window.map, marker);
      window.activeInfoWindow = marker.infoWindow;
      window.showToastMessage(`📍 Focused on ${driverName}`);
    });
    
  } catch (error) {
    console.error("Error focusing on driver:", error);
    window.showToastMessage(`⚠️ Error focusing on ${driverName}`);
  }
};

// Update driver panel UI
window.updateDriverPanelList = function() {
  const driverListEl = document.getElementById('driverList');
  const driverCountEl = document.getElementById('driverCount');
  
  if (!driverListEl) return;
  
  const drivers = [];
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  
  for (const [uid, marker] of Object.entries(window.driverMarkers)) {
    if (marker && marker.userData) {
      const { user, speedKmh, lastUpdate } = marker.userData;
      const isStale = lastUpdate && (now - lastUpdate) > FIVE_MINUTES;
      drivers.push({
        uid,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Driver',
        speed: speedKmh || 0,
        isStale: isStale
      });
    }
  }
  
  driverCountEl.textContent = drivers.length;
  
  if (drivers.length === 0) {
    driverListEl.innerHTML = '<div style="padding: 1rem; text-align: center; color: #6c757d;">No drivers found</div>';
    return;
  }
  
  driverListEl.innerHTML = drivers.map(driver => {
    let speedClass = 'speed-normal';
    let speedText = 'Normal';
    if (driver.speed > 60) {
      speedClass = 'speed-speeding';
      speedText = 'Speeding!';
    } else if (driver.speed > 30) {
      speedClass = 'speed-moderate';
      speedText = 'Moderate';
    }
    
    const initials = driver.name.split(' ').map(n => n[0]).join('').toUpperCase();
    const staleClass = driver.isStale ? 'stale-driver' : '';
    const staleBadge = driver.isStale ? '<span style="margin-left: 6px; font-size: 0.6rem; color: #ff9800;">⏳ stale</span>' : '';
    
    return `
      <div class="driver-item ${staleClass}" data-uid="${driver.uid}" data-driver-name="${driver.name}" style="cursor: pointer;">
        <div class="driver-avatar">${initials || 'D'}</div>
        <div class="driver-info">
          <div class="driver-name">${driver.name} ${staleBadge}</div>
          <div class="driver-speed">
            <span class="speed-badge ${speedClass}">
              ${driver.speed > 0 ? '🚗' : '🅿️'} ${driver.speed.toFixed(1)} km/h
            </span>
            <span style="margin-left: 6px; font-size: 0.65rem;">${speedText}</span>
          </div>
        </div>
        <i class="fas fa-location-dot" style="color: #ffb347;"></i>
      </div>
    `;
  }).join('');
  
  const driverItems = document.querySelectorAll('.driver-item');
  driverItems.forEach(item => {
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    
    newItem.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const uid = this.getAttribute('data-uid');
      const driverName = this.getAttribute('data-driver-name');
      window.focusOnDriver(uid, driverName);
    });
  });
};

// Panel collapsible
const driverPanel = document.getElementById('driverPanel');
const panelHeader = document.getElementById('panelHeader');
if (panelHeader) {
  panelHeader.addEventListener('click', () => {
    driverPanel.classList.toggle('expanded');
  });
}

// Periodic panel updates
setInterval(() => {
  if (window.updateDriverPanelList) window.updateDriverPanelList();
}, 2000);

// Fallback initialization
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('map')) {
    if (typeof google !== 'undefined' && google.maps && typeof window.initMap === 'function' && !window.map) {
      window.initMap();
    }
  }
});

window.addEventListener('visibilitychange', function() {
  if (!document.hidden && window.map) {
    google.maps.event.trigger(window.map, 'resize');
  }
});

window.gm_authFailure = function() {
  console.error('Google Maps authentication failed');
  showMapError("Google Maps authentication failed. Please check your API key.");
};

console.log("TRACK DRIVERS SCRIPT LOADED - With fixed Group Management (panel stays open)");