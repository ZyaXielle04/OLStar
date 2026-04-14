// General Ledger - Overview JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    setupEventListeners();
    loadOverviewData();
    loadCharts();
});

// Global variables
let currentDateRange = 'month';
let startDate = null;
let endDate = null;
let charts = {};

// Setup event listeners
function setupEventListeners() {
    // Toggle sidebar
    const toggleBtn = document.getElementById('btnToggleSidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }

    // Date range tabs
    document.querySelectorAll('.date-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentDateRange = this.dataset.range;
            
            if (currentDateRange === 'custom') {
                document.getElementById('customDateRange').style.display = 'flex';
            } else {
                document.getElementById('customDateRange').style.display = 'none';
                loadOverviewData();
            }
        });
    });

    // Apply custom date range
    document.getElementById('applyDateRange')?.addEventListener('click', function() {
        startDate = document.getElementById('startDate').value;
        endDate = document.getElementById('endDate').value;
        
        if (!startDate || !endDate) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Please select both start and end dates.'
            });
            return;
        }
        
        loadOverviewData();
    });

    // Refresh button
    document.getElementById('refreshOverviewBtn')?.addEventListener('click', refreshData);

    // Year select for monthly breakdown
    document.getElementById('yearSelect')?.addEventListener('change', loadMonthlyBreakdown);
}

// Toggle sidebar
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    document.querySelector('.content').classList.toggle('expanded');
}

// Load all overview data
function loadOverviewData() {
    showLoading();
    
    const params = new URLSearchParams({
        range: currentDateRange,
        startDate: startDate || '',
        endDate: endDate || ''
    });
    
    Promise.all([
        fetch(`/api/gl-overview/summary?${params.toString()}`).then(res => res.json()),
        fetch(`/api/gl-overview/categories?${params.toString()}`).then(res => res.json()),
        fetch(`/api/gl-overview/recent?${params.toString()}`).then(res => res.json()),
        fetch(`/api/gl-overview/monthly?year=${document.getElementById('yearSelect').value}`).then(res => res.json())
    ])
    .then(([summaryData, categoriesData, recentData, monthlyData]) => {
        if (summaryData.success) {
            updateSummaryCards(summaryData.data);
            updateNetWorthCards(summaryData.data);
            updateIncomeExpensesChart(summaryData.data);
        }
        
        if (categoriesData.success) {
            updateCategoryCards(categoriesData.data);
        }
        
        if (recentData.success) {
            updateRecentLists(recentData.data);
        }
        
        if (monthlyData.success) {
            updateMonthlyBreakdown(monthlyData.data);
        }
    })
    .catch(error => {
        console.error('Error loading overview data:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load overview data.'
        });
    })
    .finally(() => hideLoading());
}

