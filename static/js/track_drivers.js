let map;
const origin = { lat: 14.5222733, lng: 120.999655 }; // Manila
const driverMarkers = {};
const previousLocations = {};

// Traffic Layer
let trafficLayer;
let trafficVisible = false;

// ---------------- Initialize Google Map ----------------
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: origin,
    zoom: 18,
    mapTypeId: "roadmap"
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
      } else {
        trafficLayer.setMap(null);
        btn.innerText = "Show Traffic";
      }
    });
  }

  // Start listening to driver updates
  listenForDrivers();
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
      }
    });

    // Add / update driver markers
    Object.entries(users).forEach(([uid, user]) => {
      const loc = user.currentLocation;
      if (!loc || loc.latitude == null || loc.longitude == null) return;

      let speedKmh = 0;

      // Calculate speed if previous location exists
      if (previousLocations[uid]) {
        const prev = previousLocations[uid];
        const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(
          new google.maps.LatLng(prev.latitude, prev.longitude),
          new google.maps.LatLng(loc.latitude, loc.longitude)
        );
        const timeDiffSec = (loc.timestamp - prev.timestamp) / 1000;
        if (timeDiffSec > 0) speedKmh = (distanceMeters / timeDiffSec) * 3.6;
      }

      // Save current location for next update
      previousLocations[uid] = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp || Date.now()
      };

      // Prepare info window content
      const infoHtml = `
        <strong>${user.firstName || ""} ${user.lastName || ""}</strong><br/>
        Role: ${user.role || "user"}<br/>
        Lat: ${loc.latitude.toFixed(6)}<br/>
        Lng: ${loc.longitude.toFixed(6)}<br/>
        Speed: ${speedKmh.toFixed(1)} km/h<br/>
        Last Updated: ${new Date(loc.timestamp || Date.now()).toLocaleString()}
      `;

      // Update existing marker
      if (driverMarkers[uid]) {
        driverMarkers[uid].setPosition({ lat: loc.latitude, lng: loc.longitude });
        driverMarkers[uid].infoWindow.setContent(infoHtml);
      } else {
        // Create new marker
        const marker = new google.maps.Marker({
          position: { lat: loc.latitude, lng: loc.longitude },
          map: map
        });

        const infoWindow = new google.maps.InfoWindow({ content: infoHtml });

        marker.addListener("click", () => {
          infoWindow.open(map, marker);
        });

        marker.infoWindow = infoWindow;
        driverMarkers[uid] = marker;
      }
    });
  });
}
