// General Ledger - Deductions JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    loadEmployees();
    loadDeductions();
    loadPeriods();
    loadCharts();
    setupEventListeners();
    updateSummaryCards();
});

// Global variables
let currentPage = 1;
let totalPages = 1;
let deductions = [];
let employees = [];
let periods = [];
let charts = {};
let currentDeductionId = null;

// Setup event listeners
function setupEventListeners() {
    // Toggle sidebar
    const toggleBtn = document.getElementById('btnToggleSidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }

    // Filter events
    document.getElementById('searchInput')?.addEventListener('input', debounce(loadDeductions, 500));
    document.getElementById('typeFilter')?.addEventListener('change', loadDeductions);
    document.getElementById('employeeFilter')?.addEventListener('change', loadDeductions);
    document.getElementById('periodFilter')?.addEventListener('change', loadDeductions);
    document.getElementById('dateRangeFilter')?.addEventListener('change', handleDateRangeChange);
    document.getElementById('applyDateFilter')?.addEventListener('click', loadDeductions);
    document.getElementById('refreshDataBtn')?.addEventListener('click', refreshData);

    // Action buttons
    document.getElementById('addDeductionBtn')?.addEventListener('click', openAddDeductionModal);
    document.getElementById('bulkDeductionBtn')?.addEventListener('click', openBulkDeductionModal);
    document.getElementById('exportDeductionsBtn')?.addEventListener('click', exportReport);
    document.getElementById('calculateDeductionsBtn')?.addEventListener('click', calculateAllDeductions);
    document.getElementById('toggleAnalyticsBtn')?.addEventListener('click', toggleAnalytics);

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));

    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Forms
    document.getElementById('addDeductionForm')?.addEventListener('submit', saveDeduction);
    document.getElementById('bulkDeductionForm')?.addEventListener('submit', saveBulkDeductions);

    // Details buttons
    document.getElementById('editDeductionBtn')?.addEventListener('click', editDeduction);
    document.getElementById('deleteDeductionBtn')?.addEventListener('click', deleteDeduction);
}

// Toggle sidebar
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    document.querySelector('.content').classList.toggle('expanded');
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Handle date range change
function handleDateRangeChange() {
    const range = document.getElementById('dateRangeFilter').value;
    const customRange = document.getElementById('customDateRange');
    
    if (range === 'custom') {
        customRange.style.display = 'flex';
    } else {
        customRange.style.display = 'none';
        loadDeductions();
    }
}

// Load employees
function loadEmployees() {
    fetch('/api/deductions/employees')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                employees = data.data;
                populateEmployeeFilters();
                populateEmployeeChecklist();
            }
        })
        .catch(error => console.error('Error loading employees:', error));
}

// Populate employee filters
function populateEmployeeFilters() {
    const employeeFilter = document.getElementById('employeeFilter');
    const deductionEmployee = document.getElementById('deductionEmployeeId');
    
    if (employeeFilter) {
        employeeFilter.innerHTML = '<option value="all">All Employees</option>';
        employees.forEach(emp => {
            const typeLabel = emp.type === 'driver' ? '🚛 Driver' : '👤 Admin';
            employeeFilter.innerHTML += `<option value="${emp.id}">${emp.name} (${typeLabel})</option>`;
        });
    }
    
    if (deductionEmployee) {
        deductionEmployee.innerHTML = '<option value="">— Select Employee —</option>';
        employees.forEach(emp => {
            const typeLabel = emp.type === 'driver' ? 'Driver' : emp.type === 'admin' ? 'Admin' : 'Staff';
            const position = emp.type === 'driver' ? 'Driver' : emp.position;
            const salary = emp.baseSalary ? `₱${emp.baseSalary.toLocaleString()}` : 'Variable';
            deductionEmployee.innerHTML += `<option value="${emp.id}">${emp.name} - ${position} (${typeLabel}) - ${salary}</option>`;
        });
    }
}

