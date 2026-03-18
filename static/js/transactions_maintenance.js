document.addEventListener("DOMContentLoaded", () => {
    // ---------------- DOM Elements ----------------
    const maintenanceTableBody = document.getElementById("maintenanceTableBody");
    const searchInput = document.getElementById("searchInput");
    const statusFilter = document.getElementById("statusFilter");
    const typeFilter = document.getElementById("typeFilter");
    const unitFilter = document.getElementById("unitFilter");
    const dateRangeFilter = document.getElementById("dateRangeFilter");
    const startDate = document.getElementById("startDate");
    const endDate = document.getElementById("endDate");
    const applyDateFilter = document.getElementById("applyDateFilter");
    const customDateRange = document.getElementById("customDateRange");
    const refreshBtn = document.getElementById("refreshDataBtn");
    
    // Summary elements
    const totalMaintenance = document.getElementById("totalMaintenance");
    const totalMaintenanceCost = document.getElementById("totalMaintenanceCost");
    const completedCount = document.getElementById("completedCount");
    const completedCost = document.getElementById("completedCost");
    const inProgressCount = document.getElementById("inProgressCount");
    const inProgressCost = document.getElementById("inProgressCost");
    const pendingCount = document.getElementById("pendingCount");
    const pendingCost = document.getElementById("pendingCost");
    
    // Analytics elements
    const analyticsSection = document.getElementById("analyticsSection");
    const toggleAnalyticsBtn = document.getElementById("toggleAnalyticsBtn");
    const alertsSection = document.getElementById("alertsSection");
    const alertBadge = document.getElementById("alertBadge");
    const alertsList = document.getElementById("alertsList");
    const closeAlertsBtn = document.getElementById("closeAlertsBtn");
    
    // Modal elements
    const maintenanceModal = document.getElementById("maintenanceModal");
    const scheduleModal = document.getElementById("scheduleModal");
    const detailsModal = document.getElementById("detailsModal");
    const modalTitle = document.getElementById("modalTitle");
    const maintenanceForm = document.getElementById("maintenanceForm");
    const scheduleForm = document.getElementById("scheduleForm");
    const recordId = document.getElementById("recordId");
    const saveMaintenanceBtn = document.getElementById("saveMaintenanceBtn");
    const cancelBtns = document.querySelectorAll(".cancel-btn");
    const closeModalBtns = document.querySelectorAll(".close-modal");
    
    // Transport unit select elements
    const transportUnitSelect = document.getElementById("transportUnit");
    const scheduleUnitSelect = document.getElementById("scheduleUnit");
    
    // Pagination elements
    const prevPage = document.getElementById("prevPage");
    const nextPage = document.getElementById("nextPage");
    const pageInfo = document.getElementById("pageInfo");
    const recordCount = document.getElementById("recordCount");
    
    // Chart elements
    const costByTypeChart = document.getElementById("costByTypeChart");
    const monthlyTrendChart = document.getElementById("monthlyTrendChart");
    const statusChart = document.getElementById("statusChart");
    const topUnitsList = document.getElementById("topUnitsList");
    
    // Button elements
    const addMaintenanceBtn = document.getElementById("addMaintenanceBtn");
    const scheduleMaintenanceBtn = document.getElementById("scheduleMaintenanceBtn");
    const exportMaintenanceBtn = document.getElementById("exportMaintenanceBtn");
    const maintenanceAlertsBtn = document.getElementById("maintenanceAlertsBtn");
    const editFromDetailsBtn = document.getElementById("editFromDetailsBtn");
    
    // ---------------- CSRF Token ----------------
    function getCSRFToken() {
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        return match ? match[1] : "";
    }

    // ---------------- State ----------------
    let allRecords = [];
    let filteredRecords = [];
    let transportUnits = [];
    let currentPage = 1;
    const recordsPerPage = 10;
    let charts = {};

    // ---------------- Initialize ----------------
    function init() {
        fetchTransportUnits();
        fetchMaintenanceRecords();
        fetchStatistics();
        fetchAlerts();
        setupEventListeners();
        setDefaultDates();
    }

    // ---------------- Event Listeners ----------------
    function setupEventListeners() {
        // Search and filters
        searchInput.addEventListener("input", filterRecords);
        statusFilter.addEventListener("change", filterRecords);
        typeFilter.addEventListener("change", filterRecords);
        unitFilter.addEventListener("change", filterRecords);
        dateRangeFilter.addEventListener("change", handleDateRangeChange);
        applyDateFilter.addEventListener("click", filterRecords);
        refreshBtn.addEventListener("click", refreshData);

        // Modals
        addMaintenanceBtn.addEventListener("click", () => openMaintenanceModal());
        scheduleMaintenanceBtn.addEventListener("click", () => openScheduleModal());
        maintenanceAlertsBtn.addEventListener("click", toggleAlerts);
        closeAlertsBtn.addEventListener("click", () => alertsSection.style.display = "none");
        
        cancelBtns.forEach(btn => btn.addEventListener("click", closeAllModals));
        closeModalBtns.forEach(btn => btn.addEventListener("click", closeAllModals));
        
        window.addEventListener("click", (e) => {
            if (e.target === maintenanceModal) closeAllModals();
            if (e.target === scheduleModal) closeAllModals();
            if (e.target === detailsModal) closeAllModals();
        });

        // Forms
        maintenanceForm.addEventListener("submit", handleMaintenanceSubmit);
        scheduleForm.addEventListener("submit", handleScheduleSubmit);
        
        // Analytics toggle
        toggleAnalyticsBtn.addEventListener("click", toggleAnalytics);
        
        // Pagination
        prevPage.addEventListener("click", () => changePage(currentPage - 1));
        nextPage.addEventListener("click", () => changePage(currentPage + 1));
        
        // Export
        exportMaintenanceBtn.addEventListener("click", exportData);
        
        // Edit from details
        editFromDetailsBtn.addEventListener("click", () => {
            const id = editFromDetailsBtn.dataset.id;
            if (id) {
                closeAllModals();
                openMaintenanceModal(id);
            }
        });
    }

    // ---------------- API Calls ----------------
    async function fetchTransportUnits() {
        try {
            const response = await fetch("/api/transportUnits");
            if (!response.ok) throw new Error("Failed to fetch transport units");
            
            const data = await response.json();
            console.log("Transport units API response:", data);
            
            transportUnits = data.transportUnits || [];
            console.log("Processed transport units:", transportUnits);
            
            // Log each unit's structure
            transportUnits.forEach((unit, index) => {
                console.log(`Unit ${index + 1}:`, {
                    id: unit.id,
                    transportUnit: unit.transportUnit,
                    plateNumber: unit.plateNumber
                });
            });
            
            populateUnitFilters();
        } catch (err) {
            console.error("Error fetching transport units:", err);
            showToast("Failed to load transport units", "error");
        }
    }

    async function fetchMaintenanceRecords() {
        try {
            const response = await fetch("/api/maintenance/records");
            if (!response.ok) throw new Error("Failed to fetch maintenance records");
            
            const data = await response.json();
            allRecords = (data.records || []).sort((a, b) => new Date(b.date) - new Date(a.date));
            
            filterRecords();
        } catch (err) {
            console.error("Error fetching maintenance records:", err);
            showToast("Failed to load maintenance records", "error");
            maintenanceTableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center">Failed to load records</td>
                </tr>
            `;
        }
    }

    async function fetchStatistics() {
        try {
            const params = new URLSearchParams();
            if (startDate.value) params.append("startDate", startDate.value);
            if (endDate.value) params.append("endDate", endDate.value);
            
            const response = await fetch(`/api/maintenance/statistics?${params}`);
            if (!response.ok) throw new Error("Failed to fetch statistics");
            
            const data = await response.json();
            updateStatistics(data.statistics);
        } catch (err) {
            console.error("Error fetching statistics:", err);
        }
    }

    async function fetchAlerts() {
        try {
            const response = await fetch("/api/maintenance/alerts");
            if (!response.ok) throw new Error("Failed to fetch alerts");
            
            const data = await response.json();
            if (data.alerts && data.alerts.length > 0) {
                alertBadge.textContent = data.alerts.length;
                alertBadge.style.display = "inline";
                renderAlerts(data.alerts);
            } else {
                alertBadge.style.display = "none";
            }
        } catch (err) {
            console.error("Error fetching alerts:", err);
        }
    }

    // ---------------- Filtering ----------------
    function filterRecords() {
        const searchTerm = searchInput.value.toLowerCase();
        const status = statusFilter.value;
        const type = typeFilter.value;
        const unitName = unitFilter.value; // This now contains the unit name, not ID
        const dateRange = dateRangeFilter.value;
        
        filteredRecords = allRecords.filter(record => {
            // Search filter
            if (searchTerm) {
                const matchesSearch = 
                    (record.transportUnit?.name || "").toLowerCase().includes(searchTerm) ||
                    (record.transportUnit?.plateNumber || "").toLowerCase().includes(searchTerm) ||
                    (record.description || "").toLowerCase().includes(searchTerm) ||
                    (record.serviceType || "").toLowerCase().includes(searchTerm) ||
                    (record.notes || "").toLowerCase().includes(searchTerm);
                
                if (!matchesSearch) return false;
            }
            
            // Status filter
            if (status !== "all" && record.status !== status) return false;
            
            // Type filter
            if (type !== "all" && record.serviceType !== type) return false;
            
            // Unit filter (now filtering by unit name instead of ID)
            if (unitName && record.transportUnit?.name !== unitName) return false;
            
            // Date range filter
            if (dateRange !== "all" && dateRange !== "custom") {
                if (!isInDateRange(record.date, dateRange)) return false;
            } else if (dateRange === "custom" && startDate.value && endDate.value) {
                const recordDate = new Date(record.date);
                const start = new Date(startDate.value);
                const end = new Date(endDate.value);
                end.setHours(23, 59, 59);
                
                if (recordDate < start || recordDate > end) return false;
            }
            
            return true;
        });
        
        updateSummary();
        updateCharts();
        currentPage = 1;
        renderTable();
        updatePagination();
    }

    function isInDateRange(dateStr, range) {
        const date = new Date(dateStr);
        const today = new Date();
        const start = new Date();
        
        switch(range) {
            case "today":
                return date.toDateString() === today.toDateString();
            case "yesterday":
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                return date.toDateString() === yesterday.toDateString();
            case "this_week":
                start.setDate(today.getDate() - today.getDay());
                return date >= start;
            case "last_week":
                start.setDate(today.getDate() - today.getDay() - 7);
                const end = new Date(start);
                end.setDate(end.getDate() + 7);
                return date >= start && date < end;
            case "this_month":
                return date.getMonth() === today.getMonth() && 
                       date.getFullYear() === today.getFullYear();
            case "last_month":
                const lastMonth = new Date(today);
                lastMonth.setMonth(lastMonth.getMonth() - 1);
                return date.getMonth() === lastMonth.getMonth() &&
                       date.getFullYear() === lastMonth.getFullYear();
            case "this_quarter":
                const quarter = Math.floor(today.getMonth() / 3);
                return Math.floor(date.getMonth() / 3) === quarter &&
                       date.getFullYear() === today.getFullYear();
            case "last_quarter":
                const lastQuarterDate = new Date(today);
                lastQuarterDate.setMonth(lastQuarterDate.getMonth() - 3);
                const lastQuarter = Math.floor(lastQuarterDate.getMonth() / 3);
                return Math.floor(date.getMonth() / 3) === lastQuarter &&
                       date.getFullYear() === lastQuarterDate.getFullYear();
            case "this_year":
                return date.getFullYear() === today.getFullYear();
            case "last_year":
                return date.getFullYear() === today.getFullYear() - 1;
            default:
                return true;
        }
    }

    // ---------------- Summary Updates ----------------
    function updateSummary() {
        const total = filteredRecords.length;
        const totalCost = filteredRecords.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
        
        const completed = filteredRecords.filter(r => r.status === "completed");
        const inProgress = filteredRecords.filter(r => r.status === "in-progress");
        const pending = filteredRecords.filter(r => r.status === "pending");
        
        totalMaintenance.textContent = total;
        totalMaintenanceCost.textContent = `₱${totalCost.toLocaleString()}`;
        
        completedCount.textContent = completed.length;
        completedCost.textContent = `₱${completed.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0).toLocaleString()}`;
        
        inProgressCount.textContent = inProgress.length;
        inProgressCost.textContent = `₱${inProgress.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0).toLocaleString()}`;
        
        pendingCount.textContent = pending.length;
        pendingCost.textContent = `₱${pending.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0).toLocaleString()}`;
        
        recordCount.textContent = `${filteredRecords.length} records`;
    }

    function updateStatistics(statistics) {
        // This would update any additional statistics displays
        console.log("Statistics:", statistics);
    }

    // ---------------- Chart Updates ----------------
    function updateCharts() {
        if (!costByTypeChart || !monthlyTrendChart || !statusChart) return;
        
        // Destroy existing charts properly
        if (charts.costByType) {
            charts.costByType.destroy();
            charts.costByType = null;
        }
        if (charts.monthlyTrend) {
            charts.monthlyTrend.destroy();
            charts.monthlyTrend = null;
        }
        if (charts.status) {
            charts.status.destroy();
            charts.status = null;
        }
        
        // Clear the canvases by resetting their dimensions
        [costByTypeChart, monthlyTrendChart, statusChart].forEach(canvas => {
            if (canvas) {
                const parent = canvas.parentElement;
                const originalWidth = parent ? parent.clientWidth : 300;
                
                canvas.style.width = '100%';
                canvas.style.height = '200px';
                canvas.width = originalWidth;
                canvas.height = 200;
            }
        });

        setTimeout(() => {
            // Cost by Type Chart
            const costByType = {};
            filteredRecords.forEach(record => {
                const type = record.serviceType || "other";
                costByType[type] = (costByType[type] || 0) + (parseFloat(record.cost) || 0);
            });
            
            if (Object.keys(costByType).length > 0) {
                charts.costByType = new Chart(costByTypeChart, {
                    type: "doughnut",
                    data: {
                        labels: Object.keys(costByType).map(formatServiceType),
                        datasets: [{
                            data: Object.values(costByType),
                            backgroundColor: [
                                "#1976d2", "#388e3c", "#f57c00", "#d32f2f", 
                                "#7b1fa2", "#0288d1", "#388e3c", "#f57c00"
                            ],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { 
                                position: "bottom",
                                labels: {
                                    boxWidth: 12,
                                    padding: 15
                                }
                            }
                        },
                        layout: {
                            padding: {
                                top: 10,
                                bottom: 10
                            }
                        }
                    }
                });
            } else {
                const ctx = costByTypeChart.getContext('2d');
                ctx.clearRect(0, 0, costByTypeChart.width, costByTypeChart.height);
                ctx.font = '12px Arial';
                ctx.fillStyle = '#999';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', costByTypeChart.width/2, costByTypeChart.height/2);
            }
            
            // Monthly Trend Chart
            const monthlyData = {};
            filteredRecords.forEach(record => {
                const date = new Date(record.date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                monthlyData[monthKey] = (monthlyData[monthKey] || 0) + (parseFloat(record.cost) || 0);
            });
            
            const sortedMonths = Object.keys(monthlyData).sort();
            
            if (sortedMonths.length > 0) {
                charts.monthlyTrend = new Chart(monthlyTrendChart, {
                    type: "line",
                    data: {
                        labels: sortedMonths.map(m => {
                            const [year, month] = m.split("-");
                            return `${month}/${year}`;
                        }),
                        datasets: [{
                            label: "Maintenance Cost",
                            data: sortedMonths.map(m => monthlyData[m]),
                            borderColor: "#1976d2",
                            backgroundColor: "rgba(25, 118, 210, 0.1)",
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: "#1976d2",
                            pointBorderColor: "#fff",
                            pointBorderWidth: 2,
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return '₱' + context.raw.toLocaleString();
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: value => "₱" + value.toLocaleString(),
                                    maxTicksLimit: 6
                                },
                                grid: {
                                    color: '#e0e0e0'
                                }
                            },
                            x: {
                                grid: {
                                    display: false
                                }
                            }
                        },
                        layout: {
                            padding: {
                                top: 10,
                                bottom: 10,
                                left: 5,
                                right: 5
                            }
                        }
                    }
                });
            } else {
                const ctx = monthlyTrendChart.getContext('2d');
                ctx.clearRect(0, 0, monthlyTrendChart.width, monthlyTrendChart.height);
                ctx.font = '12px Arial';
                ctx.fillStyle = '#999';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', monthlyTrendChart.width/2, monthlyTrendChart.height/2);
            }
            
            // Status Distribution Chart
            const statusCounts = {
                completed: filteredRecords.filter(r => r.status === "completed").length,
                "in-progress": filteredRecords.filter(r => r.status === "in-progress").length,
                pending: filteredRecords.filter(r => r.status === "pending").length,
                cancelled: filteredRecords.filter(r => r.status === "cancelled").length
            };
            
            if (Object.values(statusCounts).some(v => v > 0)) {
                charts.status = new Chart(statusChart, {
                    type: "pie",
                    data: {
                        labels: ["Completed", "In Progress", "Pending", "Cancelled"],
                        datasets: [{
                            data: Object.values(statusCounts),
                            backgroundColor: ["#388e3c", "#f57c00", "#d32f2f", "#9e9e9e"],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { 
                                position: "bottom",
                                labels: {
                                    boxWidth: 12,
                                    padding: 15
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.raw || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                        return `${label}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        },
                        layout: {
                            padding: {
                                top: 10,
                                bottom: 10
                            }
                        }
                    }
                });
            } else {
                const ctx = statusChart.getContext('2d');
                ctx.clearRect(0, 0, statusChart.width, statusChart.height);
                ctx.font = '12px Arial';
                ctx.fillStyle = '#999';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', statusChart.width/2, statusChart.height/2);
            }
            
            // Top Units List (now using stored transportUnit data)
            const unitCosts = {};
            filteredRecords.forEach(record => {
                if (record.transportUnit?.name) {
                    const unitName = record.transportUnit.name;
                    unitCosts[unitName] = (unitCosts[unitName] || 0) + (parseFloat(record.cost) || 0);
                }
            });
            
            const topUnits = Object.entries(unitCosts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            
            if (topUnits.length > 0) {
                topUnitsList.innerHTML = topUnits.map(([unitName, cost]) => {
                    // Find the first record with this unit to get plate number
                    const record = filteredRecords.find(r => r.transportUnit?.name === unitName);
                    return `
                        <div class="unit-item">
                            <div class="unit-info">
                                <div class="unit-name">${unitName}</div>
                                <div class="unit-plate">${record?.transportUnit?.plateNumber || ""}</div>
                            </div>
                            <div class="unit-cost">₱${cost.toLocaleString()}</div>
                        </div>
                    `;
                }).join("");
            } else {
                topUnitsList.innerHTML = '<div class="loading">No data available</div>';
            }
        }, 50);
    }

    // ---------------- Table Rendering ----------------
    function renderTable() {
        const start = (currentPage - 1) * recordsPerPage;
        const end = start + recordsPerPage;
        const pageRecords = filteredRecords.slice(start, end);
        
        if (pageRecords.length === 0) {
            maintenanceTableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center">No maintenance records found</td>
                </tr>
            `;
            return;
        }
        
        maintenanceTableBody.innerHTML = pageRecords.map(record => {
            const statusClass = getStatusClass(record.status);
            
            return `
                <tr>
                    <td>${formatDate(record.date)}</td>
                    <td><strong>${record.transportUnit?.name || "—"}</strong></td>
                    <td>${record.transportUnit?.plateNumber || "—"}</td>
                    <td><span class="service-type-badge">${formatServiceType(record.serviceType)}</span></td>
                    <td>${truncateText(record.description, 50)}</td>
                    <td><strong>₱${parseFloat(record.cost || 0).toLocaleString()}</strong></td>
                    <td><span class="status-badge ${statusClass}">${formatStatus(record.status)}</span></td>
                    <td>${record.mechanic || "—"}</td>
                    <td>${record.nextDueDate ? formatDate(record.nextDueDate) : "—"}</td>
                    <td>
                        <button class="action-btn view" data-id="${record.id}" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn edit" data-id="${record.id}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete" data-id="${record.id}" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                        <button class="action-btn history" data-id="${record.id}" title="History">
                            <i class="fas fa-history"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
        
        // Attach event listeners to action buttons
        document.querySelectorAll(".action-btn.view").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                viewRecord(btn.dataset.id);
            });
        });
        
        document.querySelectorAll(".action-btn.edit").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                openMaintenanceModal(btn.dataset.id);
            });
        });
        
        document.querySelectorAll(".action-btn.delete").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                deleteRecord(btn.dataset.id);
            });
        });
        
        document.querySelectorAll(".action-btn.history").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                viewHistory(btn.dataset.id);
            });
        });
    }

    // ---------------- Alert Functions ----------------
    function renderAlerts(alerts) {
        alertsList.innerHTML = alerts.map(alert => {
            return `
                <div class="alert-item">
                    <div class="alert-content">
                        <div class="alert-title">
                            <strong>${alert.record?.transportUnit?.name || "Unknown Unit"}</strong> - ${alert.message}
                        </div>
                        <div class="alert-details">
                            ${alert.record?.serviceType ? formatServiceType(alert.record.serviceType) : ""}
                        </div>
                    </div>
                    <div class="alert-actions">
                        <button class="alert-btn schedule" onclick="location.href='#record-${alert.id}'">
                            View
                        </button>
                        <button class="alert-btn dismiss" onclick="this.closest('.alert-item').remove()">
                            Dismiss
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    // ---------------- Modal Functions ----------------
    function openMaintenanceModal(id = null) {
        resetForm(maintenanceForm);
        
        if (id) {
            modalTitle.textContent = "Edit Maintenance Record";
            const record = allRecords.find(r => r.id === id);
            if (record) {
                recordId.value = record.id;
                document.getElementById("maintenanceDate").value = record.date || "";
                
                // Set the select value to the unit name
                const unitSelect = document.getElementById("transportUnit");
                if (record.transportUnit?.name) {
                    unitSelect.value = record.transportUnit.name;
                } else {
                    unitSelect.value = "";
                }
                
                document.getElementById("serviceType").value = record.serviceType || "";
                document.getElementById("maintenanceStatus").value = record.status || "pending";
                document.getElementById("description").value = record.description || "";
                document.getElementById("cost").value = record.cost || "";
                document.getElementById("mechanic").value = record.mechanic || "";
                document.getElementById("odometerReading").value = record.odometerReading || "";
                document.getElementById("nextDueDate").value = record.nextDueDate || "";
                document.getElementById("nextDueOdometer").value = record.nextDueOdometer || "";
                document.getElementById("notes").value = record.notes || "";
            }
        } else {
            modalTitle.textContent = "New Maintenance Record";
            document.getElementById("maintenanceDate").value = new Date().toISOString().split("T")[0];
            document.getElementById("maintenanceStatus").value = "pending";
            document.getElementById("transportUnit").value = "";
        }
        
        maintenanceModal.style.display = "block";
    }

    function openScheduleModal() {
        scheduleModal.style.display = "block";
        document.getElementById("scheduledDate").value = new Date().toISOString().split("T")[0];
    }

    async function viewRecord(id) {
        try {
            const response = await fetch(`/api/maintenance/records/${id}`);
            if (!response.ok) throw new Error("Failed to fetch record");
            
            const data = await response.json();
            const record = data.record;
            
            const detailsHtml = `
                <div class="detail-group">
                    <h3>Maintenance Information</h3>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Date</div>
                            <div class="detail-value">${formatDate(record.date)}</div>
                        </div>
                        <div>
                            <div class="detail-label">Service Type</div>
                            <div class="detail-value">${formatServiceType(record.serviceType)}</div>
                        </div>
                        <div>
                            <div class="detail-label">Status</div>
                            <div class="detail-value"><span class="status-badge ${getStatusClass(record.status)}">${formatStatus(record.status)}</span></div>
                        </div>
                    </div>
                </div>
                
                <div class="detail-group">
                    <h3>Transport Unit</h3>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Unit</div>
                            <div class="detail-value">${record.transportUnit?.name || "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Plate Number</div>
                            <div class="detail-value">${record.transportUnit?.plateNumber || "—"}</div>
                        </div>
                    </div>
                </div>
                
                <div class="detail-group">
                    <h3>Service Details</h3>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Description</div>
                            <div class="detail-value">${record.description || "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Cost</div>
                            <div class="detail-value">₱${parseFloat(record.cost || 0).toLocaleString()}</div>
                        </div>
                    </div>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Mechanic/Shop</div>
                            <div class="detail-value">${record.mechanic || "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Odometer Reading</div>
                            <div class="detail-value">${record.odometerReading ? record.odometerReading.toLocaleString() + " km" : "—"}</div>
                        </div>
                    </div>
                </div>
                
                <div class="detail-group">
                    <h3>Next Maintenance</h3>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Due Date</div>
                            <div class="detail-value">${record.nextDueDate ? formatDate(record.nextDueDate) : "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Due Odometer</div>
                            <div class="detail-value">${record.nextDueOdometer ? record.nextDueOdometer.toLocaleString() + " km" : "—"}</div>
                        </div>
                    </div>
                </div>
                
                <div class="detail-group">
                    <h3>Additional Notes</h3>
                    <div class="detail-value">${record.notes || "No notes"}</div>
                </div>
                
                <div class="detail-group">
                    <h3>Metadata</h3>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Created By</div>
                            <div class="detail-value">${record.createdBy || "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Created At</div>
                            <div class="detail-value">${record.createdAt ? new Date(record.createdAt).toLocaleString() : "—"}</div>
                        </div>
                    </div>
                    <div class="detail-row">
                        <div>
                            <div class="detail-label">Last Modified By</div>
                            <div class="detail-value">${record.lastModifiedBy || "—"}</div>
                        </div>
                        <div>
                            <div class="detail-label">Last Modified</div>
                            <div class="detail-value">${record.lastModified ? new Date(record.lastModified).toLocaleString() : "—"}</div>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById("detailsContainer").innerHTML = detailsHtml;
            editFromDetailsBtn.dataset.id = id;
            detailsModal.style.display = "block";
        } catch (err) {
            console.error("Error fetching record details:", err);
            showToast("Failed to load record details", "error");
        }
    }

    function closeAllModals() {
        maintenanceModal.style.display = "none";
        scheduleModal.style.display = "none";
        detailsModal.style.display = "none";
        resetForm(maintenanceForm);
        resetForm(scheduleForm);
    }

    // ---------------- Form Handlers ----------------
    async function handleMaintenanceSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(maintenanceForm);
        const id = recordId.value;
        
        // Get the selected transport unit
        const selectedUnitName = formData.get("unitId");
        const selectedUnit = transportUnits.find(u => u.transportUnit === selectedUnitName);
        
        // Store the complete transport unit information
        const transportUnitData = selectedUnit ? {
            id: selectedUnit.id,
            name: selectedUnit.transportUnit,
            plateNumber: selectedUnit.plateNumber,
            color: selectedUnit.color,
            unitType: selectedUnit.unitType
        } : null;
        
        const recordData = {
            date: formData.get("date"),
            transportUnit: transportUnitData,  // Store the whole unit object
            serviceType: formData.get("serviceType"),
            status: formData.get("status"),
            description: formData.get("description"),
            cost: parseFloat(formData.get("cost")) || 0,
            mechanic: formData.get("mechanic") || "",
            odometerReading: parseInt(formData.get("odometerReading")) || null,
            nextDueDate: formData.get("nextDueDate") || null,
            nextDueOdometer: parseInt(formData.get("nextDueOdometer")) || null,
            notes: formData.get("notes") || ""
        };
        
        console.log("Submitting maintenance record with transport unit:", recordData.transportUnit);
        
        try {
            const url = id ? `/api/maintenance/records/${id}` : "/api/maintenance/records";
            const method = id ? "PUT" : "POST";
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify(recordData),
                credentials: "include"
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(error);
            }
            
            const data = await response.json();
            
            showToast(
                id ? "Maintenance record updated successfully" : "Maintenance record added successfully",
                "success"
            );
            
            closeAllModals();
            await fetchMaintenanceRecords();
            await fetchStatistics();
            await fetchAlerts();
        } catch (err) {
            console.error("Error saving maintenance record:", err);
            showToast("Failed to save record", "error");
        }
    }

    async function handleScheduleSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(scheduleForm);
        
        // Get the selected transport unit
        const selectedUnitName = formData.get("unitId");
        const selectedUnit = transportUnits.find(u => u.transportUnit === selectedUnitName);
        
        const scheduleData = {
            transportUnit: selectedUnit ? {
                id: selectedUnit.id,
                name: selectedUnit.transportUnit,
                plateNumber: selectedUnit.plateNumber
            } : null,
            serviceType: formData.get("serviceType"),
            scheduledDate: formData.get("scheduledDate"),
            scheduledTime: formData.get("scheduledTime") || null,
            notes: formData.get("notes") || "",
            status: "scheduled",
            createdAt: new Date().toISOString()
        };
        
        try {
            const response = await fetch("/api/maintenance/schedules", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify(scheduleData),
                credentials: "include"
            });
            
            if (!response.ok) throw new Error("Failed to schedule maintenance");
            
            showToast("Maintenance scheduled successfully", "success");
            closeAllModals();
            await fetchAlerts();
        } catch (err) {
            console.error("Error scheduling maintenance:", err);
            showToast("Failed to schedule maintenance", "error");
        }
    }

    async function deleteRecord(id) {
        const result = await Swal.fire({
            title: "Delete Maintenance Record?",
            text: "This action cannot be undone",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            confirmButtonText: "Delete"
        });
        
        if (result.isConfirmed) {
            try {
                const response = await fetch(`/api/maintenance/records/${id}`, {
                    method: "DELETE",
                    headers: {
                        "X-CSRFToken": getCSRFToken()
                    },
                    credentials: "include"
                });
                
                if (!response.ok) throw new Error("Failed to delete record");
                
                showToast("Record deleted successfully", "success");
                await fetchMaintenanceRecords();
                await fetchStatistics();
                await fetchAlerts();
            } catch (err) {
                console.error("Error deleting record:", err);
                showToast("Failed to delete record", "error");
            }
        }
    }

    // ---------------- History Function ----------------
    async function viewHistory(id) {
        try {
            const response = await fetch(`/api/maintenance/records/${id}/history`);
            if (!response.ok) throw new Error("Failed to fetch history");
            
            const data = await response.json();
            const history = data.history || [];
            
            let historyHtml = "<h3>Change History</h3>";
            
            if (history.length === 0) {
                historyHtml += "<p>No history available</p>";
            } else {
                historyHtml += "<div class='history-list'>";
                history.forEach(entry => {
                    const date = new Date(entry.timestamp);
                    historyHtml += `
                        <div class="history-item" style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                            <div><strong>${entry.action || "updated"}</strong> by ${entry.user || "Unknown"}</div>
                            <div style="font-size: 12px; color: #666;">${date.toLocaleString()}</div>
                            ${entry.changes ? `
                                <div style="margin-top: 8px;">
                                    ${entry.changes.map(change => {
                                        // Format the change display for transportUnit
                                        if (change.field === "transportUnit") {
                                            const oldName = change.old?.name || "(empty)";
                                            const newName = change.new?.name || "(empty)";
                                            return `
                                                <div style="font-size: 12px; padding: 2px 0;">
                                                    <strong>Transport Unit:</strong> 
                                                    ${oldName} → ${newName}
                                                </div>
                                            `;
                                        } else {
                                            return `
                                                <div style="font-size: 12px; padding: 2px 0;">
                                                    <strong>${change.field}:</strong> 
                                                    ${change.old || "(empty)"} → ${change.new || "(empty)"}
                                                </div>
                                            `;
                                        }
                                    }).join("")}
                                </div>
                            ` : ""}
                        </div>
                    `;
                });
                historyHtml += "</div>";
            }
            
            Swal.fire({
                title: "Record History",
                html: historyHtml,
                width: "600px",
                confirmButtonText: "Close"
            });
        } catch (err) {
            console.error("Error fetching history:", err);
            showToast("Failed to load history", "error");
        }
    }

    // ---------------- Helper Functions ----------------
    function populateUnitFilters() {
        const options = ['<option value="">All Transport Units</option>'];
        const unitOptions = ['<option value="">— Select Transport Unit —</option>'];
        
        // Get unique unit names
        const uniqueUnits = new Map();
        transportUnits.forEach(unit => {
            if (!uniqueUnits.has(unit.transportUnit)) {
                uniqueUnits.set(unit.transportUnit, unit);
            }
        });
        
        Array.from(uniqueUnits.values()).forEach(unit => {
            const option = `<option value="${unit.transportUnit}">${unit.transportUnit} (${unit.plateNumber})</option>`;
            options.push(option);
            unitOptions.push(option);
        });
        
        unitFilter.innerHTML = options.join("");
        transportUnitSelect.innerHTML = unitOptions.join("");
        scheduleUnitSelect.innerHTML = unitOptions.join("");
    }

    function setDefaultDates() {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        startDate.value = thirtyDaysAgo.toISOString().split("T")[0];
        endDate.value = today.toISOString().split("T")[0];
    }

    function handleDateRangeChange() {
        customDateRange.style.display = dateRangeFilter.value === "custom" ? "flex" : "none";
        if (dateRangeFilter.value !== "custom") {
            filterRecords();
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return "—";
        const date = new Date(dateStr);
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatServiceType(type) {
        const types = {
            "routine": "Routine Maintenance",
            "repair": "Repair",
            "emergency": "Emergency",
            "inspection": "Inspection",
            "oil-change": "Oil Change",
            "tire": "Tire Service",
            "engine": "Engine Service",
            "brake": "Brake Service",
            "electrical": "Electrical",
            "other": "Other"
        };
        return types[type] || type || "—";
    }

    function formatStatus(status) {
        const statuses = {
            "completed": "Completed",
            "in-progress": "In Progress",
            "pending": "Pending",
            "cancelled": "Cancelled",
            "scheduled": "Scheduled"
        };
        return statuses[status] || status || "—";
    }

    function getStatusClass(status) {
        const classes = {
            "completed": "status-completed",
            "in-progress": "status-in-progress",
            "pending": "status-pending",
            "cancelled": "status-cancelled"
        };
        return classes[status] || "";
    }

    function truncateText(text, length) {
        if (!text) return "—";
        return text.length > length ? text.substring(0, length) + "..." : text;
    }

    function resetForm(form) {
        form.reset();
        recordId.value = "";
    }

    function changePage(page) {
        if (page < 1 || page > Math.ceil(filteredRecords.length / recordsPerPage)) return;
        currentPage = page;
        renderTable();
        updatePagination();
    }

    function updatePagination() {
        const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
        pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPage.disabled = currentPage === 1;
        nextPage.disabled = currentPage === totalPages || totalPages === 0;
    }

    function refreshData() {
        fetchTransportUnits();
        fetchMaintenanceRecords();
        fetchStatistics();
        fetchAlerts();
        showToast("Data refreshed", "success");
    }

    function toggleAnalytics() {
        const isHidden = analyticsSection.style.display === "none";
        analyticsSection.style.display = isHidden ? "block" : "none";
        toggleAnalyticsBtn.innerHTML = isHidden ? 
            '<i class="fas fa-chart-line"></i> Hide' : 
            '<i class="fas fa-chart-line"></i> Show Analytics';
    }

    function toggleAlerts() {
        alertsSection.style.display = alertsSection.style.display === "none" ? "block" : "none";
    }

    async function exportData() {
        try {
            const data = filteredRecords.map(record => {
                return {
                    Date: formatDate(record.date),
                    "Transport Unit": record.transportUnit?.name || "",
                    "Plate Number": record.transportUnit?.plateNumber || "",
                    "Service Type": formatServiceType(record.serviceType),
                    Description: record.description,
                    Cost: record.cost,
                    Status: formatStatus(record.status),
                    Mechanic: record.mechanic,
                    "Next Due Date": record.nextDueDate ? formatDate(record.nextDueDate) : "",
                    Notes: record.notes
                };
            });
            
            const csv = convertToCSV(data);
            const blob = new Blob([csv], { type: "text/csv" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `maintenance_records_${new Date().toISOString().split("T")[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            
            showToast("Data exported successfully", "success");
        } catch (err) {
            console.error("Error exporting data:", err);
            showToast("Failed to export data", "error");
        }
    }

    function convertToCSV(data) {
        if (data.length === 0) return "";
        
        const headers = Object.keys(data[0]);
        const rows = data.map(row => 
            headers.map(header => {
                const value = row[header] || "";
                if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(",")
        );
        
        return [headers.join(","), ...rows].join("\n");
    }

    function showToast(message, icon = "success") {
        Swal.fire({
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            icon,
            title: message
        });
    }

    // Initialize
    init();
});