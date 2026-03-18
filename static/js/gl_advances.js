// General Ledger - Advances JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    loadEmployees();
    loadAdvances();
    loadCharts();
    setupEventListeners();
    updateSummaryCards();
});

// Global variables
let currentPage = 1;
let totalPages = 1;
let advances = [];
let employees = [];
let charts = {};
let currentAdvanceId = null;

// Setup event listeners
function setupEventListeners() {
    // Toggle sidebar
    const toggleBtn = document.getElementById('btnToggleSidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }

    // Filter events
    document.getElementById('searchInput')?.addEventListener('input', debounce(loadAdvances, 500));
    document.getElementById('statusFilter')?.addEventListener('change', loadAdvances);
    document.getElementById('employeeFilter')?.addEventListener('change', loadAdvances);
    document.getElementById('repaymentPeriodFilter')?.addEventListener('change', loadAdvances);
    document.getElementById('dateRangeFilter')?.addEventListener('change', handleDateRangeChange);
    document.getElementById('applyDateFilter')?.addEventListener('click', loadAdvances);
    document.getElementById('refreshDataBtn')?.addEventListener('click', refreshData);

    // Action buttons
    document.getElementById('requestAdvanceBtn')?.addEventListener('click', openRequestModal);
    document.getElementById('approveAdvanceBtn')?.addEventListener('click', openApproveListModal);
    document.getElementById('exportAdvancesBtn')?.addEventListener('click', exportReport);
    document.getElementById('toggleAnalyticsBtn')?.addEventListener('click', toggleAnalytics);

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));

    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Forms
    document.getElementById('requestAdvanceForm')?.addEventListener('submit', requestAdvance);
    document.getElementById('approveForm')?.addEventListener('submit', approveAdvance);
    document.getElementById('paymentForm')?.addEventListener('submit', recordPayment);

    // Repayment period change
    document.getElementById('advanceRepaymentPeriod')?.addEventListener('change', handleRepaymentPeriodChange);
    
    // Status change in approve modal
    document.getElementById('approveStatus')?.addEventListener('change', handleApproveStatusChange);

    // Details buttons
    document.getElementById('approveFromDetailsBtn')?.addEventListener('click', approveFromDetails);
    document.getElementById('recordPaymentBtn')?.addEventListener('click', recordPaymentFromDetails);
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
        loadAdvances();
    }
}

// Handle repayment period change
function handleRepaymentPeriodChange() {
    const period = document.getElementById('advanceRepaymentPeriod').value;
    const customFields = document.getElementById('customRepaymentFields');
    
    if (period === 'Custom') {
        customFields.style.display = 'block';
    } else {
        customFields.style.display = 'none';
    }
}

// Handle approve status change
function handleApproveStatusChange() {
    const status = document.getElementById('approveStatus').value;
    const approvalDetails = document.getElementById('approvalDetails');
    
    if (status === 'approved') {
        approvalDetails.style.display = 'block';
        document.getElementById('approveDate').valueAsDate = new Date();
    } else {
        approvalDetails.style.display = 'none';
    }
}

// Load employees
function loadEmployees() {
    fetch('/api/advances/employees')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                employees = data.data;
                populateEmployeeFilters();
            }
        })
        .catch(error => console.error('Error loading employees:', error));
}

// Populate employee filters
function populateEmployeeFilters() {
    const employeeFilter = document.getElementById('employeeFilter');
    const advanceEmployee = document.getElementById('advanceEmployeeId');
    
    if (employeeFilter) {
        employeeFilter.innerHTML = '<option value="all">All Employees</option>';
        employees.forEach(emp => {
            const typeLabel = emp.type === 'driver' ? '🚛 Driver' : '👤 Admin';
            employeeFilter.innerHTML += `<option value="${emp.id}">${emp.name} (${typeLabel})</option>`;
        });
    }
    
    if (advanceEmployee) {
        advanceEmployee.innerHTML = '<option value="">— Select Employee —</option>';
        employees.forEach(emp => {
            const typeLabel = emp.type === 'driver' ? 'Driver' : 'Admin';
            const position = emp.type === 'driver' ? 'Driver' : emp.position;
            advanceEmployee.innerHTML += `<option value="${emp.id}">${emp.name} - ${position} (${typeLabel})</option>`;
        });
    }
}

