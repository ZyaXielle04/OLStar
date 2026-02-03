// Initialize Leaflet map
const map = L.map('map').setView([14.5995, 120.9842], 12); // Manila

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Firebase reference
const usersRef = firebase.database().ref('users');
const driverMarkers = {};

// Listen for real-time updates
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
