// General Ledger - Admin Salary JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    loadEmployees();
    loadSalaryRecords();
    loadCharts();
    setupEventListeners();
    updateSummaryCards();
});

// Global variables
let currentPage = 1;
let totalPages = 1;
let salaryRecords = [];
let employees = [];
let charts = {};
let currentAdminId = null;

// Setup event listeners
function setupEventListeners() {
    // Toggle sidebar
    const toggleBtn = document.getElementById('btnToggleSidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }

    // Filter events
    document.getElementById('searchInput')?.addEventListener('input', debounce(loadSalaryRecords, 500));
    document.getElementById('statusFilter')?.addEventListener('change', loadSalaryRecords);
    document.getElementById('departmentFilter')?.addEventListener('change', loadSalaryRecords);
    document.getElementById('payPeriodFilter')?.addEventListener('change', loadSalaryRecords);
    document.getElementById('dateRangeFilter')?.addEventListener('change', handleDateRangeChange);
    document.getElementById('applyDateFilter')?.addEventListener('click', loadSalaryRecords);
    document.getElementById('refreshDataBtn')?.addEventListener('click', refreshData);

    // Action buttons
    document.getElementById('processPayrollBtn')?.addEventListener('click', openPayrollModal);
    document.getElementById('addSalaryBtn')?.addEventListener('click', () => openSalaryModal());
    document.getElementById('exportSalaryBtn')?.addEventListener('click', exportReport);
    document.getElementById('generatePayslipBtn')?.addEventListener('click', generateBulkPayslips);
    document.getElementById('toggleAnalyticsBtn')?.addEventListener('click', toggleAnalytics);
    document.getElementById('addAdminBtn')?.addEventListener('click', openAddAdminModal);

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));

    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    document.getElementById('employeeId')?.addEventListener('change', function() {
        // Only fetch if modal is open and period is selected
        const modal = document.getElementById('salaryModal');
        if (modal.style.display === 'block') {
            fetchPendingForSalary();
        }
    });

    document.getElementById('payPeriod')?.addEventListener('change', function() {
        // Only fetch if modal is open and employee is selected
        const modal = document.getElementById('salaryModal');
        if (modal.style.display === 'block') {
            fetchPendingForSalary();
        }
    });

    const originalOpenSalaryModal = openSalaryModal;
    openSalaryModal = function(recordId = null) {
        originalOpenSalaryModal(recordId);
        if (!recordId) {
            // Small delay to ensure DOM is updated
            setTimeout(() => {
                fetchPendingForSalary();
            }, 100);
        }
    };

    // Forms
    document.getElementById('salaryForm')?.addEventListener('submit', saveSalaryRecord);
    document.getElementById('payrollForm')?.addEventListener('submit', processPayroll);
    document.getElementById('addAdminForm')?.addEventListener('submit', saveAdmin);
    document.getElementById('addDeductionForm')?.addEventListener('submit', saveDeduction);
    document.getElementById('addAdvanceForm')?.addEventListener('submit', saveAdvance);
    document.getElementById('editAdminForm')?.addEventListener('submit', updateAdmin);
    
    // Calculate net pay on input change
    ['baseSalary', 'allowances', 'overtimePay', 'bonus', 'taxDeduction', 
     'sssDeduction', 'philhealthDeduction', 'pagibigDeduction', 'loanDeduction', 
     'otherDeductions', 'advanceDeduction'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateTotals);
    });

    // Rate type change
    document.getElementById('rateType')?.addEventListener('change', handleRateTypeChange);
    document.getElementById('editRateType')?.addEventListener('change', handleEditRateTypeChange);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
        });
    });

    // Details buttons
    document.getElementById('editFromDetailsBtn')?.addEventListener('click', editFromDetails);
    document.getElementById('generatePayslipDetailsBtn')?.addEventListener('click', generatePayslipFromDetails);
    document.getElementById('processSalaryFromDetailsBtn')?.addEventListener('click', processSalaryFromDetails);
    document.getElementById('addDeductionFromDetailsBtn')?.addEventListener('click', addDeductionFromDetails);
    document.getElementById('addAdvanceFromDetailsBtn')?.addEventListener('click', addAdvanceFromDetails);
    document.getElementById('downloadPayslipBtn')?.addEventListener('click', downloadPayslip);
    document.getElementById('emailPayslipBtn')?.addEventListener('click', emailPayslip);
    
    // Admin edit button
    document.getElementById('editAdminInfoBtn')?.addEventListener('click', openEditAdminModal);
}

// Toggle sidebar
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    document.querySelector('.content').classList.toggle('expanded');
}

// Fetch pending deductions and advances for an employee
function fetchPendingDeductionsAndAdvances(employeeId, period) {
    return Promise.all([
        fetch(`/api/admin-salary/pending-deductions/${employeeId}?period=${encodeURIComponent(period)}`).then(res => res.json()),
        fetch(`/api/admin-salary/pending-advances/${employeeId}?period=${encodeURIComponent(period)}`).then(res => res.json())
    ]);
}

