document.addEventListener("DOMContentLoaded", () => {
  const usersGrid = document.getElementById("usersGrid");
  const userModal = document.getElementById("userModal");
  const btnCloseModal = userModal.querySelector(".close");
  const userForm = document.getElementById("userForm");
  const modalTitle = userModal.querySelector(".modal-title");
  const defaultUnitSelect = userForm.defaultUnit;

  let editingUserId = null;
  let transportUnits = [];

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

  // ---------------- Transport Units ----------------
  async function fetchTransportUnits() {
    const { ok, data } = await safeFetch("/api/admin/transport-units");
    if (!ok) return toast.fire({ icon: "error", title: data.error });

    transportUnits = data.units || [];
    populateTransportUnits();
  }

  function populateTransportUnits(selected = "") {
    defaultUnitSelect.innerHTML = `<option value="">— No Default Transport Unit —</option>`;

    // Sort alphabetically by unit name
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

  // ---------------- Users ----------------
  async function fetchUsers() {
    usersGrid.innerHTML = "<p>Loading users...</p>";
    const { ok, data } = await safeFetch("/api/admin/users");
    if (!ok) return toast.fire({ icon: "error", title: data.error });

    // Filter out admins
    let users = (data.users || [])
      .filter(u => (u.role || "").toLowerCase() !== "admin") // ignore admins
      .filter(u => u.firstName || u.lastName); // only users with real names


    // Sort alphabetically by full name
    users.sort((a, b) => {
      const nameA = `${a.firstName || ""} ${a.middleName || ""} ${a.lastName || ""}`.trim().toLowerCase();
      const nameB = `${b.firstName || ""} ${b.middleName || ""} ${b.lastName || ""}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });

    renderUsers(users);
  }

  function renderUsers(users) {
    usersGrid.innerHTML = "";

    users.forEach(user => {
      const card = document.createElement("article");
      card.className = "card user-card";

      card.dataset.uid = user.uid;
      card.dataset.firstName = user.firstName || "";
      card.dataset.middleName = user.middleName || "";
      card.dataset.lastName = user.lastName || "";
      card.dataset.phone = user.phone || "";
      card.dataset.defaultUnit = user.defaultTransportUnit || "";

      let unitDetails = "-";
      if (user.defaultTransportUnit) {
        const unit = transportUnits.find(u => u.id === user.defaultTransportUnit);
        if (unit) {
          unitDetails = `${unit.name}<p>Plate: ${unit.plateNo}</p><p>Color: ${unit.color}</p><p>Type: ${unit.unitType}</p>`;
        }
      }

      card.innerHTML = `
        <div class="user-header">
          <h3>${user.firstName} ${user.middleName} ${user.lastName}</h3>
          <span class="user-role ${user.role}">${user.role}</span>
        </div>

        <div class="user-details">
          <p>Phone: ${user.phone || "-"}</p>
          <p>Default Unit: ${unitDetails}</p>
        </div>

        <div class="user-actions">
          <button class="btn btn-sm edit-btn">Edit</button>
          <button class="btn btn-sm btn-warning password-btn">Password</button>
          <button class="btn btn-sm btn-danger delete-btn">Delete</button>
        </div>
      `;

      usersGrid.appendChild(card);
    });

    document.querySelectorAll(".edit-btn").forEach(b => b.addEventListener("click", openEditUserModal));
    document.querySelectorAll(".delete-btn").forEach(b => b.addEventListener("click", deleteUser));
    document.querySelectorAll(".password-btn").forEach(b => b.addEventListener("click", openPasswordModal));
  }

  // ---------------- Edit User ----------------
  function openEditUserModal(e) {
    const card = e.target.closest(".user-card");
    editingUserId = card.dataset.uid;

    userForm.firstName.value = card.dataset.firstName;
    userForm.middleName.value = card.dataset.middleName;
    userForm.lastName.value = card.dataset.lastName;
    userForm.phone.value = card.dataset.phone;
    userForm.email.value = "";
    userForm.email.disabled = true;

    populateTransportUnits(card.dataset.defaultUnit);
    modalTitle.textContent = "Edit User";
    openModal();
  }

  // ---------------- Password with Swal2 ----------------
  function openPasswordModal(e) {
    const card = e.target.closest(".user-card");
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
            "X-CSRFToken": getCookie("XSRF-TOKEN")
          },
          body: JSON.stringify({ password })
        });

        if (!ok) Swal.showValidationMessage(data.error || "Failed to update password");
        return ok;
      }
    }).then(result => {
      if (result.isConfirmed) toast.fire({ icon: "success", title: "Password updated" });
    });
  }

  // ---------------- Delete User ----------------
  async function deleteUser(e) {
    const card = e.target.closest(".user-card");
    const uid = card.dataset.uid;

    const confirm = await Swal.fire({
      icon: "warning",
      title: "Delete user?",
      text: "This action cannot be undone.",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel"
    });

    if (!confirm.isConfirmed) return;

    const { ok, data } = await safeFetch(`/api/admin/users/${uid}`, { method: "DELETE" });
    if (!ok) return toast.fire({ icon: "error", title: data.error });

    toast.fire({ icon: "success", title: "User deleted" });

    // small delay to ensure RTDB is consistent
    setTimeout(() => fetchUsers(), 200); 
  }

  // ---------------- Save User ----------------
  userForm.addEventListener("submit", async e => {
    e.preventDefault();

    const payload = {
      firstName: userForm.firstName.value.trim(),
      middleName: userForm.middleName.value.trim(),
      lastName: userForm.lastName.value.trim(),
      phone: userForm.phone.value.trim(),
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
        "X-CSRFToken": getCookie("XSRF-TOKEN")
      },
      body: JSON.stringify(payload)
    });

    if (!ok) return toast.fire({ icon: "error", title: data.error });

    toast.fire({ icon: "success", title: editingUserId ? "User updated" : "User created" });
    editingUserId = null;
    userForm.reset();
    closeModal();
    fetchUsers();
  });

  // ---------------- Modal helpers ----------------
  function openModal() { userModal.style.display = "block"; }
  function closeModal() { userModal.style.display = "none"; }

  btnCloseModal.addEventListener("click", closeModal);
  window.addEventListener("click", e => e.target === userModal && closeModal());

  document.getElementById("btnOpenCreateModal").addEventListener("click", () => {
    editingUserId = null;
    userForm.reset();
    userForm.email.disabled = false;
    populateTransportUnits();
    modalTitle.textContent = "Create User";
    openModal();
  });

  // ---------------- Init ----------------
  fetchTransportUnits();
  fetchUsers();
});