// Load monthly breakdown for selected year
function loadMonthlyBreakdown() {
    const year = document.getElementById('yearSelect').value;
    
    fetch(`/api/gl-overview/monthly?year=${year}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateMonthlyBreakdown(data.data);
            }
        })
        .catch(error => console.error('Error loading monthly breakdown:', error));
}

// Update net worth cards
function updateNetWorthCards(data) {
    document.getElementById('grossIncome').textContent = `₱${data.grossIncome.toLocaleString()}`;
    document.getElementById('totalExpenses').textContent = `₱${data.totalExpenses.toLocaleString()}`;
    document.getElementById('netProfit').textContent = `₱${data.netProfit.toLocaleString()}`;
    document.getElementById('cashFlow').textContent = `₱${data.cashFlow.toLocaleString()}`;
    
    // Update period text
    const periodText = getPeriodText();
    document.getElementById('grossIncomePeriod').textContent = periodText;
    document.getElementById('netProfitPeriod').textContent = periodText;
}

// Update summary cards
function updateSummaryCards(data) {
    // Driver Income
    document.getElementById('totalTrips').textContent = data.totalTrips;
    document.getElementById('tripIncome').textContent = `₱${data.tripIncome.toLocaleString()}`;
    document.getElementById('driverPayout').textContent = `₱${data.driverPayout.toLocaleString()}`;
    document.getElementById('tripNetIncome').textContent = `₱${data.tripNetIncome.toLocaleString()}`;
    
    // Operating Expenses
    document.getElementById('gasExpenses').textContent = `₱${data.gasExpenses.toLocaleString()}`;
    document.getElementById('rfidExpenses').textContent = `₱${data.rfidExpenses.toLocaleString()}`;
    document.getElementById('maintenanceExpenses').textContent = `₱${data.maintenanceExpenses.toLocaleString()}`;
    document.getElementById('totalOperating').textContent = `₱${data.operatingExpenses.toLocaleString()}`;
    
    // Salaries (Net Pay)
    document.getElementById('adminSalaries').textContent = `₱${data.adminSalaries.toLocaleString()}`;
    document.getElementById('driverSalaries').textContent = `₱${data.driverSalaries.toLocaleString()}`;
    document.getElementById('totalSalaries').textContent = `₱${data.totalSalaries.toLocaleString()}`;
    
    // Deductions (Information only)
    document.getElementById('deductionsSSS').textContent = `₱${data.deductionsSSS.toLocaleString()}`;
    document.getElementById('deductionsPhilHealth').textContent = `₱${data.deductionsPhilHealth.toLocaleString()}`;
    document.getElementById('deductionsPagIBIG').textContent = `₱${data.deductionsPagIBIG.toLocaleString()}`;
    document.getElementById('deductionsTax').textContent = `₱${data.deductionsTax.toLocaleString()}`;
    document.getElementById('totalDeductions').textContent = `₱${data.totalDeductions.toLocaleString()}`;
}

// Update category cards
function updateCategoryCards(data) {
    document.getElementById('gasTotal').textContent = `₱${data.gasTotal.toLocaleString()}`;
    document.getElementById('gasCount').textContent = `${data.gasCount} transactions`;
    
    document.getElementById('rfidTotal').textContent = `₱${data.rfidTotal.toLocaleString()}`;
    document.getElementById('rfidCount').textContent = `${data.rfidCount} transactions`;
    
    document.getElementById('maintenanceTotal').textContent = `₱${data.maintenanceTotal.toLocaleString()}`;
    document.getElementById('maintenanceCount').textContent = `${data.maintenanceCount} records`;
    
    document.getElementById('activeAdvancesTotal').textContent = `₱${data.activeAdvancesTotal.toLocaleString()}`;
    document.getElementById('activeAdvancesCount').textContent = `${data.activeAdvancesCount} advances`;
}

// Update recent lists
function updateRecentLists(data) {
    // Recent Trips
    const tripsContainer = document.getElementById('recentTripsList');
    if (data.recentTrips && data.recentTrips.length > 0) {
        let html = '';
        data.recentTrips.forEach(trip => {
            html += `
                <div class="recent-item">
                    <div class="recent-item-info">
                        <div class="recent-item-title">${trip.driverName}</div>
                        <div class="recent-item-subtitle">${new Date(trip.date).toLocaleDateString()} • ${trip.time || ''}</div>
                    </div>
                    <div class="recent-item-amount income">₱${trip.amount.toLocaleString()}</div>
                </div>
            `;
        });
        tripsContainer.innerHTML = html;
    } else {
        tripsContainer.innerHTML = '<div class="loading">No recent trips</div>';
    }

    // Recent Expenses
    const expensesContainer = document.getElementById('recentExpensesList');
    if (data.recentExpenses && data.recentExpenses.length > 0) {
        let html = '';
        data.recentExpenses.forEach(expense => {
            const icon = expense.type === 'gas' ? 'fa-gas-pump' : 
                        expense.type === 'rfid' ? 'fa-id-card' : 'fa-tools';
            html += `
                <div class="recent-item">
                    <div class="recent-item-info">
                        <div class="recent-item-title">
                            <i class="fas ${icon}" style="margin-right: 5px;"></i>
                            ${expense.description || expense.type}
                        </div>
                        <div class="recent-item-subtitle">${new Date(expense.date).toLocaleDateString()}</div>
                    </div>
                    <div class="recent-item-amount expense">₱${expense.amount.toLocaleString()}</div>
                </div>
            `;
        });
        expensesContainer.innerHTML = html;
    } else {
        expensesContainer.innerHTML = '<div class="loading">No recent expenses</div>';
    }

    // Top Drivers
    const driversContainer = document.getElementById('topDriversList');
    if (data.topDrivers && data.topDrivers.length > 0) {
        let html = '';
        data.topDrivers.forEach((driver, index) => {
            html += `
                <div class="recent-item">
                    <div class="recent-item-info">
                        <div class="recent-item-title">${index + 1}. ${driver.name}</div>
                        <div class="recent-item-subtitle">${driver.trips} trips</div>
                    </div>
                    <div class="recent-item-amount income">₱${driver.earnings.toLocaleString()}</div>
                </div>
            `;
        });
        driversContainer.innerHTML = html;
    } else {
        driversContainer.innerHTML = '<div class="loading">No driver data</div>';
    }

    // Pending Items
    const pendingContainer = document.getElementById('pendingItemsList');
    let pendingHtml = '';
    
    if (data.pendingAdvances && data.pendingAdvances > 0) {
        pendingHtml += `
            <div class="recent-item">
                <div class="recent-item-info">
                    <div class="recent-item-title">Advance Requests</div>
                    <div class="recent-item-subtitle">Pending approval</div>
                </div>
                <div class="recent-item-amount warning">${data.pendingAdvances} pending</div>
            </div>
        `;
    }
    
    if (data.pendingDeductions && data.pendingDeductions > 0) {
        pendingHtml += `
            <div class="recent-item">
                <div class="recent-item-info">
                    <div class="recent-item-title">Pending Deductions</div>
                    <div class="recent-item-subtitle">Not yet applied</div>
                </div>
                <div class="recent-item-amount warning">${data.pendingDeductions} pending</div>
            </div>
        `;
    }
    
    if (data.unpaidSalaries && data.unpaidSalaries > 0) {
        pendingHtml += `
            <div class="recent-item">
                <div class="recent-item-info">
                    <div class="recent-item-title">Unpaid Salaries</div>
                    <div class="recent-item-subtitle">Awaiting payment</div>
                </div>
                <div class="recent-item-amount expense">₱${data.unpaidSalaries.toLocaleString()}</div>
            </div>
        `;
    }
    
    if (pendingHtml) {
        pendingContainer.innerHTML = pendingHtml;
    } else {
        pendingContainer.innerHTML = '<div class="loading">No pending items</div>';
    }
}

// Update monthly breakdown
function updateMonthlyBreakdown(data) {
    const tbody = document.getElementById('monthlyBreakdownBody');
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No monthly data available</td></tr>';
        return;
    }
    
    let html = '';
    data.forEach(month => {
        const profitClass = month.netProfit >= 0 ? 'profit-positive' : 'profit-negative';
        const profitSign = month.netProfit >= 0 ? '' : '-';
        
        html += `
            <tr>
                <td><strong>${month.month}</strong></td>
                <td>₱${month.income.toLocaleString()}</td>
                <td>₱${month.operatingExpenses.toLocaleString()}</td>
                <td>₱${month.salaries.toLocaleString()}</td>
                <td>₱${month.totalExpenses.toLocaleString()}</td>
                <td class="${profitClass}">${profitSign}₱${Math.abs(month.netProfit).toLocaleString()}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Load charts
function loadCharts() {
    fetch('/api/gl-overview/chart-data')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                createIncomeExpensesChart(data.data);
            }
        })
        .catch(error => console.error('Error loading chart data:', error));
}