// Load advances
function loadAdvances() {
    showLoading();
    
    const params = new URLSearchParams({
        search: document.getElementById('searchInput')?.value || '',
        status: document.getElementById('statusFilter')?.value || 'all',
        employeeId: document.getElementById('employeeFilter')?.value || 'all',
        repaymentPeriod: document.getElementById('repaymentPeriodFilter')?.value || 'all',
        dateRange: document.getElementById('dateRangeFilter')?.value || 'all',
        startDate: document.getElementById('startDate')?.value || '',
        endDate: document.getElementById('endDate')?.value || '',
        page: currentPage,
        limit: 10
    });
    
    fetch(`/api/advances?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                advances = data.data;
                totalPages = data.total_pages;
                renderAdvancesTable(advances);
                updatePagination();
                updateRecordCount(data.total);
                updateCharts(advances);
            }
        })
        .catch(error => console.error('Error loading advances:', error))
        .finally(() => hideLoading());
}

// Render advances table
function renderAdvancesTable(records) {
    const tbody = document.getElementById('advancesTableBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No advance requests found</td></tr>';
        return;
    }
    
    let html = '';
    records.forEach(advance => {
        const remaining = advance.amount - (advance.paidAmount || 0);
        const statusClass = advance.status === 'pending' ? 'status-pending' :
                           advance.status === 'approved' ? 'status-approved' :
                           advance.status === 'rejected' ? 'status-rejected' :
                           advance.status === 'paid' ? 'status-paid' : 'status-partially-paid';
        
        html += `
            <tr>
                <td>
                    <div><strong>${advance.employeeName}</strong></div>
                    <div style="font-size:12px; color:#7f8c8d;">ID: ${advance.employeeId}</div>
                </td>
                <td>${advance.department || 'N/A'}</td>
                <td><strong>₱${advance.amount.toLocaleString()}</strong></td>
                <td>${advance.dateRequested ? new Date(advance.dateRequested).toLocaleDateString() : '—'}</td>
                <td>${advance.reason || '—'}</td>
                <td>${advance.repaymentPeriod || '—'}</td>
                <td>₱${(advance.repaymentAmount || 0).toLocaleString()}</td>
                <td>₱${remaining.toLocaleString()}</td>
                <td><span class="status-badge ${statusClass}">${advance.status.toUpperCase()}</span></td>
                <td>${advance.dateApproved ? new Date(advance.dateApproved).toLocaleDateString() : 
                       advance.datePaid ? new Date(advance.datePaid).toLocaleDateString() : '—'}</td>
                <td>
                    <button class="action-btn action-view" onclick="viewAdvance('${advance.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${advance.status === 'pending' ? `
                        <button class="action-btn action-approve" onclick="openApproveModal('${advance.id}')" title="Approve/Reject">
                            <i class="fas fa-check-circle"></i>
                        </button>
                    ` : ''}
                    ${advance.status === 'approved' ? `
                        <button class="action-btn action-payment" onclick="openPaymentModal('${advance.id}')" title="Record Payment">
                            <i class="fas fa-money-bill"></i>
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
        loadAdvances();
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        loadAdvances();
    }
}

// Update record count
function updateRecordCount(count) {
    document.getElementById('recordCount').textContent = `${count} record${count !== 1 ? 's' : ''}`;
}

// Update summary cards
function updateSummaryCards() {
    fetch('/api/advances/summary')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const summary = data.data;
                document.getElementById('totalAdvances').textContent = `₱${summary.totalAdvances.toLocaleString()}`;
                document.getElementById('approvedAmount').textContent = `₱${summary.approvedAmount.toLocaleString()}`;
                document.getElementById('approvedCount').textContent = `${summary.approvedCount} advances`;
                document.getElementById('pendingAmount').textContent = `₱${summary.pendingAmount.toLocaleString()}`;
                document.getElementById('pendingCount').textContent = `${summary.pendingCount} advances`;
                document.getElementById('outstandingBalance').textContent = `₱${summary.outstandingBalance.toLocaleString()}`;
            }
        })
        .catch(error => console.error('Error loading summary:', error));
}