function fetchPendingForSalary() {
    const employeeId = document.getElementById('employeeId').value;
    const period = document.getElementById('payPeriod').value;
    
    if (!employeeId || !period) {
        return; // Don't fetch if either is missing
    }
    
    // Show loading
    Swal.fire({
        title: 'Loading pending deductions and advances...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
    
    // Fetch pending deductions and advances
    fetchPendingDeductionsAndAdvances(employeeId, period)
        .then(([deductionsData, advancesData]) => {
            Swal.close();
            
            if (deductionsData.success) {
                const deductions = deductionsData.data;
                // Auto-fill deduction fields
                document.getElementById('taxDeduction').value = deductions.tax || 0;
                document.getElementById('sssDeduction').value = deductions.sss || 0;
                document.getElementById('philhealthDeduction').value = deductions.philhealth || 0;
                document.getElementById('pagibigDeduction').value = deductions.pagibig || 0;
                document.getElementById('loanDeduction').value = deductions.loan || 0;
                document.getElementById('otherDeductions').value = deductions.other || 0;
            }
            
            if (advancesData.success) {
                // Auto-fill advance deduction
                document.getElementById('advanceDeduction').value = advancesData.data.totalAdvance || 0;
            }
            
            // Recalculate totals
            calculateTotals();
            
            // Show summary if there are any pending items
            let message = '';
            if (deductionsData.success && deductionsData.data.total > 0) {
                message += `Total pending deductions: ₱${deductionsData.data.total.toLocaleString()}\n`;
            }
            if (advancesData.success && advancesData.data.totalAdvance > 0) {
                message += `Total advance repayment: ₱${advancesData.data.totalAdvance.toLocaleString()}`;
            }
            
            if (message) {
                Swal.fire({
                    icon: 'info',
                    title: 'Pending Deductions & Advances',
                    text: message,
                    timer: 3000,
                    showConfirmButton: true
                });
            }
        })
        .catch(error => {
            Swal.close();
            console.error('Error fetching pending data:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load pending deductions and advances.'
            });
        });
}

// Debounce function for search input
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
        loadSalaryRecords();
    }
}

// Handle rate type change
function handleRateTypeChange() {
    const rateType = document.getElementById('rateType').value;
    
    document.getElementById('dailyRateFields').style.display = 'none';
    document.getElementById('cutoffRateFields').style.display = 'none';
    document.getElementById('monthlyRateFields').style.display = 'none';
    
    if (rateType === 'daily') {
        document.getElementById('dailyRateFields').style.display = 'block';
        document.getElementById('dailyRate').required = true;
        document.getElementById('cutoffRate').required = false;
        document.getElementById('monthlyRate').required = false;
    } else if (rateType === 'cutoff') {
        document.getElementById('cutoffRateFields').style.display = 'block';
        document.getElementById('dailyRate').required = false;
        document.getElementById('cutoffRate').required = true;
        document.getElementById('monthlyRate').required = false;
    } else if (rateType === 'monthly') {
        document.getElementById('monthlyRateFields').style.display = 'block';
        document.getElementById('dailyRate').required = false;
        document.getElementById('cutoffRate').required = false;
        document.getElementById('monthlyRate').required = true;
    }
}

// Handle edit rate type change
function handleEditRateTypeChange() {
    const rateType = document.getElementById('editRateType').value;
    
    document.getElementById('editDailyRateFields').style.display = 'none';
    document.getElementById('editCutoffRateFields').style.display = 'none';
    document.getElementById('editMonthlyRateFields').style.display = 'none';
    
    if (rateType === 'daily') {
        document.getElementById('editDailyRateFields').style.display = 'block';
        document.getElementById('editDailyRate').required = true;
        document.getElementById('editCutoffRate').required = false;
        document.getElementById('editMonthlyRate').required = false;
    } else if (rateType === 'cutoff') {
        document.getElementById('editCutoffRateFields').style.display = 'block';
        document.getElementById('editDailyRate').required = false;
        document.getElementById('editCutoffRate').required = true;
        document.getElementById('editMonthlyRate').required = false;
    } else if (rateType === 'monthly') {
        document.getElementById('editMonthlyRateFields').style.display = 'block';
        document.getElementById('editDailyRate').required = false;
        document.getElementById('editCutoffRate').required = false;
        document.getElementById('editMonthlyRate').required = true;
    }
}

// Switch tabs in admin details modal
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`${tab}Tab`).classList.add('active');
}

// Load employees from API
function loadEmployees() {
    showLoading();
    
    fetch('/api/admin-salary/employees')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                employees = data.data;
                populateEmployeeSelects();
            } else {
                console.error('Failed to load employees:', data.error);
            }
        })
        .catch(error => {
            console.error('Error loading employees:', error);
        })
        .finally(() => {
            hideLoading();
        });
}

// Populate employee selects
function populateEmployeeSelects() {
    const employeeSelect = document.getElementById('employeeId');
    const employeeList = document.getElementById('employeeList');
    
    if (employeeSelect) {
        employeeSelect.innerHTML = '<option value="">— Select Employee —</option>';
        employees.forEach(emp => {
            employeeSelect.innerHTML += `<option value="${emp.id}">${emp.name} - ${emp.position}</option>`;
        });
    }
    
    if (employeeList) {
        employeeList.innerHTML = '';
        employees.forEach(emp => {
            if (emp.status === 'active') {
                employeeList.innerHTML += `
                    <div class="employee-item">
                        <input type="checkbox" id="emp_${emp.id}" value="${emp.id}" checked>
                        <div class="employee-info">
                            <span class="employee-name">${emp.name}</span>
                            <span class="employee-position">${emp.position}</span>
                        </div>
                        <span class="employee-salary">₱${emp.baseSalary.toLocaleString()}</span>
                    </div>
                `;
            }
        });
    }
}

