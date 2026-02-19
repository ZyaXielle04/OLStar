let map;
const origin = { lat: 14.5222733, lng: 120.999655 }; // Manila
const driverMarkers = {};
const previousLocations = {};
const lastValidSpeed = {}; // Store last valid speed to prevent 0.0 flicker
const lastUpdateTime = {}; // Track last update time for each driver

// Cache for geocoded addresses to avoid repeated API calls
const addressCache = new Map();

// Traffic Layer
let trafficLayer;
let trafficVisible = false;

// Single info window instance
let activeInfoWindow = null;
let isInfoWindowOpen = false; // NEW: Track if info window is intentionally open

// ---------------- Initialize Google Map ----------------
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: origin,
    zoom: 18,
    mapTypeId: "roadmap",
    mapId: "DEMO_MAP_ID" // Using demo ID for testing
  });

  // Origin Marker (Garage)
  new google.maps.Marker({
    position: origin,
    map: map,
    title: "My Garage",
    icon: {
      url: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
      scaledSize: new google.maps.Size(32, 32)
    }
  });

  // Initialize Traffic Layer
  trafficLayer = new google.maps.TrafficLayer();

  // Add traffic toggle button listener
  const btn = document.getElementById("btnToggleTraffic");
  if (btn) {
    btn.addEventListener("click", () => {
      trafficVisible = !trafficVisible;
      if (trafficVisible) {
        trafficLayer.setMap(map);
        btn.innerText = "Hide Traffic";
        btn.classList.add("active");
      } else {
        trafficLayer.setMap(null);
        btn.innerText = "Show Traffic";
        btn.classList.remove("active");
      }
    });
  }

  // Add click listener to map to close info window when clicking on empty space
  map.addListener("click", () => {
    if (activeInfoWindow) {
      activeInfoWindow.close();
      activeInfoWindow = null;
      isInfoWindowOpen = false;
    }
  });

  // Start listening to driver updates
  listenForDrivers();
}

// ---------------- Geocoding Function with Multiple Fallbacks ----------------
async function reverseGeocode(lat, lng) {
  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  
  // Check cache first (with timestamp to expire after 1 hour)
  if (addressCache.has(cacheKey)) {
    const cached = addressCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
      return cached.address;
    }
  }

  // Try multiple geocoding services/approaches
  try {
    // Method 1: Google Maps Geocoding API (primary)
    const googleAddress = await tryGoogleGeocode(lat, lng);
    if (googleAddress) {
      addressCache.set(cacheKey, {
        address: googleAddress,
        timestamp: Date.now()
      });
      return googleAddress;
    }
  } catch (error) {
    console.warn("Google Geocoding failed:", error);
  }

  try {
    // Method 2: OpenStreetMap Nominatim (fallback)
    const osmAddress = await tryOpenStreetMapGeocode(lat, lng);
    if (osmAddress) {
      addressCache.set(cacheKey, {
        address: osmAddress,
        timestamp: Date.now()
      });
      return osmAddress;
    }
  } catch (error) {
    console.warn("OpenStreetMap Geocoding failed:", error);
  }

  // Method 3: Generate a descriptive location based on coordinates
  const approximateLocation = getApproximateLocation(lat, lng);
  addressCache.set(cacheKey, {
    address: approximateLocation,
    timestamp: Date.now()
  });
  return approximateLocation;
}

