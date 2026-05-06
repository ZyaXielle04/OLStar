document.addEventListener("DOMContentLoaded", () => {
  const usersGrid = document.getElementById("usersGrid");
  const userModal = document.getElementById("userModal");
  const btnCloseModal = userModal.querySelector(".close");
  const userForm = document.getElementById("userForm");
  const modalTitle = userModal.querySelector(".modal-title");
  const defaultUnitSelect = userForm.defaultUnit;
  const driverTypeSelect = userForm.driverType;

  let editingUserId = null;
  let transportUnits = [];
  let isLoading = false;

  // Cache for users data
  let usersCache = null;
  let lastUsersFetch = 0;
  const USERS_CACHE_TTL = 10000; // 10 seconds

  // ---------------- Toast ----------------
  const toast = Swal.mixin({
    toast: true,
    position: "bottom-end",
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
  });

  // ---------------- Helpers ----------------
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
      try { data = JSON.parse(text); } catch { data = { error: text }; }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: err.message } };
    }
  }

  // ---------------- Transport Units (with caching) ----------------
  async function fetchTransportUnits(forceRefresh = false) {
    // Check session storage for transport units (rarely change)
    if (!forceRefresh) {
      const cached = sessionStorage.getItem('transportUnits');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.expiry > Date.now()) {
            transportUnits = parsed.data;
            populateTransportUnits();
            return;
          }
        } catch(e) {}
      }
    }
    
    // Add cache-busting for force refresh
    const url = forceRefresh 
      ? `/api/admin/transport-units?refresh=true&_=${Date.now()}`
      : "/api/admin/transport-units";
    
    const { ok, data } = await safeFetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    if (!ok) return toast.fire({ icon: "error", title: data.error });

    transportUnits = data.units || [];
    
    // Cache in session storage for 1 hour
    sessionStorage.setItem('transportUnits', JSON.stringify({
      data: transportUnits,
      expiry: Date.now() + 3600000
    }));
    
    populateTransportUnits();
  }

  function populateTransportUnits(selected = "") {
    if (!defaultUnitSelect) return;
    
    defaultUnitSelect.innerHTML = `<option value="">— No Default Transport Unit —</option>`;

    const sortedUnits = [...transportUnits].sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

    sortedUnits.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.plateNo}) [${u.color}]`;
      if (u.id === selected) opt.selected = true;
      defaultUnitSelect.appendChild(opt);
    });
  }

  // ---------------- Users (with auto cache invalidation) ----------------
  async function fetchUsers(forceRefresh = false) {
    if (isLoading) return;
    
    // Bypass cache when forceRefresh is true
    if (!forceRefresh && usersCache && (Date.now() - lastUsersFetch) < USERS_CACHE_TTL) {
      renderUsers(usersCache);
      return;
    }
    
    isLoading = true;
    usersGrid.innerHTML = "<p>Loading users...</p>";
    
    // Add cache-busting parameter when force refreshing
    const url = forceRefresh 
      ? `/api/admin/users?refresh=true&_=${Date.now()}`
      : "/api/admin/users";
    
    const { ok, data } = await safeFetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    isLoading = false;
    
    if (!ok) {
      toast.fire({ icon: "error", title: data.error });
      usersGrid.innerHTML = "<p>Error loading users. Please refresh.</p>";
      return;
    }
    
    // Filter and sort users
    let users = (data.users || [])
      .filter(u => (u.role || "").toLowerCase() !== "admin")
      .filter(u => u.firstName || u.lastName);
    
    users.sort((a, b) => {
      const nameA = `${a.firstName || ""} ${a.middleName || ""} ${a.lastName || ""}`.trim().toLowerCase();
      const nameB = `${b.firstName || ""} ${b.middleName || ""} ${b.lastName || ""}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    // Update cache
    usersCache = users;
    lastUsersFetch = Date.now();
    
    renderUsers(users);
  }

  function renderUsers(users) {
      if (!usersGrid) return;
      usersGrid.innerHTML = "";
      
      if (users.length === 0) {
        usersGrid.innerHTML = "<p>No users found.</p>";
        return;
      }
      
      // Use DocumentFragment for better performance
      const fragment = document.createDocumentFragment();
      
      users.forEach(user => {
        const card = document.createElement("article");
        card.className = "card user-card";
        card.dataset.uid = user.uid;
        card.dataset.firstName = user.firstName || "";
        card.dataset.middleName = user.middleName || "";
        card.dataset.lastName = user.lastName || "";
        card.dataset.phone = user.phone || "";
        card.dataset.driverType = user.driverType || "";
        card.dataset.defaultUnit = user.defaultTransportUnit || "";

        let unitDetails = "-";
        if (user.defaultTransportUnit) {
          const unit = transportUnits.find(u => u.id === user.defaultTransportUnit);
          if (unit) {
            unitDetails = `${unit.name}<br><small>Plate: ${unit.plateNo}<br>Color: ${unit.color}<br>Type: ${unit.unitType}</small>`;
          }
        }

        const driverTypeDisplay = user.driverTypeDisplay || user.driverType || "Not set";
        
        // Determine badge class and style based on driver type
        let badgeClass = "";
        let badgeIcon = "";
        switch(user.driverType) {
          case "main":
            badgeClass = "badge-main";
            badgeIcon = "⭐";
            break;
          case "direct":
            badgeClass = "badge-direct";
            badgeIcon = "🚛";
            break;
          case "indirect":
            badgeClass = "badge-indirect";
            badgeIcon = "📦";
            break;
          case "project":
            badgeClass = "badge-project";
            badgeIcon = "📋";
            break;
          default:
            badgeClass = "badge-default";
            badgeIcon = "👤";
        }

        card.innerHTML = `
          <div class="user-header">
            <h3>${escapeHtml(user.firstName)} ${escapeHtml(user.middleName)} ${escapeHtml(user.lastName)}</h3>
            <span class="driver-badge ${badgeClass}">${badgeIcon}</span>
          </div>
          <div class="user-details">
            <p><strong>Phone:</strong> ${escapeHtml(user.phone || "-")}</p>
            <p><strong>Driver Type:</strong> ${escapeHtml(driverTypeDisplay)}</p>
            <p><strong>Default Unit:</strong> ${unitDetails}</p>
          </div>
          <div class="user-actions">
            <button class="btn btn-sm edit-btn">Edit</button>
            <button class="btn btn-sm btn-warning password-btn">Password</button>
            <button class="btn btn-sm btn-danger delete-btn">Delete</button>
          </div>
        `;
        
        fragment.appendChild(card);
      });
      
      usersGrid.appendChild(fragment);
      
      // Attach event listeners
      document.querySelectorAll(".edit-btn").forEach(b => b.addEventListener("click", openEditUserModal));
      document.querySelectorAll(".delete-btn").forEach(b => b.addEventListener("click", deleteUser));
      document.querySelectorAll(".password-btn").forEach(b => b.addEventListener("click", openPasswordModal));
  }

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------------- Edit User ----------------
  function openEditUserModal(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    
    editingUserId = card.dataset.uid;

    userForm.firstName.value = card.dataset.firstName;
    userForm.middleName.value = card.dataset.middleName;
    userForm.lastName.value = card.dataset.lastName;
    userForm.phone.value = card.dataset.phone;
    userForm.email.value = "";
    userForm.email.disabled = true;

    const driverType = card.dataset.driverType;
    if (driverType && ["main", "indirect", "direct"].includes(driverType)) {
      driverTypeSelect.value = driverType;
    } else {
      driverTypeSelect.value = "";
    }

    populateTransportUnits(card.dataset.defaultUnit);
    modalTitle.textContent = "Edit User";
    openModal();
  }

  // ---------------- Password with Swal2 ----------------
  function openPasswordModal(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    
    const uid = card.dataset.uid;

    Swal.fire({
      title: "Update Password",
      input: "password",
      inputLabel: "New Password",
      inputPlaceholder: "Enter new password",
      inputAttributes: { autocapitalize: "off", autocorrect: "off" },
      showCancelButton: true,
      confirmButtonText: "Update",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#2563eb",
      preConfirm: async (password) => {
        if (!password) {
          Swal.showValidationMessage("Password is required");
          return false;
        }

        const { ok, data } = await safeFetch(`/api/admin/users/${uid}/password`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCookie("XSRF-TOKEN"),
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({ password })
        });

        if (!ok) Swal.showValidationMessage(data.error || "Failed to update password");
        return ok;
      }
    }).then(result => {
      if (result.isConfirmed) {
        toast.fire({ icon: "success", title: "Password updated" });
        // Auto-refresh: Clear cache and fetch fresh data
        usersCache = null;
        fetchUsers(true);
      }
    });
  }

  // ---------------- Delete User - Auto refresh after delete ----------------
  async function deleteUser(e) {
    const card = e.target.closest(".user-card");
    if (!card) return;
    
    const uid = card.dataset.uid;
    const userName = `${card.dataset.firstName} ${card.dataset.lastName}`.trim();

    const confirm = await Swal.fire({
      icon: "warning",
      title: "Delete user?",
      html: `Are you sure you want to delete <strong>${escapeHtml(userName)}</strong>?<br>This action cannot be undone.`,
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626"
    });

    if (!confirm.isConfirmed) return;

    const { ok, data } = await safeFetch(`/api/admin/users/${uid}`, { 
      method: "DELETE",
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!ok) return toast.fire({ icon: "error", title: data.error });

    toast.fire({ icon: "success", title: "User deleted" });
    
    // Auto-refresh: Clear cache and fetch fresh data
    usersCache = null;
    await fetchUsers(true);
  }

  // ---------------- Save User - Auto refresh after save ----------------
  userForm.addEventListener("submit", async e => {
    e.preventDefault();

    if (!driverTypeSelect.value) {
      toast.fire({ icon: "error", title: "Please select a driver type" });
      return;
    }

    const payload = {
      firstName: userForm.firstName.value.trim(),
      middleName: userForm.middleName.value.trim(),
      lastName: userForm.lastName.value.trim(),
      phone: userForm.phone.value.trim(),
      driverType: driverTypeSelect.value,
      defaultTransportUnit: defaultUnitSelect.value || ""
    };

    let url = "/api/admin/users";
    let method = "POST";

    if (editingUserId) {
      url += `/${editingUserId}`;
      method = "PATCH";
    } else {
      payload.email = userForm.email.value.trim();
    }

    const { ok, data } = await safeFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("XSRF-TOKEN"),
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(payload)
    });

    if (!ok) return toast.fire({ icon: "error", title: data.error });

    toast.fire({ icon: "success", title: editingUserId ? "User updated" : "User created" });
    editingUserId = null;
    userForm.reset();
    closeModal();
    
    // Auto-refresh: Clear cache and fetch fresh data
    usersCache = null;
    await fetchUsers(true);
    
    // Also refresh transport units in case assignments changed
    await fetchTransportUnits(true);
  });

  // ---------------- Modal helpers ----------------
  function openModal() { 
    userModal.style.display = "block"; 
  }
  
  function closeModal() { 
    userModal.style.display = "none"; 
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", closeModal);
  }
  
  window.addEventListener("click", e => e.target === userModal && closeModal());

  const btnOpenCreateModal = document.getElementById("btnOpenCreateModal");
  if (btnOpenCreateModal) {
    btnOpenCreateModal.addEventListener("click", () => {
      editingUserId = null;
      userForm.reset();
      userForm.email.disabled = false;
      driverTypeSelect.value = "";
      populateTransportUnits();
      modalTitle.textContent = "Create User";
      openModal();
    });
  }

  // ---------------- Auto-refresh when tab becomes visible ----------------
  let refreshInterval;
  
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    // Refresh every 30 seconds only if tab is visible (background refresh)
    refreshInterval = setInterval(() => {
      if (!document.hidden) {
        // Only refresh if cache is expired (don't force refresh)
        if (!usersCache || (Date.now() - lastUsersFetch) >= USERS_CACHE_TTL) {
          fetchUsers(false);
        }
      }
    }, 30000);
  }
  
  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }
  
  // Visibility API - refresh when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
      // Force refresh when user comes back to the tab
      usersCache = null;
      fetchUsers(true);
      fetchTransportUnits(true);
    }
  });

  // ---------------- Init ----------------
  async function init() {
    await fetchTransportUnits(false);
    await fetchUsers(false);
    startAutoRefresh();
  }
  
  init();
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
  });
});