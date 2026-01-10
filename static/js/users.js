document.addEventListener("DOMContentLoaded", () => {
  const usersGrid = document.getElementById("usersGrid");
  const userModal = document.getElementById("userModal");
  const btnCloseModal = userModal.querySelector(".close");
  const userForm = document.getElementById("userForm");
  const modalTitle = userModal.querySelector(".modal-title");
  let editingUserId = null;

  // SweetAlert2 Toast config
  const toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',   // bottom right
    showConfirmButton: false,
    timer: 3000,              // 3 seconds
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.addEventListener('mouseenter', Swal.stopTimer)
      toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
  });

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
      if (!res.ok) console.warn(`HTTP ${res.status} Error at ${url}:`, data);
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      console.error(`Fetch error at ${url}:`, err);
      return { ok: false, status: 0, data: { error: err.message } };
    }
  }

  // ----------------------- Fetch users -----------------------
  async function fetchUsers() {
    usersGrid.innerHTML = "<p>Loading users...</p>";
    const { ok, data } = await safeFetch("/api/admin/users");
    if (!ok) {
      usersGrid.innerHTML = `<p class='error'>Failed to load users: ${data.error}</p>`;
      toast.fire({ icon: 'error', title: `Failed to load users: ${data.error}` });
      return;
    }

    const users = (data.users || []).filter(user => user.role !== "admin");
    if (!users.length) {
      usersGrid.innerHTML = "<p>No users found.</p>";
      return;
    }

    renderUsers(users);
  }

  // ----------------------- Render users -----------------------
  function renderUsers(users) {
    usersGrid.innerHTML = "";

    users.forEach(user => {
      const firstName = user.firstName || "";
      const middleName = user.middleName ? ` ${user.middleName}` : "";
      const lastName = user.lastName || "";
      const fullName = `${firstName}${middleName} ${lastName}`.trim();
      const phone = user.phone || "";
      const role = user.role || "user";
      const active = user.active === true;

      const card = document.createElement("article");
      card.classList.add("card", "user-card");
      card.innerHTML = `
        <div class="user-header">
          <h3 class="user-name">${fullName}</h3>
          <span class="user-role ${role.toLowerCase()}">${role}</span>
        </div>
        <div class="user-details">
          <p>${role.toUpperCase()}</p>
          <p>Phone: ${phone}</p>
          <p class="${active ? "status-active" : "status-inactive"}">
            ${active ? "Active" : "Inactive"}
          </p>
        </div>
        <div class="user-actions">
          <button class="btn btn-sm edit-btn" data-uid="${user.uid}">Edit</button>
          <button class="btn btn-sm toggle-btn" data-uid="${user.uid}">
            ${active ? "Disable" : "Enable"}
          </button>
          <button class="btn btn-sm password-btn" data-uid="${user.uid}">Change Password</button>
          <button class="btn btn-sm btn-danger delete-btn" data-uid="${user.uid}">Delete</button>
        </div>
      `;
      usersGrid.appendChild(card);
    });

    document.querySelectorAll(".toggle-btn").forEach(btn => btn.addEventListener("click", toggleStatus));
    document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", deleteUser));
    document.querySelectorAll(".edit-btn").forEach(btn => btn.addEventListener("click", openEditUserModal));
    document.querySelectorAll(".password-btn").forEach(btn => btn.addEventListener("click", changePassword));
  }

  // ----------------------- Toggle status -----------------------
  async function toggleStatus(e) {
    const uid = e.target.dataset.uid;
    const enable = e.target.textContent.trim() === "Enable";

    const { ok, data } = await safeFetch(`/api/admin/users/${uid}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("XSRF-TOKEN")
      },
      body: JSON.stringify({ active: enable })
    });

    if (!ok) return toast.fire({ icon: 'error', title: data.error || `Failed to ${enable ? "enable" : "disable"} user` });
    toast.fire({ icon: 'success', title: `User account ${enable ? "enabled" : "disabled"} successfully` });
    fetchUsers();
  }

  // ----------------------- Delete user -----------------------
  async function deleteUser(e) {
    const uid = e.target.dataset.uid;
    const confirmResult = await Swal.fire({
      title: 'Are you sure?',
      text: "This will permanently delete the user!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete!'
    });

    if (!confirmResult.isConfirmed) return;

    const { ok, data } = await safeFetch(`/api/admin/users/${uid}`, {
      method: "DELETE",
      headers: { "X-CSRFToken": getCookie("XSRF-TOKEN") }
    });

    if (!ok) return toast.fire({ icon: 'error', title: data.error || "Failed to delete user" });
    toast.fire({ icon: 'success', title: "User deleted successfully" });
    fetchUsers();
  }

  // ----------------------- Open modal -----------------------
  function openUserModal(isEdit = false) {
    modalTitle.textContent = isEdit ? "Edit User" : "Create User";
    userForm.email.disabled = isEdit;
    openModal(userModal);
  }

  function openEditUserModal(e) {
    const uid = e.target.dataset.uid;
    editingUserId = uid;

    const card = e.target.closest(".user-card");
    const fullName = card.querySelector(".user-name").textContent.trim();
    const phone = card.querySelector(".user-details p:nth-child(2)").textContent.replace("Phone: ", "").trim();

    const nameParts = fullName.split(" ");
    userForm.firstName.value = nameParts[0] || "";
    userForm.middleName.value = nameParts.length === 3 ? nameParts[1] : "";
    userForm.lastName.value = nameParts.length === 3 ? nameParts[2] : (nameParts[1] || "");
    userForm.phone.value = phone;
    userForm.email.value = "";

    openUserModal(true);
  }

  // ----------------------- Submit form -----------------------
  userForm.addEventListener("submit", async e => {
    e.preventDefault();

    const payload = {
      firstName: userForm.firstName.value.trim(),
      middleName: userForm.middleName.value.trim(),
      lastName: userForm.lastName.value.trim(),
      phone: userForm.phone.value.trim()
    };

    if (!editingUserId) {
      const email = userForm.email.value.trim();
      if (!email) return toast.fire({ icon: 'error', title: "Email is required" });
      payload.email = email;

      const { ok, data } = await safeFetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCookie("XSRF-TOKEN")
        },
        body: JSON.stringify(payload)
      });

      if (!ok) return toast.fire({ icon: 'error', title: data.error || "Failed to create user" });
      toast.fire({ icon: 'success', title: "User created successfully" });
    } else {
      const { ok, data } = await safeFetch(`/api/admin/users/${editingUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCookie("XSRF-TOKEN")
        },
        body: JSON.stringify(payload)
      });

      if (!ok) return toast.fire({ icon: 'error', title: data.error || "Failed to update user" });
      toast.fire({ icon: 'success', title: "User updated successfully" });
      editingUserId = null;
    }

    userForm.reset();
    closeModal(userModal);
    fetchUsers();
  });

  // ----------------------- Change password -----------------------
  async function changePassword(e) {
    const uid = e.target.dataset.uid;
    const { value: newPassword } = await Swal.fire({
      title: 'Enter new password',
      input: 'password',
      inputLabel: 'New password',
      inputPlaceholder: 'Enter new password',
      inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
      showCancelButton: true
    });

    if (!newPassword) return;

    const trimmedPassword = newPassword.trim();
    if (!trimmedPassword) return toast.fire({ icon: 'error', title: "Password cannot be empty" });

    const { ok, data } = await safeFetch(`/api/admin/users/${uid}/password`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("XSRF-TOKEN")
      },
      body: JSON.stringify({ password: trimmedPassword })
    });

    if (!ok) return toast.fire({ icon: 'error', title: data.error || "Failed to update password" });
    toast.fire({ icon: 'success', title: "Password updated successfully" });
  }

  // ----------------------- Modal helpers -----------------------
  function openModal(modal) { modal.style.display = "block"; }
  function closeModal(modal) { modal.style.display = "none"; }

  btnCloseModal.addEventListener("click", () => closeModal(userModal));
  window.addEventListener("click", e => { if (e.target === userModal) closeModal(userModal); });

  document.getElementById("btnOpenCreateModal").addEventListener("click", () => {
    editingUserId = null;
    userForm.reset();
    openUserModal(false);
  });

  // ----------------------- Initial fetch -----------------------
  fetchUsers();
});
