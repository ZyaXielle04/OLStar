const container = document.getElementById("requestsContainer");

// Cloudinary configuration
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dekdyp7bb/upload";
const CLOUDINARY_UPLOAD_PRESET = "OLStar";

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

      // Card content
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
            ${req.imageReply ? `<a href="${req.imageReply}" target="_blank">Reply Image</a>` : ""}
          </div>

          <div class="request-actions" style="margin-top:10px;">
            <button class="btn-pay">Pay</button>
            <button class="btn-deny">Deny</button>
          </div>
        </div>
      `;

      container.appendChild(card);

      const statusEl = card.querySelector(".status");
      const imagesDiv = card.querySelector(".images");
      const payBtn = card.querySelector(".btn-pay");
      const denyBtn = card.querySelector(".btn-deny");

      // --------- Pay Button ---------
      payBtn.addEventListener("click", async () => {
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

              // Update request status and store image
              await fetch(`/api/admin/requests/${req.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "paid", imageReply: imageUrl })
              });

              // Update UI dynamically
              statusEl.textContent = "PAID";
              statusEl.className = "status paid";

              // Add reply image link
              const replyLink = document.createElement("a");
              replyLink.href = imageUrl;
              replyLink.target = "_blank";
              replyLink.textContent = "Reply Image";
              imagesDiv.appendChild(replyLink);

              payBtn.disabled = true;
              denyBtn.disabled = true;
              alert("Request marked as paid!");
            } else {
              alert("Cloudinary upload failed.");
            }
          } catch (err) {
            console.error(err);
            alert("Error uploading image or updating request.");
          }
        };
      });

      // --------- Deny Button ---------
      denyBtn.addEventListener("click", async () => {
        const confirmDeny = confirm("Are you sure you want to deny this request?");
        if (!confirmDeny) return;

        try {
          await fetch(`/api/admin/requests/${req.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "denied" })
          });

          statusEl.textContent = "DENIED";
          statusEl.className = "status denied";

          payBtn.disabled = true;
          denyBtn.disabled = true;
          alert("Request denied.");
        } catch (err) {
          console.error(err);
          alert("Error updating request.");
        }
      });
    });
  })
  .catch(err => {
    console.error("Failed to load requests:", err);
    container.innerHTML = "<p>Error loading requests.</p>";
  });