// ---------------- Google Geocoding ----------------
async function tryGoogleGeocode(lat, lng) {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=AIzaSyBZwE8kSgkloKvNgOEKhJUVyNS2He2NqT0`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === "OK" && data.results.length > 0) {
      return data.results[0].formatted_address;
    } else if (data.status === "ZERO_RESULTS") {
      return null;
    } else {
      console.warn("Google Geocoding API returned status:", data.status);
      return null;
    }
  } catch (error) {
    console.warn("Google Geocoding error:", error);
    return null;
  }
}

// ---------------- OpenStreetMap Nominatim (Free Fallback) ----------------
async function tryOpenStreetMapGeocode(lat, lng) {
  try {
    // Add delay to respect Nominatim usage policy (1 request per second)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FleetTrackingApp/1.0' // Replace with your app name
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.display_name) {
      return data.display_name;
    }
    return null;
  } catch (error) {
    console.warn("OpenStreetMap Geocoding error:", error);
    return null;
  }
}

// ---------------- Generate Approximate Location ----------------
function getApproximateLocation(lat, lng) {
  // Major areas in Metro Manila for better approximation
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
  
  // Find nearest known area
  let nearestArea = "Metro Manila";
  let minDistance = Infinity;
  const radius = 0.05; // Approximately 5km
  
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

// ---------------- Calculate Speed with Smoothing ----------------
function calculateSpeed(uid, currentLoc, prevLoc) {
  if (!prevLoc) {
    lastValidSpeed[uid] = 0;
    return 0;
  }

  const currentTime = currentLoc.timestamp || Date.now();
  const prevTime = prevLoc.timestamp;
  
  // Calculate distance
  const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(
    new google.maps.LatLng(prevLoc.latitude, prevLoc.longitude),
    new google.maps.LatLng(currentLoc.latitude, currentLoc.longitude)
  );
  
  // Calculate time difference in seconds
  const timeDiffSec = (currentTime - prevTime) / 1000;
  
  // Minimum time difference to consider (avoid division by very small numbers)
  const MIN_TIME_DIFF = 1.0; // 1 second
  const MAX_TIME_DIFF = 30; // 30 seconds max for valid speed calculation
  const MIN_DISTANCE = 2; // Minimum 2 meters movement to consider (filters GPS noise)
  
  let speedKmh = 0;
  
  // Only calculate if time difference is reasonable and movement is significant
  if (timeDiffSec >= MIN_TIME_DIFF && timeDiffSec <= MAX_TIME_DIFF) {
    if (distanceMeters >= MIN_DISTANCE) {
      // Calculate speed in km/h
      speedKmh = (distanceMeters / timeDiffSec) * 3.6;
      
      // Smooth the speed - don't allow unrealistic jumps
      if (lastValidSpeed[uid] > 0) {
        // Max 50% increase or decrease per update
        const maxChange = lastValidSpeed[uid] * 0.5;
        if (Math.abs(speedKmh - lastValidSpeed[uid]) > maxChange) {
          speedKmh = lastValidSpeed[uid] + (Math.sign(speedKmh - lastValidSpeed[uid]) * maxChange);
        }
      }
      
      // Cap maximum speed (typical vehicle speed)
      speedKmh = Math.min(speedKmh, 150);
      lastValidSpeed[uid] = speedKmh;
    } else {
      // Very small movement - gradually decay speed
      if (lastValidSpeed[uid] > 0) {
        speedKmh = Math.max(0, lastValidSpeed[uid] * 0.8);
        if (speedKmh < 0.5) speedKmh = 0;
        lastValidSpeed[uid] = speedKmh;
      }
    }
  } else {
    // Time difference outside valid range - use last valid speed with decay
    if (lastUpdateTime[uid] && (currentTime - lastUpdateTime[uid]) > MAX_TIME_DIFF * 1000) {
      // If no update for a while, assume stopped
      speedKmh = 0;
      lastValidSpeed[uid] = 0;
    } else {
      speedKmh = lastValidSpeed[uid] || 0;
    }
  }
  
  // Update last update time
  lastUpdateTime[uid] = currentTime;
  
  return Math.max(0, speedKmh); // Ensure non-negative
}

// ---------------- Firebase Real-Time Tracking ----------------
function listenForDrivers() {
  const usersRef = firebase.database().ref("users");

  usersRef.on("value", snapshot => {
    const users = snapshot.val();
    if (!users) return;

    // Remove markers for drivers no longer broadcasting
    Object.keys(driverMarkers).forEach(uid => {
      if (!users[uid] || !users[uid].currentLocation) {
        driverMarkers[uid].setMap(null);
        delete driverMarkers[uid];
        delete previousLocations[uid];
        delete lastValidSpeed[uid];
        delete lastUpdateTime[uid];
      }
    });

    // Add / update driver markers
    Object.entries(users).forEach(([uid, user]) => {
      const loc = user.currentLocation;
      if (!loc || loc.latitude == null || loc.longitude == null) return;

      // Ensure timestamp exists
      if (!loc.timestamp) {
        loc.timestamp = Date.now();
      }

      let speedKmh = 0;

      // Calculate speed using previous location if it exists
      if (previousLocations[uid]) {
        speedKmh = calculateSpeed(uid, loc, previousLocations[uid]);
      } else {
        lastValidSpeed[uid] = 0;
      }

      // Save current location for next update
      previousLocations[uid] = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp
      };

      // Update existing marker or create new one
      if (driverMarkers[uid]) {
        const marker = driverMarkers[uid];
        
        // Update position
        marker.setPosition({ lat: loc.latitude, lng: loc.longitude });
        
        // Update marker title
        marker.setTitle(`${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver");
        
        // Update stored user data
        marker.userData = { user, loc, speedKmh };
        
        // Only update info window if it's intentionally open
        if (isInfoWindowOpen && activeInfoWindow === marker.infoWindow) {
          updateInfoWindowWithAddress(marker, user, loc, speedKmh);
        }
      } else {
        // Create new marker
        const marker = new google.maps.Marker({
          position: { lat: loc.latitude, lng: loc.longitude },
          map: map,
          title: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Driver",
          animation: google.maps.Animation.DROP
        });

        // Create info window with initial content
        const infoWindow = new google.maps.InfoWindow({
          content: createInfoWindowContent(user, loc, speedKmh, "Loading address...")
        });

        // Add close listener to info window
        infoWindow.addListener("closeclick", () => {
          activeInfoWindow = null;
          isInfoWindowOpen = false;
        });

        // Store data in marker
        marker.userData = { user, loc, speedKmh };
        marker.infoWindow = infoWindow;
        
        // Add click listener with stopPropagation to prevent map click
        marker.addListener("click", (event) => {
          event.stop(); // Stop event propagation
          
          // Close any previously open info window
          if (activeInfoWindow) {
            activeInfoWindow.close();
          }
          
          // Get current data from marker
          const currentData = marker.userData;
          
          // Get address (with caching)
          reverseGeocode(currentData.loc.latitude, currentData.loc.longitude).then(address => {
            // Update info window with address
            infoWindow.setContent(createInfoWindowContent(
              currentData.user, 
              currentData.loc, 
              currentData.speedKmh, 
              address
            ));
            
            // Open the info window
            infoWindow.open(map, marker);
            
            // Set as active info window
            activeInfoWindow = infoWindow;
            isInfoWindowOpen = true;
          });
        });

        driverMarkers[uid] = marker;
        
        // Pre-load address for this marker
        reverseGeocode(loc.latitude, loc.longitude).then(address => {
          if (marker.infoWindow && marker.infoWindow.getContent().includes("Loading address...")) {
            marker.infoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
          }
        });
      }
    });
  });
}