// Populate employee checklist for bulk modal
function populateEmployeeChecklist() {
    const checklist = document.getElementById('employeeChecklist');
    if (!checklist) return;
    
    checklist.innerHTML = '';
    employees.forEach(emp => {
        const typeLabel = emp.type === 'driver' ? '🚛 Driver' : '👤 Admin';
        const salary = emp.baseSalary ? `₱${emp.baseSalary.toLocaleString()}` : 'Variable';
        const item = document.createElement('div');
        item.className = 'checklist-item';
        item.innerHTML = `
            <input type="checkbox" id="emp_${emp.id}" value="${emp.id}">
            <div class="checklist-info">
                <div class="checklist-name">${emp.name}</div>
                <div class="checklist-details">${emp.position} - ${typeLabel} - ${salary}</div>
            </div>
        `;
        checklist.appendChild(item);
    });
}

// Load periods
function loadPeriods() {
    fetch('/api/deductions/periods')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                periods = data.data.cutoffs || [];
                populatePeriodFilters();
            }
        })
        .catch(error => console.error('Error loading periods:', error));
}

// Populate period filters
function populatePeriodFilters() {
    const periodFilter = document.getElementById('periodFilter');
    const deductionPeriod = document.getElementById('deductionPeriod');
    const bulkPeriod = document.getElementById('bulkPeriod');
    
    const options = '<option value="all">All Periods</option>' + 
                    periods.map(p => `<option value="${p}">${p}</option>`).join('');
    
    if (periodFilter) periodFilter.innerHTML = options;
    if (deductionPeriod) deductionPeriod.innerHTML = '<option value="">— Select Period —</option>' + options.replace('all">All Periods', '">— Select Period —');
    if (bulkPeriod) bulkPeriod.innerHTML = '<option value="">— Select Period —</option>' + options.replace('all">All Periods', '">— Select Period —');
}

// Load deductions
function loadDeductions() {
    showLoading();
    
    const params = new URLSearchParams({
        search: document.getElementById('searchInput')?.value || '',
        type: document.getElementById('typeFilter')?.value || 'all',
        employeeId: document.getElementById('employeeFilter')?.value || 'all',
        period: document.getElementById('periodFilter')?.value || 'all',
        dateRange: document.getElementById('dateRangeFilter')?.value || 'all',
        startDate: document.getElementById('startDate')?.value || '',
        endDate: document.getElementById('endDate')?.value || '',
        page: currentPage,
        limit: 10
    });
    
    fetch(`/api/deductions?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                deductions = data.data;
                totalPages = data.total_pages;
                renderDeductionsTable(deductions);
                updatePagination();
                updateRecordCount(data.total);
                updateCharts(deductions);
            }
        })
        .catch(error => console.error('Error loading deductions:', error))
        .finally(() => hideLoading());
}

// Render deductions table
function renderDeductionsTable(records) {
    const tbody = document.getElementById('deductionsTableBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No deduction records found</td></tr>';
        return;
    }
    
    let html = '';
    records.forEach(deduction => {
        const statusClass = deduction.status === 'applied' ? 'status-applied' :
                           deduction.status === 'pending' ? 'status-pending' : 'status-cancelled';
        
        html += `
            <tr>
                <td>
                    <div><strong>${deduction.employeeName}</strong></div>
                    <div style="font-size:12px; color:#7f8c8d;">ID: ${deduction.employeeId}</div>
                </td>
                <td>${deduction.department || 'N/A'}</td>
                <td>${deduction.type?.toUpperCase() || 'N/A'}</td>
                <td><strong>₱${deduction.amount?.toLocaleString() || 0}</strong></td>
                <td>${deduction.period || 'N/A'}</td>
                <td>${deduction.description || '—'}</td>
                <td>${deduction.date ? new Date(deduction.date).toLocaleDateString() : '—'}</td>
                <td><span class="status-badge ${statusClass}">${(deduction.status || 'pending').toUpperCase()}</span></td>
                <td>${deduction.linkedSalaryRecord || '—'}</td>
                <td>
                    <button class="action-btn action-view" onclick="viewDeduction('${deduction.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${deduction.status === 'pending' ? `
                        <button class="action-btn action-edit" onclick="editDeductionFromList('${deduction.id}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn action-delete" onclick="deleteDeductionFromList('${deduction.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Update pagination
function updatePagination() {
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
}

// Change page
function changePage(direction) {
    if (direction === 'prev' && currentPage > 1) {
        currentPage--;
        loadDeductions();
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        loadDeductions();
    }
}

// Update record count
function updateRecordCount(count) {
    document.getElementById('recordCount').textContent = `${count} record${count !== 1 ? 's' : ''}`;
}

// Update summary cards
function updateSummaryCards() {
    fetch('/api/deductions/summary')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const summary = data.data;
                document.getElementById('totalDeductions').textContent = `₱${summary.totalDeductions.toLocaleString()}`;
                document.getElementById('sssTotal').textContent = `₱${summary.sssTotal.toLocaleString()}`;
                document.getElementById('sssCount').textContent = `${summary.sssCount} employees`;
                document.getElementById('philhealthTotal').textContent = `₱${summary.philhealthTotal.toLocaleString()}`;
                document.getElementById('philhealthCount').textContent = `${summary.philhealthCount} employees`;
                document.getElementById('pagibigTotal').textContent = `₱${summary.pagibigTotal.toLocaleString()}`;
                document.getElementById('pagibigCount').textContent = `${summary.pagibigCount} employees`;
            }
        })
        .catch(error => console.error('Error loading summary:', error));
}