// Load charts
function loadCharts() {
    fetch('/api/advances/analytics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const analytics = data.data;
                
                // Destroy existing charts
                if (charts.status) charts.status.destroy();
                if (charts.monthlyTrend) charts.monthlyTrend.destroy();
                
                // Status Chart
                const statusCtx = document.getElementById('statusChart')?.getContext('2d');
                if (statusCtx && analytics.statusDistribution) {
                    charts.status = new Chart(statusCtx, {
                        type: 'doughnut',
                        data: {
                            labels: analytics.statusDistribution.labels || [],
                            datasets: [{
                                data: analytics.statusDistribution.data || [],
                                backgroundColor: [
                                    'rgba(255, 205, 86, 0.8)',  // pending
                                    'rgba(54, 162, 235, 0.8)',  // approved
                                    'rgba(255, 99, 132, 0.8)',  // rejected
                                    'rgba(75, 192, 192, 0.8)'   // paid
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
                                label: 'Monthly Advances',
                                data: analytics.monthlyTrend.data || [],
                                borderColor: 'rgba(255, 159, 64, 1)',
                                backgroundColor: 'rgba(255, 159, 64, 0.1)',
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
                
                // Top Employees List
                if (analytics.topEmployees) {
                    const container = document.getElementById('topEmployeesList');
                    let html = '';
                    analytics.topEmployees.forEach((emp, index) => {
                        html += `
                            <div class="employee-item">
                                <div class="employee-info">
                                    <div class="employee-name">${index + 1}. ${emp.name}</div>
                                    <div class="employee-department">${emp.department || 'N/A'}</div>
                                </div>
                                <div class="employee-amount">₱${emp.total.toLocaleString()}</div>
                            </div>
                        `;
                    });
                    container.innerHTML = html;
                }
                
                // Repayment List
                if (analytics.upcomingRepayments) {
                    const container = document.getElementById('repaymentList');
                    let html = '';
                    analytics.upcomingRepayments.forEach(repayment => {
                        html += `
                            <div class="repayment-item">
                                <div class="repayment-info">
                                    <div class="repayment-employee">${repayment.employeeName}</div>
                                    <div class="repayment-details">Due: ${new Date(repayment.dueDate).toLocaleDateString()}</div>
                                </div>
                                <div class="repayment-amount">₱${repayment.amount.toLocaleString()}</div>
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
    if (!records || records.length === 0 || !charts.status) return;
    
    const statusCounts = { pending: 0, approved: 0, rejected: 0, paid: 0, 'partially-paid': 0 };
    records.forEach(record => {
        if (statusCounts.hasOwnProperty(record.status)) {
            statusCounts[record.status]++;
        }
    });
    
    charts.status.data.datasets[0].data = Object.values(statusCounts);
    charts.status.update();
}

// Open request modal
function openRequestModal() {
    document.getElementById('requestAdvanceForm').reset();
    document.getElementById('customRepaymentFields').style.display = 'none';
    document.getElementById('requestAdvanceModal').style.display = 'block';
}

// Request advance
function requestAdvance(e) {
    e.preventDefault();
    
    const formData = {
        employeeId: document.getElementById('advanceEmployeeId').value,
        amount: parseFloat(document.getElementById('advanceAmount').value),
        reason: document.getElementById('advanceReason').value,
        repaymentPeriod: document.getElementById('advanceRepaymentPeriod').value,
        repaymentAmount: parseFloat(document.getElementById('repaymentAmount').value) || null,
        notes: document.getElementById('advanceNotes').value
    };
    
    Swal.fire({
        title: 'Submitting Request...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Request Submitted!',
                text: 'Your advance request has been submitted for approval.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadAdvances();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to submit request.'
            });
        }
    })
    .catch(error => {
        console.error('Error submitting request:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// View advance
function viewAdvance(advanceId) {
    fetch(`/api/advances/${advanceId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const advance = data.data;
                const container = document.getElementById('detailsContainer');
                const scheduleDiv = document.getElementById('paymentSchedule');
                const modal = document.getElementById('detailsModal');
                
                const remaining = advance.amount - (advance.paidAmount || 0);
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Employee:</span>
                        <span class="detail-value">${advance.employeeName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Department:</span>
                        <span class="detail-value">${advance.department || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Amount:</span>
                        <span class="detail-value">₱${advance.amount.toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Date Requested:</span>
                        <span class="detail-value">${new Date(advance.dateRequested).toLocaleDateString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Reason:</span>
                        <span class="detail-value">${advance.reason || '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Repayment Period:</span>
                        <span class="detail-value">${advance.repaymentPeriod || '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Repayment Amount:</span>
                        <span class="detail-value">₱${(advance.repaymentAmount || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Paid Amount:</span>
                        <span class="detail-value">₱${(advance.paidAmount || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Remaining Balance:</span>
                        <span class="detail-value">₱${remaining.toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge status-${advance.status}">${advance.status.toUpperCase()}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Date Approved:</span>
                        <span class="detail-value">${advance.dateApproved ? new Date(advance.dateApproved).toLocaleDateString() : '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Date Paid:</span>
                        <span class="detail-value">${advance.datePaid ? new Date(advance.datePaid).toLocaleDateString() : '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Notes:</span>
                        <span class="detail-value">${advance.notes || '—'}</span>
                    </div>
                `;
                
                // Show payment schedule if available
                if (advance.paymentSchedule && advance.paymentSchedule.length > 0) {
                    let scheduleHtml = '';
                    advance.paymentSchedule.forEach(payment => {
                        scheduleHtml += `
                            <tr>
                                <td>${new Date(payment.dueDate).toLocaleDateString()}</td>
                                <td>₱${payment.amount.toLocaleString()}</td>
                                <td><span class="status-badge status-${payment.status}">${payment.status.toUpperCase()}</span></td>
                                <td>${payment.paidDate ? new Date(payment.paidDate).toLocaleDateString() : '—'}</td>
                            </tr>
                        `;
                    });
                    document.getElementById('scheduleBody').innerHTML = scheduleHtml;
                    scheduleDiv.style.display = 'block';
                } else {
                    scheduleDiv.style.display = 'none';
                }
                
                currentAdvanceId = advanceId;
                document.getElementById('approveFromDetailsBtn').style.display = 
                    advance.status === 'pending' ? 'inline-flex' : 'none';
                document.getElementById('recordPaymentBtn').style.display = 
                    advance.status === 'approved' ? 'inline-flex' : 'none';
                
                modal.style.display = 'block';
            }
        });
}

// Open approve modal
function openApproveModal(advanceId) {
    fetch(`/api/advances/${advanceId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const advance = data.data;
                
                document.getElementById('approveAdvanceId').value = advanceId;
                document.getElementById('approveEmployeeName').textContent = advance.employeeName;
                document.getElementById('approveAmount').textContent = `₱${advance.amount.toLocaleString()}`;
                document.getElementById('approveStatus').value = 'approved';
                document.getElementById('approveDate').valueAsDate = new Date();
                document.getElementById('approvePaymentDate').valueAsDate = new Date();
                document.getElementById('approveNotes').value = '';
                
                handleApproveStatusChange();
                document.getElementById('approveModal').style.display = 'block';
            }
        });
}

// Open approve list modal
function openApproveListModal() {
    Swal.fire({
        title: 'Select Advance to Approve/Reject',
        html: '<div id="pendingAdvancesList" style="max-height: 300px; overflow-y: auto;"></div>',
        showCancelButton: true,
        confirmButtonText: 'Close',
        cancelButtonText: 'Cancel',
        didOpen: () => {
            const container = document.getElementById('pendingAdvancesList');
            fetch('/api/advances?status=pending&limit=100')
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.data.length > 0) {
                        let html = '<table class="simple-table"><tr><th>Employee</th><th>Amount</th><th>Date</th><th>Action</th></tr>';
                        data.data.forEach(adv => {
                            html += `
                                <tr>
                                    <td>${adv.employeeName}</td>
                                    <td>₱${adv.amount.toLocaleString()}</td>
                                    <td>${new Date(adv.dateRequested).toLocaleDateString()}</td>
                                    <td><button class="btn btn-sm btn-primary" onclick="openApproveModal('${adv.id}'); Swal.close();">Select</button></td>
                                </tr>
                            `;
                        });
                        html += '</table>';
                        container.innerHTML = html;
                    } else {
                        container.innerHTML = '<p class="text-center">No pending advances found.</p>';
                    }
                });
        }
    });
}

// Approve/reject advance
function approveAdvance(e) {
    e.preventDefault();
    
    const advanceId = document.getElementById('approveAdvanceId').value;
    const formData = {
        status: document.getElementById('approveStatus').value,
        approvalDate: document.getElementById('approveDate').value,
        paymentDate: document.getElementById('approvePaymentDate').value,
        notes: document.getElementById('approveNotes').value
    };
    
    Swal.fire({
        title: 'Processing...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/advances/${advanceId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: formData.status === 'approved' ? 'Advance Approved!' : 'Advance Rejected',
                text: `The advance request has been ${formData.status}.`,
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadAdvances();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to process request.'
            });
        }
    });
}

// Open payment modal
function openPaymentModal(advanceId) {
    fetch(`/api/advances/${advanceId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const advance = data.data;
                const remaining = advance.amount - (advance.paidAmount || 0);
                
                document.getElementById('paymentAdvanceId').value = advanceId;
                document.getElementById('paymentAmount').max = remaining;
                document.getElementById('paymentAmount').value = remaining;
                document.getElementById('paymentDate').valueAsDate = new Date();
                document.getElementById('paymentMethod').value = '';
                document.getElementById('paymentReference').value = '';
                
                document.getElementById('paymentModal').style.display = 'block';
            }
        });
}

// Record payment
function recordPayment(e) {
    e.preventDefault();
    
    const formData = {
        amount: parseFloat(document.getElementById('paymentAmount').value),
        paymentDate: document.getElementById('paymentDate').value,
        paymentMethod: document.getElementById('paymentMethod').value,
        reference: document.getElementById('paymentReference').value
    };
    
    const advanceId = document.getElementById('paymentAdvanceId').value;
    
    Swal.fire({
        title: 'Recording Payment...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/advances/${advanceId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Payment Recorded!',
                text: 'The payment has been recorded successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadAdvances();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to record payment.'
            });
        }
    });
}

// Approve from details
function approveFromDetails() {
    if (currentAdvanceId) {
        closeAllModals();
        openApproveModal(currentAdvanceId);
    }
}

// Record payment from details
function recordPaymentFromDetails() {
    if (currentAdvanceId) {
        closeAllModals();
        openPaymentModal(currentAdvanceId);
    }
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
        loadAdvances();
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
}

// Click outside modal to close
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};