// Create income vs expenses chart
function createIncomeExpensesChart(data) {
    const ctx = document.getElementById('incomeExpensesChart')?.getContext('2d');
    if (!ctx) return;
    
    // Destroy existing chart
    if (charts.incomeExpenses) {
        charts.incomeExpenses.destroy();
    }
    
    charts.incomeExpenses = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [
                {
                    label: 'Income',
                    data: data.income || [0, 0, 0, 0, 0, 0],
                    backgroundColor: 'rgba(46, 204, 113, 0.8)',
                    borderRadius: 6
                },
                {
                    label: 'Expenses',
                    data: data.expenses || [0, 0, 0, 0, 0, 0],
                    backgroundColor: 'rgba(231, 76, 60, 0.8)',
                    borderRadius: 6
                },
                {
                    label: 'Profit',
                    data: data.profit || [0, 0, 0, 0, 0, 0],
                    type: 'line',
                    borderColor: 'rgba(52, 152, 219, 1)',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointBackgroundColor: 'rgba(52, 152, 219, 1)',
                    pointBorderColor: 'white',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += '₱' + context.parsed.y.toLocaleString();
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + value.toLocaleString();
                        }
                    }
                },
                y1: {
                    position: 'right',
                    beginAtZero: true,
                    grid: {
                        drawOnChartArea: false
                    },
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

// Update income/expenses chart with new data
function updateIncomeExpensesChart(data) {
    if (!charts.incomeExpenses) {
        loadCharts();
        return;
    }
}

// Get period text based on current range
function getPeriodText() {
    switch(currentDateRange) {
        case 'today':
            return 'Today';
        case 'week':
            return 'This Week';
        case 'month':
            return 'This Month';
        case 'quarter':
            return 'This Quarter';
        case 'year':
            return 'This Year';
        case 'custom':
            return `${startDate || '?'} to ${endDate || '?'}`;
        default:
            return 'Current Period';
    }
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
        loadOverviewData();
        Swal.close();
    }, 500);
}

// Show/hide loading
function showLoading() {
    // Optional: Add loading overlay
}

function hideLoading() {
    // Optional: Remove loading overlay
}