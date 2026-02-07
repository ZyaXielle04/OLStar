// ---------------- Initialize Leaflet map ----------------
const origin = [14.5222733, 120.999655]; // Point of origin (Manila)
const maxZoomLevel = 18; // Maximum zoom allowed
const map = L.map('map').setView(origin, maxZoomLevel);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: maxZoomLevel
}).addTo(map);

// ---------------- Origin Marker ----------------
const originMarker = L.marker(origin, {
  icon: L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // example icon
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  })
}).addTo(map);

originMarker.bindPopup("<strong>My garage</strong>").openPopup();

// ---------------- Firebase reference ----------------
const usersRef = firebase.database().ref('users');
const driverMarkers = {};

// ---------------- Listen for real-time updates ----------------
usersRef.on('value', snapshot => {
  const users = snapshot.val();
  if (!users) return;

  // Remove markers for users that no longer have a location
  Object.keys(driverMarkers).forEach(uid => {
    if (!users[uid] || !users[uid].currentLocation) {
      map.removeLayer(driverMarkers[uid]);
      delete driverMarkers[uid];
    }
  });

  // Add / update markers
  Object.entries(users).forEach(([uid, user]) => {
    const loc = user.currentLocation;
    if (!loc || !loc.latitude || !loc.longitude) return;

    const popupText = `
      <strong>${user.firstName || ''} ${user.lastName || ''}</strong><br/>
      Role: ${user.role || 'user'}<br/>
      Last Updated: ${new Date(loc.timestamp || Date.now()).toLocaleString()}
    `;

    if (driverMarkers[uid]) {
      driverMarkers[uid].setLatLng([loc.latitude, loc.longitude]);
      driverMarkers[uid].setPopupContent(popupText);
    } else {
      driverMarkers[uid] = L.marker([loc.latitude, loc.longitude])
        .addTo(map)
        .bindPopup(popupText);
    }
  });
});
