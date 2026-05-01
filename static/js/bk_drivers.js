// BK DRIVERS PAGE - FULL MANAGEMENT
document.addEventListener("DOMContentLoaded", () => {
  const driversGrid = document.getElementById("driversGrid");
  const driverModal = document.getElementById("driverModal");
  const btnCloseModal = driverModal.querySelector(".close");
  const driverForm = document.getElementById("driverForm");
  const modalTitle = driverModal.querySelector(".modal-title");

  let editingDriverId = null;
  let isLoading = false;
  let driversCache = null;
  let lastFetchTime = 0;
  const CACHE_TTL = 10000; // 10 seconds

  // Toast helper
  const toast = Swal.mixin({
    toast: true,
    position: "bottom-end",
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
  });

  // CSRF helper
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return "";
  }

  async function safeFetch(url, options = {}) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let data;
      try { 
        data = JSON.parse(text); 
      } catch { 
        data = { error: text }; 
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: err.message } };
    }
  }

  // Fetch BK Drivers (driverType = "bkdriver" AND role = "driver")
  async function fetchBkDrivers(forceRefresh = false) {
    if (isLoading) return;
    
    if (!forceRefresh && driversCache && (Date.now() - lastFetchTime) < CACHE_TTL) {
      renderDrivers(driversCache);
      return;
    }
    
    isLoading = true;
    driversGrid.innerHTML = "<p>Loading BK drivers...</p>";
    
    const { ok, data } = await safeFetch("/api/admin/bk-drivers");
    isLoading = false;
    
    if (!ok) {
      toast.fire({ icon: "error", title: data.error || "Failed to load drivers" });
      driversGrid.innerHTML = "<p>Error loading drivers. Please refresh.</p>";
      return;
    }
    
    let drivers = data.drivers || [];
    // Sort by name
    drivers.sort((a, b) => {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    driversCache = drivers;
    lastFetchTime = Date.now();
    renderDrivers(drivers);
  }

  function renderDrivers(drivers) {
    if (!driversGrid) return;
    driversGrid.innerHTML = "";
    
    if (drivers.length === 0) {
      driversGrid.innerHTML = "<p>No BK drivers found. Create one using 'Add BK Driver'.</p>";
      return;
    }
    
    const fragment = document.createDocumentFragment();
    drivers.forEach(driver => {
      const card = document.createElement("article");
      card.className = "card user-card";
      card.dataset.uid = driver.uid;
      card.dataset.firstName = driver.firstName || "";
      card.dataset.middleName = driver.middleName || "";
      card.dataset.lastName = driver.lastName || "";
      card.dataset.phone = driver.phone || "";
      card.dataset.email = driver.email || "";
      card.dataset.vanModel = driver.vanModel || "";
      card.dataset.plateNumber = driver.plateNumber || "";
      card.dataset.vanColor = driver.vanColor || "";
      
      const fullName = `${escapeHtml(driver.firstName)} ${escapeHtml(driver.middleName || '')} ${escapeHtml(driver.lastName)}`.trim().replace(/\s+/g, ' ');
      const vanModel = escapeHtml(driver.vanModel || '—');
      const plateNo = escapeHtml(driver.plateNumber || '—');
      const vanColor = escapeHtml(driver.vanColor || '—');
      
      card.innerHTML = `
        <div class="user-header">
          <h3>${fullName}</h3>
          <div style="display: flex; gap: 0.5rem;">
            <span class="bk-badge">BK Driver</span>
            <span class="bk-badge" style="background-color: #e0e7ff; color: #4338ca;">${escapeHtml(driver.role || 'driver')}</span>
          </div>
        </div>
        <div class="user-details">
          <p><strong>📧 Email:</strong> ${escapeHtml(driver.email || '-')}</p>
          <p><strong>📞 Phone:</strong> ${escapeHtml(driver.phone || '-')}</p>
          <div class="van-detail">
            <strong>🚐 Van Info</strong>
            <p>Model: ${vanModel}</p>
            <p>Plate: ${plateNo}</p>
            <p>Color: ${vanColor}</p>
          </div>
        </div>
        <div class="user-actions">
          <button class="btn btn-sm edit-btn">✏️ Edit</button>
          <button class="btn btn-sm btn-warning password-btn">🔑 Password</button>
          <button class="btn btn-sm btn-danger delete-btn">🗑️ Delete</button>
        </div>
      `;
      fragment.appendChild(card);
    });
    
    driversGrid.appendChild(fragment);
    
    // Attach event listeners
    document.querySelectorAll(".edit-btn").forEach(btn => btn.addEventListener("click", openEditDialog));
    document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", deleteDriver));
    document.querySelectorAll(".password-btn").forEach(btn => btn.addEventListener("click", openPasswordModal));
  }
  
  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Open Create Modal
  function openCreateModal() {
    editingDriverId = null;
    driverForm.reset();
    modalTitle.textContent = "Create BK Driver";
    const emailInput = driverForm.querySelector('input[name="email"]');
    if (emailInput) emailInput.disabled = false;
    driverModal.style.display = "block";
  }
  
  // Open Edit Modal
  function openEditDialog(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    editingDriverId = card.dataset.uid;
    
    driverForm.querySelector('input[name="firstName"]').value = card.dataset.firstName;
    driverForm.querySelector('input[name="middleName"]').value = card.dataset.middleName;
    driverForm.querySelector('input[name="lastName"]').value = card.dataset.lastName;
    driverForm.querySelector('input[name="phone"]').value = card.dataset.phone;
    driverForm.querySelector('input[name="email"]').value = card.dataset.email;
    driverForm.querySelector('input[name="vanModel"]').value = card.dataset.vanModel;
    driverForm.querySelector('input[name="plateNumber"]').value = card.dataset.plateNumber;
    driverForm.querySelector('input[name="vanColor"]').value = card.dataset.vanColor;
    
    const emailInput = driverForm.querySelector('input[name="email"]');
    emailInput.disabled = true; // Email not editable on edit
    modalTitle.textContent = "Edit BK Driver";
    driverModal.style.display = "block";
  }
  
  // Password Reset
  function openPasswordModal(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    const uid = card.dataset.uid;
    const driverName = `${card.dataset.firstName} ${card.dataset.lastName}`.trim();
    
    Swal.fire({
      title: `Reset Password for ${escapeHtml(driverName)}`,
      input: "password",
      inputLabel: "New Password",
      inputPlaceholder: "Enter strong password",
      inputAttributes: { autocapitalize: "off", autocorrect: "off" },
      showCancelButton: true,
      confirmButtonText: "Update Password",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#2563eb",
      preConfirm: async (password) => {
        if (!password) {
          Swal.showValidationMessage("Password is required");
          return false;
        }
        const { ok, data } = await safeFetch(`/api/admin/bk-drivers/${uid}/password`, {
          method: "PATCH",
          headers: { 
            "Content-Type": "application/json", 
            "X-CSRFToken": getCookie("XSRF-TOKEN") 
          },
          body: JSON.stringify({ password })
        });
        if (!ok) Swal.showValidationMessage(data.error || "Failed to update password");
        return ok;
      }
    }).then(result => {
      if (result.isConfirmed) toast.fire({ icon: "success", title: "Password updated successfully" });
    });
  }
  
  // Delete Driver
  async function deleteDriver(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    const uid = card.dataset.uid;
    const driverName = `${card.dataset.firstName} ${card.dataset.lastName}`.trim();
    
    const confirm = await Swal.fire({
      icon: "warning",
      title: "Delete BK Driver?",
      html: `Are you sure you want to delete <strong>${escapeHtml(driverName)}</strong>?<br>This action cannot be undone.`,
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626"
    });
    if (!confirm.isConfirmed) return;
    
    const { ok, data } = await safeFetch(`/api/admin/bk-drivers/${uid}`, { 
      method: "DELETE", 
      headers: { "X-CSRFToken": getCookie("XSRF-TOKEN") } 
    });
    if (!ok) return toast.fire({ icon: "error", title: data.error });
    
    toast.fire({ icon: "success", title: "Driver deleted" });
    driversCache = null;
    fetchBkDrivers(true);
  }
  
  // Create or Update Driver
  driverForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const firstName = driverForm.querySelector('input[name="firstName"]').value.trim();
    const middleName = driverForm.querySelector('input[name="middleName"]').value.trim();
    const lastName = driverForm.querySelector('input[name="lastName"]').value.trim();
    const phone = driverForm.querySelector('input[name="phone"]').value.trim();
    const email = driverForm.querySelector('input[name="email"]').value.trim();
    const vanModel = driverForm.querySelector('input[name="vanModel"]').value.trim();
    const plateNumber = driverForm.querySelector('input[name="plateNumber"]').value.trim();
    const vanColor = driverForm.querySelector('input[name="vanColor"]').value.trim();
    
    if (!firstName || !lastName || !phone || (editingDriverId === null && !email)) {
      toast.fire({ icon: "error", title: "Please fill required fields: First name, Last name, Phone, and Email for new driver." });
      return;
    }
    if (!vanModel || !plateNumber || !vanColor) {
      toast.fire({ icon: "error", title: "Van details (Model, Plate Number, Color) are required." });
      return;
    }
    
    const payload = {
      firstName, 
      middleName, 
      lastName, 
      phone,
      vanModel, 
      plateNumber, 
      vanColor,
      role: "driver",
      driverType: "bkdriver"
    };
    
    let url = "/api/admin/bk-drivers";
    let method = "POST";
    if (editingDriverId) {
      url = `/api/admin/bk-drivers/${editingDriverId}`;
      method = "PATCH";
    } else {
      payload.email = email;
    }
    
    const { ok, data } = await safeFetch(url, {
      method,
      headers: { 
        "Content-Type": "application/json", 
        "X-CSRFToken": getCookie("XSRF-TOKEN") 
      },
      body: JSON.stringify(payload)
    });
    
    if (!ok) {
      return toast.fire({ icon: "error", title: data.error || "Operation failed" });
    }
    
    toast.fire({ icon: "success", title: editingDriverId ? "Driver updated" : "BK Driver created" });
    editingDriverId = null;
    driverForm.reset();
    closeModal();
    driversCache = null;
    fetchBkDrivers(true);
  });
  
  function closeModal() { 
    driverModal.style.display = "none"; 
  }
  
  btnCloseModal.addEventListener("click", closeModal);
  window.addEventListener("click", e => e.target === driverModal && closeModal());
  
  document.getElementById("btnOpenCreateModal").addEventListener("click", openCreateModal);
  
  // Auto refresh
  let refreshInterval;
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      if (!document.hidden) fetchBkDrivers(false);
    }, 30000);
  }
  function stopAutoRefresh() { 
    if(refreshInterval) clearInterval(refreshInterval); 
  }
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh();
    else { 
      startAutoRefresh(); 
      fetchBkDrivers(false); 
    }
  });
  
  fetchBkDrivers(false);
  startAutoRefresh();
  window.addEventListener('beforeunload', () => stopAutoRefresh());
});