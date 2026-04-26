// Make all functions globally available
window.driverMarkers = {};
window.previousLocations = {};
window.lastValidSpeed = {};
window.lastUpdateTime = {};
window.addressCache = new Map();
window.activeInfoWindow = null;
window.map = null; // Make map globally available

// OPTIMIZATION: ONLY REQUEST UPDATES EVERY 10 SECONDS
// Instead of listening to real-time updates, we poll on a schedule
window.pollingInterval = null;
window.pollingDelay = 10000; // Get updates every 10 seconds (90% reduction)
window.lastDataHash = {}; // Track data changes to avoid unnecessary updates
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

    const btn = document.getElementById("btnToggleTraffic");
    if (btn) {
      btn.replaceWith(btn.cloneNode(true));
      const newBtn = document.getElementById("btnToggleTraffic");
      newBtn.addEventListener("click", () => {
        trafficVisible = !trafficVisible;
        if (trafficVisible) {
          trafficLayer.setMap(window.map);
          newBtn.innerText = "Hide Traffic";
          newBtn.classList.add("active");
        } else {
          trafficLayer.setMap(null);
          newBtn.innerText = "Show Traffic";
          newBtn.classList.remove("active");
        }
      });
    }

    window.map.addListener("click", () => {
      closeActiveInfoWindow();
    });

    // START POLLING INSTEAD OF REAL-TIME LISTENERS
    startPollingDrivers();
    
    google.maps.event.trigger(window.map, 'resize');
    console.log(`Map initialized successfully - Polling mode active (every ${window.pollingDelay/1000} seconds)`);
    
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

// ---------------- OPTIMIZED: POLL INSTEAD OF REAL-TIME LISTENERS ----------------
function startPollingDrivers() {
  if (typeof firebase === 'undefined' || !firebase.database) {
    console.error("Firebase not initialized, retrying...");
    setTimeout(startPollingDrivers, 1000);
    return;
  }

  // Clear any existing interval
  if (window.pollingInterval) {
    clearInterval(window.pollingInterval);
  }

  // Initial fetch
  fetchDriversData();

  // Set up polling interval
  window.pollingInterval = setInterval(() => {
    if (!document.hidden) { // Only fetch when tab is visible
      fetchDriversData();
    }
  }, window.pollingDelay);

  console.log(`Polling started - fetching data every ${window.pollingDelay/1000} seconds`);
}

// ---------------- Fetch only CHANGED data using query timestamps ----------------
async function fetchDriversData() {
  if (window.isUpdating) {
    console.log("Update already in progress, skipping...");
    return;
  }

  window.isUpdating = true;

  try {
    const usersRef = firebase.database().ref("users");
    
    // OPTIMIZATION: Use orderByChild and limitToLast to get only recent updates
    // This is the KEY optimization - only fetch drivers with recent updates
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    // Query only drivers who have updated in the last 5 minutes
    const snapshot = await usersRef
      .orderByChild("currentLocation/timestamp")
      .startAt(fiveMinutesAgo)
      .once("value");
    
    const users = snapshot.val();
    
    if (!users) {
      window.isUpdating = false;
      return;
    }

    const now = Date.now();
    let hasChanges = false;

    // Process each driver
    Object.entries(users).forEach(([uid, user]) => {
      const loc = user.currentLocation;
      if (!loc || loc.latitude == null || loc.longitude == null) return;
      
      // Ensure timestamp exists
      if (!loc.timestamp) {
        loc.timestamp = now;
      }
      
      // Create a hash of the location to detect changes
      const locationHash = `${uid}_${loc.latitude.toFixed(6)}_${loc.longitude.toFixed(6)}_${loc.timestamp}`;
      
      // Only process if location actually changed
      if (window.lastDataHash[uid] !== locationHash) {
        hasChanges = true;
        window.lastDataHash[uid] = locationHash;
        processDriverUpdate(uid, user, loc, now);
      }
    });
    
    // Clean up drivers that no longer have recent updates
    Object.keys(window.driverMarkers).forEach(uid => {
      if (!users[uid]) {
        hasChanges = true;
        if (window.activeInfoWindow && window.driverMarkers[uid].infoWindow === window.activeInfoWindow) {
          closeActiveInfoWindow();
        }
        window.driverMarkers[uid].setMap(null);
        delete window.driverMarkers[uid];
        delete window.previousLocations[uid];
        delete window.lastValidSpeed[uid];
        delete window.lastUpdateTime[uid];
        delete window.lastDataHash[uid];
      }
    });
    
    if (!hasChanges) {
      console.log("No changes detected, skipping UI update");
    }
    
    // Trigger panel update
    if (window.updateDriverPanelList) {
      setTimeout(window.updateDriverPanelList, 100);
    }
    
  } catch (error) {
    console.error("Error fetching drivers:", error);
  } finally {
    window.isUpdating = false;
  }
}

