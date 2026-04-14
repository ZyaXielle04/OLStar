const container = document.getElementById("requestsContainer");

// Cloudinary configuration
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dekdyp7bb/upload";
const CLOUDINARY_UPLOAD_PRESET = "OLStar";

fetch("/api/admin/requests")
  .then(res => res.json())
  .then(data => {
    if (!data.requests || !data.requests.length) {
      container.innerHTML = '<div class="empty-state">No requests found.</div>';
      return;
    }

    // Create table structure
    const tableHTML = `
      <div class="requests-table-container">
        <table class="requests-table">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Requested By</th>
              <th>Date</th>
              <th>Status</th>
              <th>Documents</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="requestsTableBody">
          </tbody>
        </table>
      </div>
    `;
    
    container.innerHTML = tableHTML;
    const tbody = document.getElementById("requestsTableBody");

    data.requests.forEach(req => {
      const row = tbody.insertRow();
      
      const statusClass = (req.status || "pending").toLowerCase();
      const statusText = (req.status || "pending").toUpperCase();
      const dateText = req.timestamp
        ? new Date(req.timestamp).toLocaleString()
        : "—";
      
      // Store request data on the row for easy access
      row.dataset.id = req.id;
      row.dataset.status = statusText;

      // Amount cell
      const amountCell = row.insertCell(0);
      amountCell.className = "amount-cell";
      amountCell.textContent = `₱${req.amount || "0"}`;
      
      // Requested By cell
      const requesterCell = row.insertCell(1);
      requesterCell.textContent = req.requestedByName || req.requestedBy || "Unknown";
      
      // Date cell
      const dateCell = row.insertCell(2);
      dateCell.textContent = dateText;
      
      // Status cell with badge
      const statusCell = row.insertCell(3);
      statusCell.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
      
      // Documents cell (links)
      const docsCell = row.insertCell(4);
      let linksHtml = '<div class="links-container">';
      if (req.receiptUrl) linksHtml += `<a href="${req.receiptUrl}" target="_blank">Receipt</a>`;
      if (req.gcashUrl) linksHtml += `<a href="${req.gcashUrl}" target="_blank">GCash</a>`;
      if (req.mileageURL) linksHtml += `<a href="${req.mileageURL}" target="_blank">Mileage</a>`;
      if (req.imageReply) linksHtml += `<a href="${req.imageReply}" target="_blank">Reply Img</a>`;
      if (linksHtml === '<div class="links-container">') linksHtml += "<span>—</span>";
      linksHtml += '</div>';
      docsCell.innerHTML = linksHtml;
      
      // Actions cell
      const actionsCell = row.insertCell(5);
      const isPending = statusText === "PENDING";
      actionsCell.innerHTML = `
        <div class="action-buttons">
          <button class="btn-pay" ${!isPending ? 'disabled' : ''}>Pay</button>
          <button class="btn-deny" ${!isPending ? 'disabled' : ''}>Deny</button>
        </div>
      `;
      
      // Attach event listeners
      const payBtn = actionsCell.querySelector(".btn-pay");
      const denyBtn = actionsCell.querySelector(".btn-deny");
      const statusSpan = statusCell.querySelector(".status-badge");
      
      if (payBtn) {
        payBtn.addEventListener("click", () => handlePay(req.id, row, statusSpan));
      }
      
      if (denyBtn) {
        denyBtn.addEventListener("click", () => handleDeny(req.id, row, statusSpan));
      }
    });
  })
  .catch(err => {
    console.error("Failed to load requests:", err);
    container.innerHTML = '<div class="empty-state">Error loading requests.</div>';
  });

// Handle Pay action
async function handlePay(requestId, row, statusSpan) {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    try {
      const res = await fetch(CLOUDINARY_URL, { method: "POST", body: formData });
      const cloudData = await res.json();

      if (cloudData.secure_url) {
        const imageUrl = cloudData.secure_url;

        await fetch(`/api/admin/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paid", imageReply: imageUrl })
        });

        // Update UI
        statusSpan.textContent = "PAID";
        statusSpan.className = "status-badge paid";
        
        // Disable buttons
        const payBtn = row.cells[5].querySelector(".btn-pay");
        const denyBtn = row.cells[5].querySelector(".btn-deny");
        if (payBtn) payBtn.disabled = true;
        if (denyBtn) denyBtn.disabled = true;
        
        // Add reply link to documents
        const docsCell = row.cells[4];
        const linksContainer = docsCell.querySelector(".links-container");
        if (!linksContainer.querySelector('a[href="' + imageUrl + '"]')) {
          const replyLink = document.createElement("a");
          replyLink.href = imageUrl;
          replyLink.target = "_blank";
          replyLink.textContent = "Reply Img";
          linksContainer.appendChild(replyLink);
        }

        Swal.fire({
          icon: "success",
          title: "Paid",
          text: "Request marked as paid and image uploaded!",
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire({
          icon: "error",
          title: "Upload Failed",
          text: "Cloudinary upload failed."
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Error uploading image or updating request."
      });
    }
  };
}

// Handle Deny action
async function handleDeny(requestId, row, statusSpan) {
  const { isConfirmed } = await Swal.fire({
    title: "Are you sure?",
    text: "Do you want to deny this request?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Yes, deny it",
    cancelButtonText: "Cancel"
  });

  if (!isConfirmed) return;

  try {
    await fetch(`/api/admin/requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "denied" })
    });

    statusSpan.textContent = "DENIED";
    statusSpan.className = "status-badge denied";
    
    const payBtn = row.cells[5].querySelector(".btn-pay");
    const denyBtn = row.cells[5].querySelector(".btn-deny");
    if (payBtn) payBtn.disabled = true;
    if (denyBtn) denyBtn.disabled = true;

    Swal.fire({
      icon: "success",
      title: "Denied",
      text: "Request denied successfully",
      timer: 2000,
      showConfirmButton: false
    });
  } catch (err) {
    console.error(err);
    Swal.fire({
      icon: "error",
      title: "Error",
      text: "Error updating request."
    });
  }
}