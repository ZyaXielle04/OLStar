// =======================
// HELPER FUNCTIONS
// =======================
function formatTimestamp(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    hour12: true,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function createLink(url, label) {
  return url ? `<a href="${url}" target="_blank">${label}</a>` : "";
}

function isToday(dateStr) {
  const today = new Date();
  const date = new Date(dateStr);
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

// =======================
// METRICS
// =======================
async function fetchDashboardMetrics() {
  try {
    const res = await fetch("/api/admin/dashboard");
    const data = await res.json();

    document.getElementById("totalUsers").textContent = data.totalUsers || 0;
    document.getElementById("activeSessions").textContent = data.activeSessions || 0;
    document.getElementById("bookingsToday").textContent = data.bookingsToday || 0;
    document.getElementById("driversOnline").textContent = data.driversOnline || 0;
    document.getElementById("pendingRequests").textContent = data.pendingRequests || 0;
  } catch (err) {
    console.error("Failed to fetch dashboard metrics:", err);
  }
}

// =======================
// RECENT REQUESTS
// =======================
async function fetchRecentRequests() {
  const container = document.getElementById("recentRequestsContainer");
  try {
    const res = await fetch("/api/admin/requests");
    const data = await res.json();

    if (!data.requests?.length) {
      container.innerHTML = "<p>No requests found.</p>";
      return;
    }

    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    data.requests.forEach(req => {
      const card = document.createElement("div");
      card.className = "request-card";

      const statusClass = (req.status || "pending").toLowerCase();
      const requestedBy = req.requestedByName || req.requestedBy || "Unknown";
      const timestampFormatted = formatTimestamp(req.timestamp);

      // Highlight today
      const highlightToday = isToday(req.timestamp) ? "highlight-today" : "";

      card.innerHTML = `
        <div class="card-header ${highlightToday}">
          <span class="amount">₱${req.amount}</span>
          <span class="status ${statusClass}">${(req.status || "PENDING").toUpperCase()}</span>
        </div>
        <div class="card-body">
          <p><strong>Requested By:</strong> ${requestedBy}</p>
          <p><strong>Date:</strong> ${timestampFormatted}</p>
          <div class="images">
            ${createLink(req.receiptUrl, "Receipt")}
            ${createLink(req.gcashUrl, "GCash")}
            ${createLink(req.mileageURL, "Mileage")}
          </div>
        </div>
      `;

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  } catch (err) {
    console.error("Failed to load requests:", err);
    container.innerHTML = "<p>Error loading requests.</p>";
  }
}

// =======================
// CHARTS
// =======================
async function fetchAndRenderCharts() {
  try {
    const res = await fetch("/api/admin/dashboard/charts");
    const data = await res.json();

    const bookingsData = data.bookings || [];
    const requestsData = data.requests || [];

    // Combine labels (dates)
    const labels = bookingsData.map(d => d.date); // Assuming bookings & requests have same date keys

    const ctx = document.getElementById("activityChart").getContext("2d");

    new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Bookings",
            data: bookingsData.map(d => d.count),
            borderColor: "#1e88e5",
            backgroundColor: "rgba(30,136,229,0.2)",
            tension: 0.3
          },
          {
            label: "Requests",
            data: requestsData.map(d => d.count),
            borderColor: "#43a047",
            backgroundColor: "rgba(67,160,71,0.2)",
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "top"
          },
          title: {
            display: true,
            text: "Bookings & Requests Trend (Last 7 Days)"
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            stepSize: 1
          }
        }
      }
    });
  } catch (err) {
    console.error("Failed to load chart data:", err);
  }
}

// =======================
// INITIALIZE DASHBOARD
// =======================
document.addEventListener("DOMContentLoaded", async () => {
  fetchDashboardMetrics();
  fetchRecentRequests();
  fetchAndRenderCharts();
});