// ---------------- Process Individual Driver Update ----------------
function processDriverUpdate(uid, user, loc, timestamp) {
  // Calculate speed
  let speedKmh = 0;
  
  if (window.previousLocations[uid]) {
    speedKmh = calculateSpeed(uid, loc, window.previousLocations[uid]);
  } else {
    window.lastValidSpeed[uid] = 0;
  }
  
  // Save current location for next update
  window.previousLocations[uid] = {
    latitude: loc.latitude,
    longitude: loc.longitude,
    timestamp: loc.timestamp || timestamp
  };
  
  // Update or create marker
  if (window.driverMarkers[uid]) {
    const marker = window.driverMarkers[uid];
    marker.setPosition({ lat: loc.latitude, lng: loc.longitude });
    marker.setTitle(`${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver");
    marker.userData = { user, loc, speedKmh };
    
    if (window.activeInfoWindow && marker.infoWindow === window.activeInfoWindow) {
      updateInfoWindowContent(marker, user, loc, speedKmh);
    }
  } else {
    createDriverMarker(uid, user, loc, speedKmh);
  }
}

// ---------------- Create New Driver Marker ----------------
function createDriverMarker(uid, user, loc, speedKmh) {
  const marker = new google.maps.Marker({
    position: { lat: loc.latitude, lng: loc.longitude },
    map: window.map,
    title: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver",
    animation: google.maps.Animation.DROP
  });
  
  const infoWindow = new google.maps.InfoWindow({
    content: createInfoWindowContent(user, loc, speedKmh, "Loading address...")
  });
  
  infoWindow.addListener("closeclick", () => {
    if (window.activeInfoWindow === infoWindow) {
      window.activeInfoWindow = null;
    }
  });
  
  marker.userData = { user, loc, speedKmh };
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
  
  // Pre-load address
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
  const MIN_TIME_DIFF = 1.0;
  const MAX_TIME_DIFF = 30;
  const MIN_DISTANCE = 2;
  
  let speedKmh = 0;
  
  if (timeDiffSec >= MIN_TIME_DIFF && timeDiffSec <= MAX_TIME_DIFF) {
    if (distanceMeters >= MIN_DISTANCE) {
      speedKmh = (distanceMeters / timeDiffSec) * 3.6;
      
      if (window.lastValidSpeed[uid] > 0) {
        const maxChange = window.lastValidSpeed[uid] * 0.5;
        if (Math.abs(speedKmh - window.lastValidSpeed[uid]) > maxChange) {
          speedKmh = window.lastValidSpeed[uid] + (Math.sign(speedKmh - window.lastValidSpeed[uid]) * maxChange);
        }
      }
      
      speedKmh = Math.min(speedKmh, 150);
      window.lastValidSpeed[uid] = speedKmh;
    } else {
      if (window.lastValidSpeed[uid] > 0) {
        speedKmh = Math.max(0, window.lastValidSpeed[uid] * 0.8);
        if (speedKmh < 0.5) speedKmh = 0;
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

// ---------------- Fallback initialization ----------------
document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded, checking for map...");
  
  if (document.getElementById('map')) {
    if (typeof google !== 'undefined' && google.maps && typeof window.initMap === 'function' && !window.map) {
      console.log("Google Maps loaded, calling initMap from DOMContentLoaded");
      window.initMap();
    }
  }
});

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && window.map) {
    google.maps.event.trigger(window.map, 'resize');
  }
});

window.addEventListener('resize', function() {
  if (window.map) {
    google.maps.event.trigger(window.map, 'resize');
  }
});

window.gm_authFailure = function() {
  console.error('Google Maps authentication failed');
  showMapError("Google Maps authentication failed. Please check your API key.");
};

console.log("Track drivers script loaded - TRULY OPTIMIZED: Polling every 10 seconds with Firebase queries");