// ---------------- Update Info Window with Address ----------------
async function updateInfoWindowWithAddress(marker, user, loc, speedKmh) {
  if (!marker.infoWindow || !isInfoWindowOpen) return;
  
  // Get address (with caching)
  const address = await reverseGeocode(loc.latitude, loc.longitude);
  
  // Update info window content
  marker.infoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
  
  // Reopen if it's the active window and still open
  if (isInfoWindowOpen && activeInfoWindow === marker.infoWindow) {
    marker.infoWindow.open(map, marker);
  }
}

// ---------------- Create Info Window Content Helper ----------------
function createInfoWindowContent(user, loc, speedKmh, address) {
  // Determine speed color and icon
  let speedColor = "#4CAF50"; // Green for normal
  let speedIcon = "🚗";
  
  if (speedKmh > 80) {
    speedColor = "#F44336"; // Red for very fast
    speedIcon = "🚀";
  } else if (speedKmh > 40) {
    speedColor = "#FF9800"; // Orange for fast
    speedIcon = "⚡";
  } else if (speedKmh > 0) {
    speedIcon = "🚙";
  } else {
    speedIcon = "🅿️";
  }
  
  // Format timestamp
  const timestamp = loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'Just now';
  
  return `
    <div style="min-width: 280px; max-width: 320px; padding: 15px; font-family: 'Segoe UI', Arial, sans-serif; background: white; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
      <!-- Header with driver name -->
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px; border-bottom: 2px solid #4285f4; padding-bottom: 8px; color: #1a73e8; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 24px;">👤</span>
        <span>${user.firstName || ""} ${user.lastName || ""}</span>
      </div>
      
      <!-- Driver details grid -->
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
      
      <!-- Location section -->
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
      
      <!-- Timestamp -->
      <div style="color: #9aa0a6; font-size: 11px; border-top: 1px solid #e8eaed; padding-top: 8px; display: flex; align-items: center; gap: 4px;">
        <span>🕒</span>
        Last updated: ${timestamp}
      </div>
    </div>
  `;
}

// ---------------- Helper function to refresh all open info windows ----------------
function refreshActiveInfoWindow() {
  if (isInfoWindowOpen && activeInfoWindow && activeInfoWindow.getAnchor()) {
    const marker = activeInfoWindow.getAnchor();
    if (marker && marker.userData) {
      const { user, loc, speedKmh } = marker.userData;
      reverseGeocode(loc.latitude, loc.longitude).then(address => {
        if (isInfoWindowOpen && activeInfoWindow === marker.infoWindow) {
          activeInfoWindow.setContent(createInfoWindowContent(user, loc, speedKmh, address));
        }
      });
    }
  }
}

// Refresh active info window every 30 seconds
setInterval(refreshActiveInfoWindow, 30000);