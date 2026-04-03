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
    
    // Cache for filtered results
    let lastSearchTerm = "";
    let filteredCache = null;

    /* ---------- Toast ---------- */
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

    /* ---------- API with caching ---------- */
    async function fetchTransportUnits(forceRefresh = false) {
        if (isLoading) return;
        
        // Check session storage for cached data
        if (!forceRefresh) {
            const cached = sessionStorage.getItem('transportUnitsData');
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (parsed.expiry > Date.now()) {
                        transportData = parsed.data;
                        renderTransportUnits();
                        return;
                    }
                } catch(e) {}
            }
        }
        
        isLoading = true;
        
        try {
            const res = await fetch("/api/admin/transport-units");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            transportData = data;
            
            // Cache in session storage for 30 minutes
            sessionStorage.setItem('transportUnitsData', JSON.stringify({
                data: transportData,
                expiry: Date.now() + 1800000 // 30 minutes
            }));
            
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
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            
            const result = await res.json();
            
            if (!res.ok) {
                showToast(result.error || "Failed to save transport unit", "error");
                return false;
            }
            
            showToast(result.message || "Transport unit saved");
            
            // Clear caches
            sessionStorage.removeItem('transportUnitsData');
            editingID = null;
            
            // Close modal and refresh
            transportModal.style.display = "none";
            await fetchTransportUnits(true);
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
            const res = await fetch(`/api/admin/transport-units/${id}`, { method: "DELETE" });
            const result = await res.json();
            
            if (!res.ok) {
                showToast(result.error || "Failed to delete transport unit", "error");
                return;
            }
            
            showToast(result.message || "Transport unit deleted");
            
            // Clear caches
            sessionStorage.removeItem('transportUnitsData');
            
            // Refresh
            await fetchTransportUnits(true);
            
        } catch (err) {
            console.error("Error deleting transport unit:", err);
            showToast("Failed to delete transport unit", "error");
        }
    }

    /* ---------- Render with optimization ---------- */
    function renderTransportUnits() {
        if (!transportGrid) return;
        
        const searchTerm = transportSearch ? transportSearch.value.toLowerCase() : "";
        
        // Get units array
        let units = transportData.units || [];
        
        // Filter by search
        let filtered = units;
        if (searchTerm) {
            filtered = units.filter(u =>
                (u.unitType || "").toLowerCase().includes(searchTerm) ||
                (u.name || "").toLowerCase().includes(searchTerm) ||
                (u.color || "").toLowerCase().includes(searchTerm) ||
                (u.plateNo || "").toLowerCase().includes(searchTerm)
            );
        }
        
        // Sort alphabetically by name
        filtered.sort((a, b) => {
            const nameA = (a.name || "").toLowerCase();
            const nameB = (b.name || "").toLowerCase();
            return nameA.localeCompare(nameB);
        });
        
        // Clear grid
        transportGrid.innerHTML = "";
        
        if (!filtered.length) {
            transportGrid.innerHTML = `<p style="text-align:center;color:#6b7280;padding:2rem;">No transport units found.</p>`;
            return;
        }
        
        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();
        
        filtered.forEach(u => {
            const card = document.createElement("div");
            card.className = "card transport-card";
            card.style.animation = "fadeIn 0.3s ease";
            
            card.innerHTML = `
                <div class="transport-header">
                    <h3>${escapeHtml(u.name || 'Unnamed')}</h3>
                    <span class="transport-type ${(u.unitType || '').toLowerCase()}">${escapeHtml(u.unitType || 'N/A')}</span>
                </div>
                <div class="transport-details">
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
        
        // Attach event listeners efficiently
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
        transportForm.unitType.value = unit.unitType || "";
        transportForm.transportUnit.value = unit.name || "";
        transportForm.color.value = unit.color || "";
        transportForm.plateNumber.value = unit.plateNo || "";
        transportModal.style.display = "flex";
    }

    /* ---------- Modal handlers ---------- */
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

    /* ---------- Form submission ---------- */
    if (transportForm) {
        transportForm.onsubmit = async e => {
            e.preventDefault();
            
            // Validate form
            const unitType = transportForm.unitType.value.trim();
            const transportUnit = transportForm.transportUnit.value.trim();
            const color = transportForm.color.value.trim();
            const plateNumber = transportForm.plateNumber.value.trim();
            
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
            
            // Disable submit button to prevent double submission
            const submitBtn = transportForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Saving...";
            }
            
            try {
                await saveTransportUnit({
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

    /* ---------- Search with debounce ---------- */
    let searchTimeout;
    if (transportSearch) {
        transportSearch.addEventListener("input", () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                renderTransportUnits();
            }, 300);
        });
    }

    /* ---------- Auto-refresh (optional) ---------- */
    let refreshInterval;
    
    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        // Refresh every 5 minutes (transport units rarely change)
        refreshInterval = setInterval(() => {
            if (!document.hidden) {
                fetchTransportUnits(false); // Use cache if still valid
            }
        }, 300000); // 5 minutes
    }
    
    function stopAutoRefresh() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }
    
    // Visibility API
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoRefresh();
        } else {
            startAutoRefresh();
            fetchTransportUnits(false);
        }
    });

    /* ---------- Add CSS animations ---------- */
    const style = document.createElement('style');
    style.textContent = `
        .transport-card {
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .transport-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .transport-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .transport-type {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        .transport-type.main {
            background: #dbeafe;
            color: #1e40af;
        }
        .transport-type.van {
            background: #dcfce7;
            color: #166534;
        }
        .transport-type.car {
            background: #fed7aa;
            color: #92400e;
        }
        .transport-details {
            margin-bottom: 12px;
        }
        .transport-details p {
            margin: 4px 0;
            font-size: 0.875rem;
        }
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;
    document.head.appendChild(style);

    /* ---------- Init ---------- */
    fetchTransportUnits();
    startAutoRefresh();
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopAutoRefresh();
        if (searchTimeout) clearTimeout(searchTimeout);
    });
});