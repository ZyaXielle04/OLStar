document.addEventListener("DOMContentLoaded", () => {
    const transportGrid = document.getElementById("transportGrid");
    const transportModal = document.getElementById("transportModal");
    const btnOpenTransportModal = document.getElementById("btnOpenTransportModal");
    const closeModalBtn = transportModal.querySelector(".close");
    const transportForm = document.getElementById("transportForm");
    const transportSearch = document.getElementById("transportSearch");

    let editingID = null;
    let transportData = { units: [] };
    let isLoading = false;

    function showToast(message, icon = "success") {
        Swal.fire({
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2500,
            icon,
            title: message
        });
    }

    async function fetchTransportUnits() {
        if (isLoading) return;
        
        isLoading = true;
        
        try {
            // USE THE WORKING ENDPOINT - NOT THE MAIN ONE
            const url = `/api/admin/transport-units?t=${Date.now()}`;
            
            const res = await fetch(url, {
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            transportData = data;
            renderTransportUnits();
        } catch (err) {
            console.error("Error fetching transport units:", err);
            showToast("Failed to load transport units", "error");
            if (transportGrid) {
                transportGrid.innerHTML = `<p style="text-align:center;color:#ef4444;">Error loading units. Please refresh.</p>`;
            }
        } finally {
            isLoading = false;
        }
    }

    async function saveTransportUnit(data, id = null) {
        const url = id
            ? `/api/admin/transport-units/${id}`
            : `/api/admin/transport-units`;
        
        const method = id ? "PUT" : "POST";
        
        try {
            const res = await fetch(url, {
                method: method,
                headers: { 
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data)
            });
            
            const result = await res.json();
            
            if (!res.ok) {
                showToast(result.error || "Failed to save transport unit", "error");
                return false;
            }
            
            showToast(result.message || "Transport unit saved");
            
            editingID = null;
            transportModal.style.display = "none";
            
            setTimeout(() => {
                fetchTransportUnits();
            }, 100);
            
            return true;
            
        } catch (err) {
            console.error("Error saving transport unit:", err);
            showToast("Failed to save transport unit", "error");
            return false;
        }
    }

    async function deleteTransportUnit(id, name) {
        const confirm = await Swal.fire({
            title: "Delete transport unit?",
            html: `Are you sure you want to delete <strong>${escapeHtml(name)}</strong>?<br>This action cannot be undone.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Delete",
            confirmButtonColor: "#dc2626",
            cancelButtonText: "Cancel"
        });

        if (!confirm.isConfirmed) return;
        
        try {
            const res = await fetch(`/api/admin/transport-units/${id}`, { 
                method: "DELETE"
            });
            const result = await res.json();
            
            if (!res.ok) {
                showToast(result.error || "Failed to delete transport unit", "error");
                return;
            }
            
            showToast(result.message || "Transport unit deleted");
            
            setTimeout(() => {
                fetchTransportUnits();
            }, 100);
            
        } catch (err) {
            console.error("Error deleting transport unit:", err);
            showToast("Failed to delete transport unit", "error");
        }
    }

    function renderTransportUnits() {
        if (!transportGrid) return;
        
        let units = transportData.units || [];
        
        const searchTerm = transportSearch ? transportSearch.value.toLowerCase() : "";
        
        let filtered = units;
        if (searchTerm) {
            filtered = units.filter(u =>
                (u.unitCategory || "").toLowerCase().includes(searchTerm) ||
                (u.unitType || "").toLowerCase().includes(searchTerm) ||
                (u.name || "").toLowerCase().includes(searchTerm) ||
                (u.color || "").toLowerCase().includes(searchTerm) ||
                (u.plateNo || "").toLowerCase().includes(searchTerm)
            );
        }
        
        filtered.sort((a, b) => {
            const nameA = (a.name || "").toLowerCase();
            const nameB = (b.name || "").toLowerCase();
            return nameA.localeCompare(nameB);
        });
        
        transportGrid.innerHTML = "";
        
        if (!filtered.length) {
            transportGrid.innerHTML = `<p style="text-align:center;color:#6b7280;padding:2rem;">No transport units found.</p>`;
            return;
        }
        
        const fragment = document.createDocumentFragment();
        
        filtered.forEach(u => {
            const card = document.createElement("div");
            card.className = "card transport-card";
            
            let categoryDisplay = "";
            let categoryClass = "";
            switch(u.unitCategory) {
                case "company-owned":
                    categoryDisplay = "Company Owned";
                    categoryClass = "company-owned";
                    break;
                case "outsource":
                    categoryDisplay = "Outsource";
                    categoryClass = "outsource";
                    break;
                case "project-based":
                    categoryDisplay = "Project Based";
                    categoryClass = "project-based";
                    break;
                default:
                    categoryDisplay = u.unitCategory || "No Category";
                    categoryClass = "";
            }
            
            card.innerHTML = `
                <div class="transport-header">
                    <h3>${escapeHtml(u.name || 'Unnamed')}</h3>
                    <span class="transport-category ${categoryClass}">${escapeHtml(categoryDisplay)}</span>
                </div>
                <div class="transport-details">
                    <p><strong>Type:</strong> ${escapeHtml(u.unitType || 'N/A')}</p>
                    <p><strong>Color:</strong> ${escapeHtml(u.color || 'N/A')}</p>
                    <p><strong>Plate Number:</strong> ${escapeHtml(u.plateNo || 'N/A')}</p>
                </div>
                <div class="card-actions">
                    <button class="btn btn-sm edit-btn" data-id="${u.id}">Edit</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-id="${u.id}" data-name="${escapeHtml(u.name)}">Delete</button>
                </div>
            `;
            
            fragment.appendChild(card);
        });
        
        transportGrid.appendChild(fragment);
        
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.removeEventListener('click', handleEdit);
            btn.addEventListener('click', handleEdit);
        });
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.removeEventListener('click', handleDelete);
            btn.addEventListener('click', handleDelete);
        });
    }
    
    function handleEdit(e) {
        const btn = e.currentTarget;
        const id = btn.dataset.id;
        const unit = (transportData.units || []).find(u => u.id === id);
        
        if (unit) {
            openEditModal(unit);
        }
    }
    
    function handleDelete(e) {
        const btn = e.currentTarget;
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        deleteTransportUnit(id, name);
    }
    
    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function openEditModal(unit) {
        editingID = unit.id;
        
        const unitCategoryField = document.getElementById('unitCategory');
        const unitTypeField = document.getElementById('unitType');
        const transportUnitField = document.getElementById('transportUnit');
        const colorField = document.getElementById('color');
        const plateNumberField = document.getElementById('plateNumber');
        
        if (unitCategoryField) unitCategoryField.value = unit.unitCategory || "";
        if (unitTypeField) unitTypeField.value = unit.unitType || "";
        if (transportUnitField) transportUnitField.value = unit.name || "";
        if (colorField) colorField.value = unit.color || "";
        if (plateNumberField) plateNumberField.value = unit.plateNo || "";
        
        transportModal.style.display = "flex";
    }

    function openCreateModal() {
        editingID = null;
        transportForm.reset();
        transportModal.style.display = "flex";
    }
    
    function closeModal() {
        transportModal.style.display = "none";
        editingID = null;
        transportForm.reset();
    }

    if (btnOpenTransportModal) {
        btnOpenTransportModal.onclick = openCreateModal;
    }
    
    if (closeModalBtn) {
        closeModalBtn.onclick = closeModal;
    }
    
    window.onclick = e => {
        if (e.target === transportModal) closeModal();
    };

    if (transportForm) {
        transportForm.onsubmit = async e => {
            e.preventDefault();
            
            const unitCategoryField = document.getElementById('unitCategory');
            const unitTypeField = document.getElementById('unitType');
            const transportUnitField = document.getElementById('transportUnit');
            const colorField = document.getElementById('color');
            const plateNumberField = document.getElementById('plateNumber');
            
            const unitCategory = unitCategoryField ? unitCategoryField.value.trim() : "";
            const unitType = unitTypeField ? unitTypeField.value.trim() : "";
            const transportUnit = transportUnitField ? transportUnitField.value.trim() : "";
            const color = colorField ? colorField.value.trim() : "";
            const plateNumber = plateNumberField ? plateNumberField.value.trim() : "";
            
            if (!unitCategory) {
                showToast("Please select unit category", "error");
                return;
            }
            if (!unitType) {
                showToast("Please enter unit type", "error");
                return;
            }
            if (!transportUnit) {
                showToast("Please enter transport unit name", "error");
                return;
            }
            if (!color) {
                showToast("Please enter color", "error");
                return;
            }
            if (!plateNumber) {
                showToast("Please enter plate number", "error");
                return;
            }
            
            const submitBtn = transportForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Saving...";
            }
            
            try {
                await saveTransportUnit({
                    unitCategory: unitCategory,
                    unitType: unitType,
                    transportUnit: transportUnit,
                    color: color,
                    plateNumber: plateNumber.toUpperCase()
                }, editingID);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Save";
                }
            }
        };
    }

    let searchTimeout;
    if (transportSearch) {
        transportSearch.addEventListener("input", () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                renderTransportUnits();
            }, 300);
        });
    }

    const style = document.createElement('style');
    style.textContent = `
        .transport-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .transport-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .transport-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .transport-category { padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
        .transport-category.company-owned { background: #dbeafe; color: #1e40af; }
        .transport-category.outsource { background: #fef3c7; color: #92400e; }
        .transport-category.project-based { background: #dcfce7; color: #166534; }
        .transport-details { margin-bottom: 12px; }
        .transport-details p { margin: 4px 0; font-size: 0.875rem; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);

    fetchTransportUnits();
});