// Load salary records
function loadSalaryRecords() {
    showLoading();
    
    // Build query parameters
    const params = new URLSearchParams({
        search: document.getElementById('searchInput')?.value || '',
        status: document.getElementById('statusFilter')?.value || 'all',
        department: document.getElementById('departmentFilter')?.value || 'all',
        payPeriod: document.getElementById('payPeriodFilter')?.value || 'all',
        dateRange: document.getElementById('dateRangeFilter')?.value || 'all',
        startDate: document.getElementById('startDate')?.value || '',
        endDate: document.getElementById('endDate')?.value || '',
        page: currentPage,
        limit: 10
    });
    
    fetch(`/api/admin-salary/records?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                salaryRecords = data.data;
                totalPages = data.total_pages;
                renderSalaryTable(salaryRecords);
                updatePagination();
                updateRecordCount(data.total);
                updateCharts(salaryRecords);
            } else {
                console.error('Failed to load records:', data.error);
            }
        })
        .catch(error => {
            console.error('Error loading records:', error);
        })
        .finally(() => {
            hideLoading();
        });
}

// Render salary table
function renderSalaryTable(records) {
    const tbody = document.getElementById('salaryTableBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">No salary records found</td></tr>';
        return;
    }
    
    let html = '';
    records.forEach(record => {
        const totalEarnings = (record.baseSalary || 0) + (record.allowances || 0) + 
                             (record.overtimePay || 0) + (record.bonus || 0);
        const totalDeductions = (record.taxDeduction || 0) + (record.sssDeduction || 0) + 
                               (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) +
                               (record.loanDeduction || 0) + (record.otherDeductions || 0) +
                               (record.advanceDeduction || 0);
        const netPay = totalEarnings - totalDeductions;
        
        html += `
            <tr>
                <td>
                    <div><strong>${record.employeeName}</strong></div>
                    <div style="font-size:12px; color:#7f8c8d;">ID: ${record.employeeId}</div>
                </td>
                <td>${record.position || 'N/A'}</td>
                <td>${record.department ? record.department.charAt(0).toUpperCase() + record.department.slice(1) : 'N/A'}</td>
                <td>${record.payPeriod || 'N/A'}</td>
                <td>₱${(record.baseSalary || 0).toLocaleString()}</td>
                <td>₱${totalEarnings.toLocaleString()}</td>
                <td>₱${(record.taxDeduction || 0) + (record.sssDeduction || 0) + (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) + (record.loanDeduction || 0) + (record.otherDeductions || 0)}</td>
                <td>₱${(record.advanceDeduction || 0).toLocaleString()}</td>
                <td><strong>₱${netPay.toLocaleString()}</strong></td>
                <td><span class="status-badge status-${record.paymentStatus || 'pending'}">${(record.paymentStatus || 'pending').toUpperCase()}</span></td>
                <td>${record.paymentDate ? new Date(record.paymentDate).toLocaleDateString() : '—'}</td>
                <td>
                    <button class="action-btn action-view" onclick="viewSalaryRecord('${record.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn action-edit" onclick="editSalaryRecord('${record.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn action-payslip" onclick="generatePayslip('${record.id}')" title="Generate Payslip">
                        <i class="fas fa-file-pdf"></i>
                    </button>
                    <button class="action-btn action-history" onclick="viewAdminDetails('${record.employeeId}')" title="Admin Details">
                        <i class="fas fa-user"></i>
                    </button>
                    <button class="action-btn action-delete" onclick="deleteSalaryRecord('${record.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
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
        loadSalaryRecords();
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        loadSalaryRecords();
    }
}

// Update record count
function updateRecordCount(count) {
    document.getElementById('recordCount').textContent = `${count} record${count !== 1 ? 's' : ''}`;
}

// Calculate totals
function calculateTotals() {
    const baseSalary = parseFloat(document.getElementById('baseSalary').value) || 0;
    const allowances = parseFloat(document.getElementById('allowances').value) || 0;
    const overtimePay = parseFloat(document.getElementById('overtimePay').value) || 0;
    const bonus = parseFloat(document.getElementById('bonus').value) || 0;
    
    const taxDeduction = parseFloat(document.getElementById('taxDeduction').value) || 0;
    const sssDeduction = parseFloat(document.getElementById('sssDeduction').value) || 0;
    const philhealthDeduction = parseFloat(document.getElementById('philhealthDeduction').value) || 0;
    const pagibigDeduction = parseFloat(document.getElementById('pagibigDeduction').value) || 0;
    const loanDeduction = parseFloat(document.getElementById('loanDeduction').value) || 0;
    const otherDeductions = parseFloat(document.getElementById('otherDeductions').value) || 0;
    const advanceDeduction = parseFloat(document.getElementById('advanceDeduction').value) || 0;
    
    const totalEarnings = baseSalary + allowances + overtimePay + bonus;
    const totalDeductions = taxDeduction + sssDeduction + philhealthDeduction + 
                           pagibigDeduction + loanDeduction + otherDeductions + advanceDeduction;
    const netPay = totalEarnings - totalDeductions;
    
    document.getElementById('totalEarnings').value = totalEarnings.toFixed(2);
    document.getElementById('totalDeductions').value = totalDeductions.toFixed(2);
    document.getElementById('netPay').value = netPay.toFixed(2);
}

// Update summary cards
function updateSummaryCards() {
    fetch('/api/admin-salary/summary')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const summary = data.data;
                document.getElementById('totalStaff').textContent = summary.totalStaff;
                document.getElementById('monthlyPayroll').textContent = `₱${summary.monthlyPayroll.toLocaleString()}`;
                document.getElementById('pendingPayments').textContent = `₱${summary.pendingPayments.toLocaleString()}`;
                document.getElementById('pendingCount').textContent = `${summary.pendingCount} pending`;
                document.getElementById('ytdTotal').textContent = `₱${summary.ytdTotal.toLocaleString()}`;
                document.getElementById('monthlyPayrollPeriod').textContent = summary.monthlyPayrollPeriod;
            }
        })
        .catch(error => {
            console.error('Error loading summary:', error);
        });
}