// Load charts
function loadCharts() {
    fetch('/api/deductions/analytics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const analytics = data.data;
                
                // Destroy existing charts
                if (charts.type) charts.type.destroy();
                if (charts.monthlyTrend) charts.monthlyTrend.destroy();
                if (charts.department) charts.department.destroy();
                
                // Type Distribution Chart
                const typeCtx = document.getElementById('typeChart')?.getContext('2d');
                if (typeCtx && analytics.typeDistribution) {
                    charts.type = new Chart(typeCtx, {
                        type: 'pie',
                        data: {
                            labels: analytics.typeDistribution.labels.map(l => l.toUpperCase()),
                            datasets: [{
                                data: analytics.typeDistribution.data,
                                backgroundColor: [
                                    'rgba(54, 162, 235, 0.8)',
                                    'rgba(255, 99, 132, 0.8)',
                                    'rgba(255, 205, 86, 0.8)',
                                    'rgba(75, 192, 192, 0.8)',
                                    'rgba(153, 102, 255, 0.8)',
                                    'rgba(255, 159, 64, 0.8)'
                                ],
                                borderWidth: 0
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: true,
                            aspectRatio: 2,
                            plugins: {
                                legend: { position: 'bottom' }
                            }
                        }
                    });
                }
                
                // Monthly Trend Chart
                const trendCtx = document.getElementById('monthlyTrendChart')?.getContext('2d');
                if (trendCtx && analytics.monthlyTrend) {
                    charts.monthlyTrend = new Chart(trendCtx, {
                        type: 'line',
                        data: {
                            labels: analytics.monthlyTrend.labels || [],
                            datasets: [{
                                label: 'Monthly Deductions',
                                data: analytics.monthlyTrend.data || [],
                                borderColor: 'rgba(255, 99, 132, 1)',
                                backgroundColor: 'rgba(255, 99, 132, 0.1)',
                                tension: 0.4,
                                fill: true
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: true,
                            aspectRatio: 2,
                            plugins: {
                                legend: { display: false }
                            }
                        }
                    });
                }
                
                // Department Distribution Chart
                const deptCtx = document.getElementById('departmentChart')?.getContext('2d');
                if (deptCtx && analytics.departmentDistribution) {
                    charts.department = new Chart(deptCtx, {
                        type: 'bar',
                        data: {
                            labels: analytics.departmentDistribution.labels || [],
                            datasets: [{
                                label: 'Deductions by Department',
                                data: analytics.departmentDistribution.data || [],
                                backgroundColor: 'rgba(153, 102, 255, 0.5)',
                                borderColor: 'rgba(153, 102, 255, 1)',
                                borderWidth: 1
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: true,
                            aspectRatio: 2,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: function(value) {
                                            return '₱' + value.toLocaleString();
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
                
                // Top Deductions List
                if (analytics.topDeductions) {
                    const container = document.getElementById('topDeductionsList');
                    let html = '';
                    analytics.topDeductions.forEach((ded, index) => {
                        html += `
                            <div class="deduction-item">
                                <div class="deduction-info">
                                    <div class="deduction-name">${index + 1}. ${ded.name}</div>
                                    <div class="deduction-type">${ded.type.toUpperCase()}</div>
                                </div>
                                <div class="deduction-amount">₱${ded.amount.toLocaleString()}</div>
                            </div>
                        `;
                    });
                    container.innerHTML = html;
                }
            }
        })
        .catch(error => console.error('Error loading charts:', error));
}

// Update charts with filtered data
function updateCharts(records) {
    if (!records || records.length === 0 || !charts.type) return;
    
    const typeCounts = { sss: 0, philhealth: 0, pagibig: 0, tax: 0, loan: 0, other: 0 };
    records.forEach(record => {
        const type = record.type || 'other';
        if (typeCounts.hasOwnProperty(type)) {
            typeCounts[type] += record.amount || 0;
        }
    });
    
    charts.type.data.datasets[0].data = Object.values(typeCounts);
    charts.type.update();
}

// Open add deduction modal
function openAddDeductionModal() {
    document.getElementById('addDeductionForm').reset();
    document.getElementById('deductionDate').valueAsDate = new Date();
    document.getElementById('addDeductionModal').style.display = 'block';
}

// Open bulk deduction modal
function openBulkDeductionModal() {
    document.getElementById('bulkDeductionForm').reset();
    document.getElementById('bulkDate').valueAsDate = new Date();
    
    // Check all employees by default
    document.querySelectorAll('#employeeChecklist input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
    });
    
    document.getElementById('bulkDeductionModal').style.display = 'block';
}

// Save deduction
function saveDeduction(e) {
    e.preventDefault();
    
    const formData = {
        employeeId: document.getElementById('deductionEmployeeId').value,
        type: document.getElementById('deductionType').value,
        amount: parseFloat(document.getElementById('deductionAmount').value),
        period: document.getElementById('deductionPeriod').value,
        date: document.getElementById('deductionDate').value,
        description: document.getElementById('deductionDescription').value,
        linkedTo: document.getElementById('deductionLinkedTo').value
    };
    
    Swal.fire({
        title: 'Adding Deduction...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Deduction Added!',
                text: 'The deduction has been added successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadDeductions();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to add deduction.'
            });
        }
    })
    .catch(error => {
        console.error('Error adding deduction:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// Save bulk deductions
function saveBulkDeductions(e) {
    e.preventDefault();
    
    const selectedEmployees = [];
    document.querySelectorAll('#employeeChecklist input[type="checkbox"]:checked').forEach(cb => {
        selectedEmployees.push(cb.value);
    });
    
    if (selectedEmployees.length === 0) {
        Swal.fire({
            icon: 'error',
            title: 'No Employees Selected',
            text: 'Please select at least one employee.'
        });
        return;
    }
    
    const formData = {
        type: document.getElementById('bulkType').value,
        period: document.getElementById('bulkPeriod').value,
        date: document.getElementById('bulkDate').value,
        employees: selectedEmployees,
        fixedAmount: parseFloat(document.getElementById('bulkAmount').value) || null
    };
    
    Swal.fire({
        title: 'Processing Bulk Deductions...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/deductions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Bulk Deductions Added!',
                text: data.message,
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadDeductions();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to add bulk deductions.'
            });
        }
    })
    .catch(error => {
        console.error('Error adding bulk deductions:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// View deduction
function viewDeduction(deductionId) {
    fetch(`/api/deductions/${deductionId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const deduction = data.data;
                const container = document.getElementById('detailsContainer');
                const modal = document.getElementById('detailsModal');
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Employee:</span>
                        <span class="detail-value">${deduction.employeeName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Department:</span>
                        <span class="detail-value">${deduction.department || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Type:</span>
                        <span class="detail-value">${deduction.type?.toUpperCase() || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Amount:</span>
                        <span class="detail-value">₱${deduction.amount?.toLocaleString() || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Period:</span>
                        <span class="detail-value">${deduction.period || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Date:</span>
                        <span class="detail-value">${deduction.date ? new Date(deduction.date).toLocaleDateString() : '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Description:</span>
                        <span class="detail-value">${deduction.description || '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge status-${deduction.status}">${(deduction.status || 'pending').toUpperCase()}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Linked Salary Record:</span>
                        <span class="detail-value">${deduction.linkedSalaryRecord || '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Created:</span>
                        <span class="detail-value">${deduction.createdAt ? new Date(deduction.createdAt).toLocaleString() : '—'}</span>
                    </div>
                `;
                
                currentDeductionId = deductionId;
                modal.style.display = 'block';
            }
        });
}

// Edit deduction from list
function editDeductionFromList(deductionId) {
    viewDeduction(deductionId);
    // The edit button in the details modal will handle the actual edit
}

// Edit deduction
function editDeduction() {
    if (!currentDeductionId) return;
    
    fetch(`/api/deductions/${currentDeductionId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const deduction = data.data;
                
                // Only allow editing if still pending
                if (deduction.status !== 'pending') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Cannot Edit',
                        text: 'Only pending deductions can be edited.'
                    });
                    return;
                }
                
                // Populate add modal with data
                document.getElementById('deductionEmployeeId').value = deduction.employeeId || '';
                document.getElementById('deductionType').value = deduction.type || '';
                document.getElementById('deductionAmount').value = deduction.amount || 0;
                document.getElementById('deductionPeriod').value = deduction.period || '';
                document.getElementById('deductionDate').value = deduction.date ? deduction.date.split('T')[0] : '';
                document.getElementById('deductionDescription').value = deduction.description || '';
                document.getElementById('deductionLinkedTo').value = deduction.linkedTo || '';
                
                // Change modal title
                document.querySelector('#addDeductionModal h2').textContent = 'Edit Deduction';
                
                // Store ID for update
                document.getElementById('addDeductionForm').dataset.editId = currentDeductionId;
                
                // Change form submit handler temporarily
                const form = document.getElementById('addDeductionForm');
                form.removeEventListener('submit', saveDeduction);
                form.addEventListener('submit', updateDeduction);
                
                closeAllModals();
                document.getElementById('addDeductionModal').style.display = 'block';
            }
        });
}

// Update deduction
function updateDeduction(e) {
    e.preventDefault();
    
    const deductionId = document.getElementById('addDeductionForm').dataset.editId;
    const formData = {
        employeeId: document.getElementById('deductionEmployeeId').value,
        type: document.getElementById('deductionType').value,
        amount: parseFloat(document.getElementById('deductionAmount').value),
        period: document.getElementById('deductionPeriod').value,
        date: document.getElementById('deductionDate').value,
        description: document.getElementById('deductionDescription').value,
        linkedTo: document.getElementById('deductionLinkedTo').value
    };
    
    Swal.fire({
        title: 'Updating Deduction...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/deductions/${deductionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Deduction Updated!',
                text: 'The deduction has been updated successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            
            // Reset form
            document.getElementById('addDeductionForm').removeEventListener('submit', updateDeduction);
            document.getElementById('addDeductionForm').addEventListener('submit', saveDeduction);
            document.querySelector('#addDeductionModal h2').textContent = 'Add Deduction';
            delete document.getElementById('addDeductionForm').dataset.editId;
            
            closeAllModals();
            loadDeductions();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to update deduction.'
            });
        }
    })
    .catch(error => {
        console.error('Error updating deduction:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// Delete deduction from list
function deleteDeductionFromList(deductionId) {
    currentDeductionId = deductionId;
    deleteDeduction();
}

// Delete deduction
function deleteDeduction() {
    if (!currentDeductionId) return;
    
    Swal.fire({
        title: 'Are you sure?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        cancelButtonColor: '#95a5a6',
        confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/deductions/${currentDeductionId}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    Swal.fire(
                        'Deleted!',
                        'The deduction has been deleted.',
                        'success'
                    );
                    closeAllModals();
                    loadDeductions();
                    updateSummaryCards();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: data.error || 'Failed to delete deduction.'
                    });
                }
            })
            .catch(error => {
                console.error('Error deleting deduction:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Connection Error',
                    text: 'Failed to connect to server.'
                });
            });
        }
    });
}

// Calculate all deductions
function calculateAllDeductions() {
    Swal.fire({
        title: 'Calculate Deductions',
        text: 'This will calculate standard deductions for all active employees. Continue?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, calculate',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                title: 'Calculating...',
                text: 'Please wait',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            // Call backend to calculate all deductions
            fetch('/api/deductions/calculate-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Calculations Complete!',
                        text: data.message,
                        timer: 2000,
                        showConfirmButton: false
                    });
                    loadDeductions();
                    updateSummaryCards();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: data.error || 'Failed to calculate deductions.'
                    });
                }
            })
            .catch(error => {
                console.error('Error calculating deductions:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Connection Error',
                    text: 'Failed to connect to server.'
                });
            });
        }
    });
}

// Export report
function exportReport() {
    Swal.fire({
        title: 'Export Report',
        text: 'Select export format:',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'PDF',
        cancelButtonText: 'Excel',
        showDenyButton: true,
        denyButtonText: 'CSV'
    }).then((result) => {
        let format = 'PDF';
        if (result.isDenied) format = 'CSV';
        else if (!result.isConfirmed) format = 'Excel';
        
        Swal.fire({
            title: 'Exporting...',
            text: `Generating ${format} report`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        
        setTimeout(() => {
            Swal.fire({
                icon: 'success',
                title: 'Export Complete!',
                text: `Your ${format} report has been generated.`,
                timer: 1500,
                showConfirmButton: false
            });
        }, 2000);
    });
}

// Toggle analytics
function toggleAnalytics() {
    const section = document.getElementById('analyticsSection');
    const btn = document.getElementById('toggleAnalyticsBtn');
    const isHidden = section.style.display === 'none';
    
    section.style.display = isHidden ? 'block' : 'none';
    btn.innerHTML = isHidden ? 
        '<i class="fas fa-chart-line"></i> Hide' : 
        '<i class="fas fa-chart-line"></i> Show';
}

// Refresh data
function refreshData() {
    Swal.fire({
        title: 'Refreshing Data...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    setTimeout(() => {
        loadDeductions();
        updateSummaryCards();
        Swal.close();
    }, 500);
}

// Show/hide loading
function showLoading() {}
function hideLoading() {}

// Close all modals
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
    
    // Reset add form to default state
    const addForm = document.getElementById('addDeductionForm');
    if (addForm) {
        addForm.removeEventListener('submit', updateDeduction);
        addForm.addEventListener('submit', saveDeduction);
        document.querySelector('#addDeductionModal h2').textContent = 'Add Deduction';
        delete addForm.dataset.editId;
    }
}

// Click outside modal to close
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};