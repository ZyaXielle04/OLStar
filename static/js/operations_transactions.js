const container = document.getElementById("requestsContainer");

fetch("/api/admin/requests")
  .then(res => res.json())
  .then(data => {
    if (!data.requests || !data.requests.length) {
      container.innerHTML = "<p>No requests found.</p>";
      return;
    }

    data.requests.forEach(req => {
      const card = document.createElement("div");
      card.className = "request-card";

      const statusClass = (req.status || "pending").toLowerCase();
      const statusText = (req.status || "pending").toUpperCase();
      const dateText = req.timestamp
        ? new Date(req.timestamp).toLocaleString()
        : "—";

      card.innerHTML = `
        <div class="card-header">
          <span class="amount">₱${req.amount || "0"}</span>
          <span class="status ${statusClass}">
            ${statusText}
          </span>
        </div>

        <div class="card-body">
          <p><strong>Requested By:</strong> ${req.requestedByName || req.requestedBy || "Unknown"}</p>

          <p><strong>Date:</strong> ${dateText}</p>

          <div class="images">
            ${req.receiptUrl ? `<a href="${req.receiptUrl}" target="_blank">Receipt</a>` : ""}
            ${req.gcashUrl ? `<a href="${req.gcashUrl}" target="_blank">GCash</a>` : ""}
            ${req.mileageURL ? `<a href="${req.mileageURL}" target="_blank">Mileage</a>` : ""}
          </div>
        </div>
      `;

      container.appendChild(card);
    });
  })
  .catch(err => {
    console.error("Failed to load requests:", err);
    container.innerHTML = "<p>Error loading requests.</p>";
  });