// Load charts
function loadCharts() {
    fetch('/api/admin-salary/analytics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const analytics = data.data;
                
                // Destroy existing charts if they exist
                if (charts.salaryByDept) charts.salaryByDept.destroy();
                if (charts.monthlyTrend) charts.monthlyTrend.destroy();
                if (charts.status) charts.status.destroy();
                
                // Salary by Department Chart
                const deptCtx = document.getElementById('salaryByDeptChart')?.getContext('2d');
                if (deptCtx && analytics.salaryByDepartment) {
                    charts.salaryByDept = new Chart(deptCtx, {
                        type: 'bar',
                        data: {
                            labels: analytics.salaryByDepartment.labels || [],
                            datasets: [{
                                label: 'Monthly Salary (₱)',
                                data: analytics.salaryByDepartment.data || [],
                                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                                borderColor: 'rgba(54, 162, 235, 1)',
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
                
                // Monthly Trend Chart
                const trendCtx = document.getElementById('monthlyTrendChart')?.getContext('2d');
                if (trendCtx && analytics.monthlyTrend) {
                    charts.monthlyTrend = new Chart(trendCtx, {
                        type: 'line',
                        data: {
                            labels: analytics.monthlyTrend.labels || [],
                            datasets: [{
                                label: 'Monthly Salary Total',
                                data: analytics.monthlyTrend.data || [],
                                borderColor: 'rgba(75, 192, 192, 1)',
                                backgroundColor: 'rgba(75, 192, 192, 0.1)',
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
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: function(value) {
                                            return '₱' + (value/1000) + 'k';
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
                
                // Status Distribution Chart
                const statusCtx = document.getElementById('statusChart')?.getContext('2d');
                if (statusCtx && analytics.statusDistribution) {
                    charts.status = new Chart(statusCtx, {
                        type: 'doughnut',
                        data: {
                            labels: analytics.statusDistribution.labels || [],
                            datasets: [{
                                data: analytics.statusDistribution.data || [],
                                backgroundColor: [
                                    'rgba(75, 192, 192, 0.8)',
                                    'rgba(255, 205, 86, 0.8)',
                                    'rgba(54, 162, 235, 0.8)',
                                    'rgba(255, 99, 132, 0.8)'
                                ],
                                borderWidth: 0
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: true,
                            aspectRatio: 2,
                            plugins: {
                                legend: { 
                                    position: 'bottom',
                                    labels: {
                                        boxWidth: 12,
                                        padding: 10
                                    }
                                }
                            }
                        }
                    });
                }
                
                // Top Earners List
                if (analytics.topEarners) {
                    const container = document.getElementById('topEarnersList');
                    let html = '';
                    analytics.topEarners.forEach((earner, index) => {
                        html += `
                            <div class="earner-item">
                                <div class="earner-info">
                                    <div class="earner-name">${index + 1}. ${earner.name || 'Unknown'}</div>
                                    <div class="earner-position">${earner.position || 'N/A'}</div>
                                </div>
                                <div class="earner-salary">₱${(earner.salary || 0).toLocaleString()}</div>
                            </div>
                        `;
                    });
                    container.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading charts:', error);
        });
}

// Update charts with filtered data
function updateCharts(records) {
    if (!records || records.length === 0) return;
    
    // Update status chart
    if (charts.status) {
        const statusCounts = { paid: 0, pending: 0, processing: 0, cancelled: 0 };
        records.forEach(record => {
            if (statusCounts.hasOwnProperty(record.paymentStatus)) {
                statusCounts[record.paymentStatus]++;
            }
        });
        charts.status.data.datasets[0].data = Object.values(statusCounts);
        charts.status.update();
    }
}

// Open add admin modal
function openAddAdminModal() {
    const modal = document.getElementById('addAdminModal');
    document.getElementById('addAdminForm').reset();
    document.getElementById('effectiveDate').valueAsDate = new Date();
    modal.style.display = 'block';
}

// Save admin
function saveAdmin(e) {
    e.preventDefault();
    
    const formData = {
        fullName: document.getElementById('adminFullName').value,
        email: document.getElementById('adminEmail').value,
        phone: document.getElementById('adminPhone').value,
        hireDate: document.getElementById('adminHireDate').value,
        address: document.getElementById('adminAddress').value,
        emergencyContact: document.getElementById('adminEmergencyContact').value,
        position: document.getElementById('adminPosition').value,
        department: document.getElementById('adminDepartment').value,
        status: document.getElementById('adminStatus').value,
        rateType: document.getElementById('rateType').value,
        effectiveDate: document.getElementById('effectiveDate').value,
        dailyRate: parseFloat(document.getElementById('dailyRate').value) || 0,
        cutoffRate: parseFloat(document.getElementById('cutoffRate').value) || 0,
        monthlyRate: parseFloat(document.getElementById('monthlyRate').value) || 0
    };
    
    Swal.fire({
        title: 'Adding Admin...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/admin-salary/add-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Admin Added!',
                text: 'New admin has been added successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadEmployees();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to add admin.'
            });
        }
    })
    .catch(error => {
        console.error('Error adding admin:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// Update openSalaryModal function
function openSalaryModal(recordId = null) {
    const modal = document.getElementById('salaryModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('salaryForm');
    
    if (!recordId) {
        title.textContent = 'Add Salary Record';
        form.reset();
        document.getElementById('recordId').value = '';
        document.getElementById('paymentDate').valueAsDate = new Date();
        
        // Don't auto-fetch here - wait for both selections
        // Clear any existing values
        document.getElementById('taxDeduction').value = 0;
        document.getElementById('sssDeduction').value = 0;
        document.getElementById('philhealthDeduction').value = 0;
        document.getElementById('pagibigDeduction').value = 0;
        document.getElementById('loanDeduction').value = 0;
        document.getElementById('otherDeductions').value = 0;
        document.getElementById('advanceDeduction').value = 0;
        
        calculateTotals();
    } else {
        title.textContent = 'Edit Salary Record';
        fetch(`/api/admin-salary/records/${recordId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    populateSalaryForm(data.data);
                }
            });
    }
    
    modal.style.display = 'block';
}

// Populate salary form
function populateSalaryForm(record) {
    document.getElementById('recordId').value = record.id;
    document.getElementById('employeeId').value = record.employeeId;
    document.getElementById('payPeriod').value = record.payPeriod || '';
    document.getElementById('baseSalary').value = record.baseSalary || 0;
    document.getElementById('allowances').value = record.allowances || 0;
    document.getElementById('overtimePay').value = record.overtimePay || 0;
    document.getElementById('bonus').value = record.bonus || 0;
    document.getElementById('taxDeduction').value = record.taxDeduction || 0;
    document.getElementById('sssDeduction').value = record.sssDeduction || 0;
    document.getElementById('philhealthDeduction').value = record.philhealthDeduction || 0;
    document.getElementById('pagibigDeduction').value = record.pagibigDeduction || 0;
    document.getElementById('loanDeduction').value = record.loanDeduction || 0;
    document.getElementById('otherDeductions').value = record.otherDeductions || 0;
    document.getElementById('advanceDeduction').value = record.advanceDeduction || 0;
    document.getElementById('paymentStatus').value = record.paymentStatus || 'pending';
    document.getElementById('paymentDate').value = record.paymentDate || '';
    document.getElementById('paymentMethod').value = record.paymentMethod || '';
    document.getElementById('salaryNotes').value = record.notes || '';
    
    calculateTotals();
}

// Save salary record
function saveSalaryRecord(e) {
    e.preventDefault();
    
    const formData = {
        employeeId: document.getElementById('employeeId').value,
        payPeriod: document.getElementById('payPeriod').value,
        baseSalary: parseFloat(document.getElementById('baseSalary').value) || 0,
        allowances: parseFloat(document.getElementById('allowances').value) || 0,
        overtimePay: parseFloat(document.getElementById('overtimePay').value) || 0,
        bonus: parseFloat(document.getElementById('bonus').value) || 0,
        taxDeduction: parseFloat(document.getElementById('taxDeduction').value) || 0,
        sssDeduction: parseFloat(document.getElementById('sssDeduction').value) || 0,
        philhealthDeduction: parseFloat(document.getElementById('philhealthDeduction').value) || 0,
        pagibigDeduction: parseFloat(document.getElementById('pagibigDeduction').value) || 0,
        loanDeduction: parseFloat(document.getElementById('loanDeduction').value) || 0,
        otherDeductions: parseFloat(document.getElementById('otherDeductions').value) || 0,
        advanceDeduction: parseFloat(document.getElementById('advanceDeduction').value) || 0,
        paymentStatus: document.getElementById('paymentStatus').value,
        paymentDate: document.getElementById('paymentDate').value,
        paymentMethod: document.getElementById('paymentMethod').value,
        notes: document.getElementById('salaryNotes').value
    };
    
    const recordId = document.getElementById('recordId').value;
    const url = recordId ? `/api/admin-salary/records/${recordId}` : '/api/admin-salary/records';
    const method = recordId ? 'PUT' : 'POST';
    
    Swal.fire({
        title: recordId ? 'Updating Record...' : 'Saving Record...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: recordId ? 'Record Updated!' : 'Record Saved!',
                text: 'The salary record has been successfully saved.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadSalaryRecords();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to save record.'
            });
        }
    })
    .catch(error => {
        console.error('Error saving record:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// View salary record
function viewSalaryRecord(recordId) {
    fetch(`/api/admin-salary/records/${recordId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const record = data.data;
                const container = document.getElementById('detailsContainer');
                const modal = document.getElementById('detailsModal');
                
                const totalEarnings = (record.baseSalary || 0) + (record.allowances || 0) + 
                                     (record.overtimePay || 0) + (record.bonus || 0);
                const totalDeductions = (record.taxDeduction || 0) + (record.sssDeduction || 0) + 
                                       (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) +
                                       (record.loanDeduction || 0) + (record.otherDeductions || 0) +
                                       (record.advanceDeduction || 0);
                const netPay = totalEarnings - totalDeductions;
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Employee:</span>
                        <span class="detail-value">${record.employeeName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Position:</span>
                        <span class="detail-value">${record.position || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Department:</span>
                        <span class="detail-value">${record.department || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Pay Period:</span>
                        <span class="detail-value">${record.payPeriod || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Base Salary:</span>
                        <span class="detail-value">₱${(record.baseSalary || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Allowances:</span>
                        <span class="detail-value">₱${(record.allowances || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Overtime Pay:</span>
                        <span class="detail-value">₱${(record.overtimePay || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Bonus:</span>
                        <span class="detail-value">₱${(record.bonus || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tax Deduction:</span>
                        <span class="detail-value">₱${(record.taxDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">SSS:</span>
                        <span class="detail-value">₱${(record.sssDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">PhilHealth:</span>
                        <span class="detail-value">₱${(record.philhealthDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Pag-IBIG:</span>
                        <span class="detail-value">₱${(record.pagibigDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Loan:</span>
                        <span class="detail-value">₱${(record.loanDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Other Deductions:</span>
                        <span class="detail-value">₱${(record.otherDeductions || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Advance Deduction:</span>
                        <span class="detail-value">₱${(record.advanceDeduction || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Earnings:</span>
                        <span class="detail-value">₱${totalEarnings.toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Deductions:</span>
                        <span class="detail-value">₱${totalDeductions.toLocaleString()}</span>
                    </div>
                    <div class="detail-row" style="border-bottom: 2px solid #3498db;">
                        <span class="detail-label"><strong>Net Pay:</strong></span>
                        <span class="detail-value"><strong>₱${netPay.toLocaleString()}</strong></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge status-${record.paymentStatus || 'pending'}">${(record.paymentStatus || 'pending').toUpperCase()}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Payment Date:</span>
                        <span class="detail-value">${record.paymentDate ? new Date(record.paymentDate).toLocaleDateString() : '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Payment Method:</span>
                        <span class="detail-value">${record.paymentMethod ? record.paymentMethod.replace('-', ' ').toUpperCase() : '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Notes:</span>
                        <span class="detail-value">${record.notes || '—'}</span>
                    </div>
                `;
                
                document.getElementById('editFromDetailsBtn').dataset.recordId = recordId;
                document.getElementById('generatePayslipDetailsBtn').dataset.recordId = recordId;
                
                modal.style.display = 'block';
            }
        });
}

// View admin details
function viewAdminDetails(adminId) {
    currentAdminId = adminId;
    
    // Load admin info
    fetch(`/api/admin-salary/employees/${adminId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const admin = data.data;
                const container = document.getElementById('adminInfoContainer');
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Full Name:</span>
                        <span class="detail-value">${admin.name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email:</span>
                        <span class="detail-value">${admin.email || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Phone:</span>
                        <span class="detail-value">${admin.phone || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Position:</span>
                        <span class="detail-value">${admin.position || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Department:</span>
                        <span class="detail-value">${admin.department ? admin.department.charAt(0).toUpperCase() + admin.department.slice(1) : 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Base Salary:</span>
                        <span class="detail-value">₱${(admin.baseSalary || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Hire Date:</span>
                        <span class="detail-value">${admin.hireDate ? new Date(admin.hireDate).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge status-${admin.status || 'active'}">${(admin.status || 'active').toUpperCase()}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Address:</span>
                        <span class="detail-value">${admin.address || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Emergency Contact:</span>
                        <span class="detail-value">${admin.emergencyContact || 'N/A'}</span>
                    </div>
                `;
                
                // Load salary history
                loadSalaryHistory(adminId);
                
                // Load deductions history
                loadDeductionsHistory(adminId);
                
                // Load advances history
                loadAdvancesHistory(adminId);
                
                document.getElementById('adminDetailsModal').style.display = 'block';
            }
        });
}

// Open edit admin modal
function openEditAdminModal() {
    if (!currentAdminId) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No admin selected.'
        });
        return;
    }
    
    // Show loading
    Swal.fire({
        title: 'Loading...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    // Fetch current admin data
    fetch(`/api/admin-salary/employees/${currentAdminId}`)
        .then(response => response.json())
        .then(data => {
            Swal.close();
            
            if (data.success) {
                const admin = data.data;
                
                // Populate form
                document.getElementById('editAdminId').value = currentAdminId;
                document.getElementById('editAdminFullName').value = admin.name || '';
                document.getElementById('editAdminEmail').value = admin.email || '';
                document.getElementById('editAdminPhone').value = admin.phone || '';
                document.getElementById('editAdminHireDate').value = admin.hireDate || '';
                document.getElementById('editAdminAddress').value = admin.address || '';
                document.getElementById('editAdminEmergencyContact').value = admin.emergencyContact || '';
                document.getElementById('editAdminPosition').value = admin.position || '';
                document.getElementById('editAdminDepartment').value = admin.department || 'admin';
                document.getElementById('editAdminStatus').value = admin.status || 'active';
                document.getElementById('editRateType').value = admin.rateType || 'monthly';
                document.getElementById('editEffectiveDate').value = admin.effectiveDate || '';
                
                // Trigger rate type change to show correct fields
                handleEditRateTypeChange();
                
                // Set rate values
                if (admin.rateType === 'daily') {
                    document.getElementById('editDailyRate').value = admin.dailyRate || 0;
                } else if (admin.rateType === 'cutoff') {
                    document.getElementById('editCutoffRate').value = admin.cutoffRate || 0;
                } else {
                    document.getElementById('editMonthlyRate').value = admin.monthlyRate || 0;
                }
                
                // Close admin details modal and open edit modal
                document.getElementById('adminDetailsModal').style.display = 'none';
                document.getElementById('editAdminModal').style.display = 'block';
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to load admin data.'
                });
            }
        })
        .catch(error => {
            Swal.close();
            console.error('Error loading admin data:', error);
            Swal.fire({
                icon: 'error',
                title: 'Connection Error',
                text: 'Failed to connect to server.'
            });
        });
}

// Update admin
function updateAdmin(e) {
    e.preventDefault();
    
    const adminId = document.getElementById('editAdminId').value;
    const formData = {
        fullName: document.getElementById('editAdminFullName').value,
        email: document.getElementById('editAdminEmail').value,
        phone: document.getElementById('editAdminPhone').value,
        hireDate: document.getElementById('editAdminHireDate').value,
        address: document.getElementById('editAdminAddress').value,
        emergencyContact: document.getElementById('editAdminEmergencyContact').value,
        position: document.getElementById('editAdminPosition').value,
        department: document.getElementById('editAdminDepartment').value,
        status: document.getElementById('editAdminStatus').value,
        rateType: document.getElementById('editRateType').value,
        effectiveDate: document.getElementById('editEffectiveDate').value,
        dailyRate: parseFloat(document.getElementById('editDailyRate').value) || 0,
        cutoffRate: parseFloat(document.getElementById('editCutoffRate').value) || 0,
        monthlyRate: parseFloat(document.getElementById('editMonthlyRate').value) || 0
    };
    
    Swal.fire({
        title: 'Updating Admin...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/admin-salary/update-admin/${adminId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Admin Updated!',
                text: 'Admin information has been updated successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            
            closeAllModals();
            
            // Refresh admin details if modal is open
            if (currentAdminId) {
                setTimeout(() => {
                    viewAdminDetails(currentAdminId);
                }, 500);
            }
            
            // Refresh employees list
            loadEmployees();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to update admin.'
            });
        }
    })
    .catch(error => {
        console.error('Error updating admin:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// Load salary history
function loadSalaryHistory(adminId) {
    fetch(`/api/admin-salary/history/${adminId}`)
        .then(response => response.json())
        .then(data => {
            const tbody = document.getElementById('salaryHistoryBody');
            if (data.success && data.data.length > 0) {
                let html = '';
                data.data.forEach(record => {
                    html += `
                        <tr>
                            <td>${record.payPeriod || 'N/A'}</td>
                            <td>₱${(record.baseSalary || 0).toLocaleString()}</td>
                            <td>₱${(record.totalEarnings || 0).toLocaleString()}</td>
                            <td>₱${(record.totalDeductions || 0).toLocaleString()}</td>
                            <td>₱${(record.advanceDeduction || 0).toLocaleString()}</td>
                            <td>₱${(record.netPay || 0).toLocaleString()}</td>
                            <td><span class="status-badge status-${record.paymentStatus || 'pending'}">${(record.paymentStatus || 'pending').toUpperCase()}</span></td>
                            <td>${record.paymentDate ? new Date(record.paymentDate).toLocaleDateString() : '—'}</td>
                            <td>
                                <button class="action-btn action-view" onclick="viewSalaryRecord('${record.id}')">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            } else {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">No salary history found</td></tr>';
            }
        });
}

// Load deductions history
function loadDeductionsHistory(adminId) {
    fetch(`/api/admin-salary/deductions/${adminId}`)
        .then(response => response.json())
        .then(data => {
            const tbody = document.getElementById('deductionsHistoryBody');
            if (data.success && data.data.length > 0) {
                let html = '';
                data.data.forEach(deduction => {
                    const statusClass = deduction.status === 'applied' ? 'status-applied' :
                                       deduction.status === 'pending' ? 'status-pending' : 'status-cancelled';
                    
                    html += `
                        <tr>
                            <td>${deduction.type ? deduction.type.toUpperCase() : 'N/A'}</td>
                            <td>₱${(deduction.amount || 0).toLocaleString()}</td>
                            <td>${deduction.period || 'N/A'}</td>
                            <td>${deduction.description || '—'}</td>
                            <td><span class="status-badge ${statusClass}">${(deduction.status || 'applied').toUpperCase()}</span></td>
                            <td>${deduction.date ? new Date(deduction.date).toLocaleDateString() : '—'}</td>
                            <td>
                                <button class="action-btn action-delete" onclick="deleteDeduction('${deduction.id}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No deductions found</td></tr>';
            }
        });
}

// Load advances history
function loadAdvancesHistory(adminId) {
    fetch(`/api/admin-salary/advances/${adminId}`)
        .then(response => response.json())
        .then(data => {
            const tbody = document.getElementById('advancesHistoryBody');
            if (data.success && data.data.length > 0) {
                let html = '';
                data.data.forEach(advance => {
                    const statusClass = advance.status === 'paid' ? 'status-paid' :
                                       advance.status === 'approved' ? 'status-approved' :
                                       advance.status === 'pending' ? 'status-pending' : 'status-rejected';
                    
                    html += `
                        <tr>
                            <td>₱${(advance.amount || 0).toLocaleString()}</td>
                            <td>${advance.dateRequested ? new Date(advance.dateRequested).toLocaleDateString() : '—'}</td>
                            <td>${advance.reason || '—'}</td>
                            <td>${advance.repaymentPeriod || '—'}</td>
                            <td>₱${(advance.remainingBalance || 0).toLocaleString()}</td>
                            <td><span class="status-badge ${statusClass}">${(advance.status || 'pending').toUpperCase()}</span></td>
                            <td>
                                <button class="action-btn action-view" onclick="viewAdvance('${advance.id}')">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No advances found</td></tr>';
            }
        });
}

// Open payroll modal
function openPayrollModal() {
    const modal = document.getElementById('payrollModal');
    document.getElementById('payrollDate').valueAsDate = new Date();
    modal.style.display = 'block';
}

// Process payroll
function processPayroll(e) {
    e.preventDefault();
    
    const selectedEmployees = [];
    document.querySelectorAll('#employeeList input[type="checkbox"]:checked').forEach(cb => {
        selectedEmployees.push(cb.value);
    });
    
    if (selectedEmployees.length === 0) {
        Swal.fire({
            icon: 'error',
            title: 'No Employees Selected',
            text: 'Please select at least one employee to process payroll.'
        });
        return;
    }
    
    const formData = {
        payrollPeriod: document.getElementById('payrollPeriod').value,
        payrollDate: document.getElementById('payrollDate').value,
        paymentMethod: document.getElementById('payrollMethod').value,
        employees: selectedEmployees
    };
    
    Swal.fire({
        title: 'Processing Payroll...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/admin-salary/process-payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Payroll Processed!',
                text: data.message,
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadSalaryRecords();
            updateSummaryCards();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to process payroll.'
            });
        }
    })
    .catch(error => {
        console.error('Error processing payroll:', error);
        Swal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Failed to connect to server.'
        });
    });
}

// Generate payslip
function generatePayslip(recordId) {
    fetch(`/api/admin-salary/generate-payslip/${recordId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayPayslip(data.data);
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: data.error || 'Failed to generate payslip.'
                });
            }
        });
}

// Display payslip
function displayPayslip(data) {
    const modal = document.getElementById('payslipModal');
    const container = document.getElementById('payslipContainer');
    
    container.innerHTML = `
        <div class="payslip-header">
            <h2>OLStar Transport</h2>
            <p>Payslip for ${data.payPeriod}</p>
        </div>
        
        <div class="payslip-section">
            <h3>Employee Information</h3>
            <div class="payslip-row">
                <span>Employee Name:</span>
                <span>${data.employee.name}</span>
            </div>
            <div class="payslip-row">
                <span>Position:</span>
                <span>${data.employee.position}</span>
            </div>
            <div class="payslip-row">
                <span>Department:</span>
                <span>${data.employee.department}</span>
            </div>
            <div class="payslip-row">
                <span>Employee ID:</span>
                <span>${data.employee.id}</span>
            </div>
        </div>
        
        <div class="payslip-section">
            <h3>Earnings</h3>
            <div class="payslip-row">
                <span>Base Salary:</span>
                <span>₱${data.earnings.baseSalary.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>Allowances:</span>
                <span>₱${data.earnings.allowances.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>Overtime Pay:</span>
                <span>₱${data.earnings.overtimePay.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>Bonus:</span>
                <span>₱${data.earnings.bonus.toLocaleString()}</span>
            </div>
            <div class="payslip-row total">
                <span>Total Earnings:</span>
                <span>₱${data.earnings.total.toLocaleString()}</span>
            </div>
        </div>
        
        <div class="payslip-section">
            <h3>Deductions</h3>
            <div class="payslip-row">
                <span>Tax:</span>
                <span>₱${data.deductions.tax.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>SSS:</span>
                <span>₱${data.deductions.sss.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>PhilHealth:</span>
                <span>₱${data.deductions.philhealth.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>Pag-IBIG:</span>
                <span>₱${data.deductions.pagibig.toLocaleString()}</span>
            </div>
            <div class="payslip-row">
                <span>Loan:</span>
                <span>₱${data.deductions.loan || 0}</span>
            </div>
            <div class="payslip-row">
                <span>Other:</span>
                <span>₱${data.deductions.other || 0}</span>
            </div>
            <div class="payslip-row">
                <span>Advance:</span>
                <span>₱${data.deductions.advance || 0}</span>
            </div>
            <div class="payslip-row total">
                <span>Total Deductions:</span>
                <span>₱${data.deductions.total.toLocaleString()}</span>
            </div>
        </div>
        
        <div class="payslip-section">
            <div class="payslip-row total">
                <span>NET PAY:</span>
                <span>₱${data.netPay.toLocaleString()}</span>
            </div>
        </div>
        
        <div class="payslip-section">
            <div class="payslip-row">
                <span>Payment Date:</span>
                <span>${data.paymentDate ? new Date(data.paymentDate).toLocaleDateString() : '—'}</span>
            </div>
            <div class="payslip-row">
                <span>Payment Method:</span>
                <span>${data.paymentMethod ? data.paymentMethod.replace('-', ' ').toUpperCase() : '—'}</span>
            </div>
            <div class="payslip-row">
                <span>Status:</span>
                <span>${data.status.toUpperCase()}</span>
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
}

// Add deduction from details
function addDeductionFromDetails() {
    if (!currentAdminId) return;
    
    document.getElementById('deductionAdminId').value = currentAdminId;
    document.getElementById('addDeductionModal').style.display = 'block';
    closeAllModalsExcept('addDeductionModal');
}

// Save deduction
function saveDeduction(e) {
    e.preventDefault();
    
    const formData = {
        adminId: document.getElementById('deductionAdminId').value,
        type: document.getElementById('deductionType').value,
        amount: parseFloat(document.getElementById('deductionAmount').value),
        period: document.getElementById('deductionPeriod').value,
        description: document.getElementById('deductionDescription').value
    };
    
    Swal.fire({
        title: 'Adding Deduction...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/admin-salary/add-deduction', {
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
                text: 'Deduction has been added successfully.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadDeductionsHistory(formData.adminId);
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to add deduction.'
            });
        }
    });
}

// Add advance from details
function addAdvanceFromDetails() {
    if (!currentAdminId) return;
    
    document.getElementById('advanceAdminId').value = currentAdminId;
    document.getElementById('addAdvanceModal').style.display = 'block';
    closeAllModalsExcept('addAdvanceModal');
}

// Save advance
function saveAdvance(e) {
    e.preventDefault();
    
    const formData = {
        adminId: document.getElementById('advanceAdminId').value,
        amount: parseFloat(document.getElementById('advanceAmount').value),
        reason: document.getElementById('advanceReason').value,
        repaymentPeriod: document.getElementById('repaymentPeriod').value,
        repaymentAmount: parseFloat(document.getElementById('repaymentAmount').value) || null
    };
    
    Swal.fire({
        title: 'Submitting Advance Request...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/admin-salary/add-advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Advance Request Submitted!',
                text: 'Your advance request has been submitted.',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadAdvancesHistory(formData.adminId);
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: data.error || 'Failed to submit advance request.'
            });
        }
    });
}

// Edit from details
function editFromDetails() {
    const recordId = document.getElementById('editFromDetailsBtn').dataset.recordId;
    closeAllModals();
    openSalaryModal(recordId);
}

// Generate payslip from details
function generatePayslipFromDetails() {
    const recordId = document.getElementById('generatePayslipDetailsBtn').dataset.recordId;
    closeAllModals();
    generatePayslip(recordId);
}

// Process salary from details
function processSalaryFromDetails() {
    if (!currentAdminId) return;
    closeAllModals();
    openSalaryModal();
    document.getElementById('employeeId').value = currentAdminId;
}

// Edit salary record
function editSalaryRecord(recordId) {
    openSalaryModal(recordId);
}

// Delete salary record
function deleteSalaryRecord(recordId) {
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
            fetch(`/api/admin-salary/records/${recordId}`, { method: 'DELETE' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        Swal.fire('Deleted!', 'The salary record has been deleted.', 'success');
                        loadSalaryRecords();
                        updateSummaryCards();
                    } else {
                        Swal.fire({ icon: 'error', title: 'Error', text: data.error });
                    }
                });
        }
    });
}

// Generate bulk payslips
function generateBulkPayslips() {
    Swal.fire({
        title: 'Generate Bulk Payslips',
        text: 'Select pay period to generate payslips',
        input: 'select',
        inputOptions: {
            'January 2026 - 1st Half': 'January 2026 - 1st Half',
            'January 2026 - 2nd Half': 'January 2026 - 2nd Half',
            'February 2026 - 1st Half': 'February 2026 - 1st Half',
            'February 2026 - 2nd Half': 'February 2026 - 2nd Half',
            'March 2026 - 1st Half': 'March 2026 - 1st Half',
            'March 2026 - 2nd Half': 'March 2026 - 2nd Half'
        },
        inputPlaceholder: 'Select pay period',
        showCancelButton: true,
        confirmButtonText: 'Generate',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                title: 'Generating Payslips...',
                text: 'Please wait',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            setTimeout(() => {
                Swal.fire({
                    icon: 'success',
                    title: 'Payslips Generated!',
                    text: 'All payslips have been generated successfully.',
                    timer: 2000,
                    showConfirmButton: false
                });
            }, 2000);
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
        loadSalaryRecords();
        updateSummaryCards();
        Swal.close();
    }, 500);
}

// Download payslip
function downloadPayslip() {
    Swal.fire({
        icon: 'success',
        title: 'Download Started',
        text: 'Your payslip is being downloaded.',
        timer: 1500,
        showConfirmButton: false
    });
}

// Email payslip
function emailPayslip() {
    Swal.fire({
        title: 'Email Payslip',
        text: 'Enter email address:',
        input: 'email',
        inputValue: 'employee@example.com',
        showCancelButton: true,
        confirmButtonText: 'Send',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                icon: 'success',
                title: 'Email Sent!',
                text: 'Payslip has been sent successfully.',
                timer: 1500,
                showConfirmButton: false
            });
        }
    });
}

// Show loading
function showLoading() {
    // Optional: Add loading spinner
}

// Hide loading
function hideLoading() {
    // Optional: Remove loading spinner
}

// Close all modals
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Close all modals except one
function closeAllModalsExcept(modalId) {
    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.id !== modalId) {
            modal.style.display = 'none';
        }
    });
}

// Click outside modal to close
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};