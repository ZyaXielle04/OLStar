// ==================== Global Variables ====================
let currentPage = 1;
let totalPages = 1;
let currentDTR = {
    adminId: null,
    cutoff: null,
    entries: {},
    dailyRate: 620, // Default daily rate for 9 hours
    hourlyRate: 68.89, // 620 / 9 = 68.89 per hour
    otRate: 70, // ₱70 per hour for OT
    nightDiffRate: 10, // ₱10 per hour for night differential
    transactions: {
        totalUtang: 0,
        totalPaid: 0,
        balanceUtang: 0,
        list: {}
    }
};
let currentAdminId = null;

// ==================== Document Ready ====================
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
});

function initializePage() {
    loadEmployees();
    loadCutoffs();
    loadDTRRecords();
    loadSummary();
    setupEventListeners();
}

function loadCarryOverUtang(adminId, currentCutoff) {
    console.log('%c🔍 LOADING CARRYOVER UTANG', 'color: blue; font-weight: bold');
    console.log('Admin ID:', adminId);
    console.log('Current Cutoff:', currentCutoff);
    
    return new Promise((resolve, reject) => {
        const url = `/api/admin-salary/all-previous-utang/${adminId}/${encodeURIComponent(currentCutoff)}`;
        console.log('Fetching from:', url);
        
        fetch(url)
            .then(res => {
                console.log('Response status:', res.status);
                return res.json();
            })
            .then(data => {
                console.log('%c📦 API Response:', 'color: purple; font-weight: bold', data);
                
                if (data.success && data.data) {
                    console.log('Total remaining utang from API:', data.data.totalRemainingUtang);
                    console.log('Cutoffs list:', data.data.cutoffsList);
                    
                    if (data.data.totalRemainingUtang > 0) {
                        console.log('%c✅ Carryover utang found!', 'color: green; font-weight: bold');
                        console.log('Amount to carry over: ₱' + data.data.totalRemainingUtang.toLocaleString());
                        
                        // Log current state before adding carryover
                        console.log('%c📊 Current state BEFORE adding carryover:', 'color: orange');
                        console.log('Current transactions.list:', currentDTR.transactions.list);
                        console.log('Current totalUtang:', currentDTR.transactions.totalUtang);
                        console.log('Current totalPaid:', currentDTR.transactions.totalPaid);
                        
                        // Clear any existing carryover transactions first
                        const carryoverIds = Object.keys(currentDTR.transactions.list || {}).filter(id => 
                            currentDTR.transactions.list[id]?.type === 'utang' && 
                            currentDTR.transactions.list[id]?.date?.startsWith('Carryover')
                        );
                        
                        console.log('Existing carryover transactions to remove:', carryoverIds);
                        
                        carryoverIds.forEach(id => {
                            delete currentDTR.transactions.list[id];
                        });
                        
                        // Reset totalUtang to remove previous carryovers
                        let totalFromEntries = 0;
                        Object.values(currentDTR.entries || {}).forEach(entry => {
                            totalFromEntries += entry.advance || 0;
                        });
                        currentDTR.transactions.totalUtang = totalFromEntries;
                        
                        console.log('Total from entries after reset:', totalFromEntries);
                        
                        // Add the accumulated carryover utang
                        if (data.data.totalRemainingUtang > 0) {
                            const carryOverId = `carryover_${Date.now()}`;
                            const cutoffListText = data.data.cutoffsList.length > 1 
                                ? `${data.data.cutoffsList.length} previous cutoffs` 
                                : data.data.cutoffsList[0];
                            
                            const carryoverTransaction = {
                                id: carryOverId,
                                date: `Carryover from previous cutoffs`,
                                amount: data.data.totalRemainingUtang,
                                type: 'utang',
                                description: `Total remaining utang from ${cutoffListText}: ₱${data.data.totalRemainingUtang.toLocaleString()}`
                            };
                            
                            console.log('%c➕ Adding carryover transaction:', 'color: green', carryoverTransaction);
                            
                            currentDTR.transactions.list[carryOverId] = carryoverTransaction;
                            currentDTR.transactions.totalUtang = (currentDTR.transactions.totalUtang || 0) + data.data.totalRemainingUtang;
                        }
                        
                        currentDTR.transactions.balanceUtang = currentDTR.transactions.totalUtang - (currentDTR.transactions.totalPaid || 0);
                        
                        console.log('%c📊 Current state AFTER adding carryover:', 'color: green');
                        console.log('Updated transactions.list:', currentDTR.transactions.list);
                        console.log('Updated totalUtang:', currentDTR.transactions.totalUtang);
                        console.log('Updated balanceUtang:', currentDTR.transactions.balanceUtang);
                        
                        updateTransactionDisplay();
                        
                        // Show notification
                        Swal.fire({
                            icon: 'info',
                            title: 'Carryover Utang',
                            html: `₱${data.data.totalRemainingUtang.toLocaleString()} utang carried over from:<br>${data.data.cutoffsList.join('<br>')}`,
                            timer: 5000,
                            showConfirmButton: true,
                            confirmButtonText: 'OK',
                            toast: false,
                            position: 'center'
                        });
                    } else {
                        console.log('%cℹ️ No carryover utang found', 'color: gray');
                    }
                } else {
                    console.log('%c❌ API returned no data or error', 'color: red');
                }
                resolve(data);
            })
            .catch(error => {
                console.error('%c❌ Error loading carryover utang:', 'color: red', error);
                reject(error);
            });
    });
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Toggle sidebar
    document.getElementById('btnToggleSidebar')?.addEventListener('click', toggleSidebar);
    
    // Action buttons
    document.getElementById('newDTRBtn')?.addEventListener('click', () => openDTRModal());
    document.getElementById('batchApproveBtn')?.addEventListener('click', batchApprove);
    document.getElementById('exportCutoffBtn')?.addEventListener('click', exportCutoff);
    document.getElementById('refreshBtn')?.addEventListener('click', refreshData);
    document.getElementById('addAdminBtn')?.addEventListener('click', openAddAdminModal);
    document.getElementById('manageAdminsBtn')?.addEventListener('click', openManageAdminsModal);
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDeleteAdmin);
    
    // Filters
    document.getElementById('employeeFilter')?.addEventListener('change', loadDTRRecords);
    document.getElementById('cutoffFilter')?.addEventListener('change', loadDTRRecords);
    document.getElementById('statusFilter')?.addEventListener('change', loadDTRRecords);
    
    // Select all checkbox
    document.getElementById('selectAll')?.addEventListener('change', toggleSelectAll);
    
    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    
    // Form submission
    document.getElementById('dtrForm')?.addEventListener('submit', saveDTR);
    document.getElementById('addAdminForm')?.addEventListener('submit', saveAdmin);
    document.getElementById('editAdminForm')?.addEventListener('submit', updateAdmin);
    
    // Calculate button
    document.getElementById('calculateBtn')?.addEventListener('click', calculateAll);
    
    // Employee selection change
    document.getElementById('employeeId')?.addEventListener('change', loadEmployeeRates);
    document.getElementById('cutoffSelect')?.addEventListener('change', generateDTRGrid);
    
    // Deduction inputs
    ['sssDeduction', 'philhealthDeduction', 'pagibigDeduction', 'otherDeductions', 'bayadUtang'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateNetTotal);
    });
    
    // Add payment button
    document.getElementById('addPaymentBtn')?.addEventListener('click', openPaymentModal);
    
    // Approve/Paid buttons
    document.getElementById('approveBtn')?.addEventListener('click', approveDTR);
    document.getElementById('markPaidBtn')?.addEventListener('click', markAsPaid);
    
    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));
    
    // Rate type change in add admin
    document.getElementById('rateType')?.addEventListener('change', handleRateTypeChange);
    document.getElementById('editRateType')?.addEventListener('change', handleEditRateTypeChange);
    
    // Admin edit button
    document.getElementById('editAdminInfoBtn')?.addEventListener('click', openEditAdminModal);

    setupCutoffListener();
}

// ==================== Sidebar ====================
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    document.querySelector('.content').classList.toggle('expanded');
}

// ==================== Data Loading ====================
function loadEmployees() {
    fetch('/api/admin-salary/employees')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const employeeSelect = document.getElementById('employeeId');
                const employeeFilter = document.getElementById('employeeFilter');
                
                employeeSelect.innerHTML = '<option value="">— Select Employee —</option>';
                employeeFilter.innerHTML = '<option value="all">All Employees</option>';
                
                data.data.forEach(emp => {
                    if (emp.status === 'active') {
                        employeeSelect.innerHTML += `<option value="${emp.id}">${emp.name} - ${emp.position}</option>`;
                        employeeFilter.innerHTML += `<option value="${emp.id}">${emp.name}</option>`;
                    }
                });
            }
        });
}

function loadCutoffs() {
    fetch('/api/admin-salary/cutoffs')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const cutoffSelect = document.getElementById('cutoffSelect');
                const cutoffFilter = document.getElementById('cutoffFilter');
                
                cutoffSelect.innerHTML = '<option value="">— Select Cutoff —</option>';
                cutoffFilter.innerHTML = '<option value="all">All Cutoffs</option>';
                
                const periods = Array.isArray(data.data) ? data.data : [data.data];
                
                periods.forEach(period => {
                    if (period['1st_half']) {
                        cutoffSelect.innerHTML += `<option value="${period['1st_half'].name}">${period['1st_half'].name}</option>`;
                        cutoffFilter.innerHTML += `<option value="${period['1st_half'].name}">${period['1st_half'].name}</option>`;
                    }
                    if (period['2nd_half']) {
                        cutoffSelect.innerHTML += `<option value="${period['2nd_half'].name}">${period['2nd_half'].name}</option>`;
                        cutoffFilter.innerHTML += `<option value="${period['2nd_half'].name}">${period['2nd_half'].name}</option>`;
                    }
                });
            }
        });
}

function loadDTRRecords() {
    const employee = document.getElementById('employeeFilter').value;
    const cutoff = document.getElementById('cutoffFilter').value;
    const status = document.getElementById('statusFilter').value;
    
    const params = new URLSearchParams({
        adminId: employee,
        cutoff: cutoff,
        status: status,
        page: currentPage,
        limit: 10
    });
    
    fetch(`/api/admin-salary/records?${params.toString()}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                renderDTRTable(data.data);
                totalPages = data.total_pages;
                updatePagination();
                document.getElementById('recordCount').textContent = `${data.total} records`;
            }
        });
}

function loadSummary() {
    fetch('/api/admin-salary/summary')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                document.getElementById('activeEmployees').textContent = data.data.activeEmployees;
                document.getElementById('pendingApproval').textContent = data.data.pendingApproval;
                document.getElementById('pendingPayment').textContent = data.data.pendingPayment;
                document.getElementById('currentPayroll').textContent = `₱${data.data.currentPayroll.toLocaleString()}`;
                document.getElementById('currentCutoff').textContent = data.data.currentCutoff;
            }
        });
}

function loadEmployeeRates() {
    return new Promise((resolve, reject) => {
        const adminId = document.getElementById('employeeId').value;
        if (!adminId) {
            resolve();
            return;
        }
        
        fetch(`/api/admin-salary/employees/${adminId}/rates`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    currentDTR.adminId = adminId;
                    currentDTR.dailyRate = data.data.dailyRate || 620;
                    currentDTR.hourlyRate = (currentDTR.dailyRate / 9) || 68.89;
                    currentDTR.otRate = 70;
                    currentDTR.nightDiffRate = 10;
                    
                    currentDTR.employeeSSS = data.data.sss || 0;
                    currentDTR.employeePhilhealth = data.data.philhealth || 0;
                    currentDTR.employeePagibig = data.data.pagibig || 0;
                    
                    console.log('Rates loaded:', {
                        dailyRate: currentDTR.dailyRate,
                        hourlyRate: currentDTR.hourlyRate,
                        otRate: currentDTR.otRate,
                        nightDiffRate: currentDTR.nightDiffRate,
                        sss: currentDTR.employeeSSS,
                        philhealth: currentDTR.employeePhilhealth,
                        pagibig: currentDTR.employeePagibig
                    });
                }
                resolve();
            })
            .catch(error => {
                console.error('Error loading employee rates:', error);
                reject(error);
            });
    });
}

// ==================== Time Calculation Functions ====================

function parseTime(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

function calculateHours(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    
    if (!start || !end) return 0;
    
    let minutes = end.totalMinutes - start.totalMinutes;
    
    // Handle overnight shifts (end time is next day)
    if (minutes < 0) {
        minutes += 24 * 60;
    }
    
    return minutes / 60;
}

function calculateOT(startTime, endTime) {
    const totalHours = calculateHours(startTime, endTime);
    
    // Standard work day is 9 hours
    // OT is any hours beyond 9
    if (totalHours > 9) {
        const otHours = totalHours - 9;
        return Math.round(otHours * 10) / 10;
    }
    return 0;
}

function calculateRegularPay(startTime, endTime, status) {
    if (status !== 'present') return 0;
    if (!startTime || !endTime) return 0;
    
    const totalHours = calculateHours(startTime, endTime);
    
    // Regular pay is daily rate for up to 9 hours
    // If less than 9 hours, pay is prorated based on hourly rate (dailyRate / 9)
    const hourlyRate = currentDTR.dailyRate / 9;
    const regularHours = Math.min(totalHours, 9);
    
    return regularHours * hourlyRate;
}

function calculateNightDiff(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    
    if (!start || !end) return 0;
    
    // Night differential hours: 10:00 PM (22:00) to 6:00 AM (6:00)
    const NIGHT_START = 22; // 10 PM
    const NIGHT_END = 6; // 6 AM
    
    let startHour = start.hours;
    let startMinute = start.minutes;
    let endHour = end.hours;
    let endMinute = end.minutes;
    
    // Convert to decimal hours
    let startDecimal = startHour + startMinute / 60;
    let endDecimal = endHour + endMinute / 60;
    
    // Handle overnight shifts
    if (endDecimal <= startDecimal) {
        endDecimal += 24;
    }
    
    let nightDiffHours = 0;
    
    // Check each hour segment for night differential
    for (let hour = Math.floor(startDecimal); hour < Math.ceil(endDecimal); hour++) {
        let currentHour = hour % 24;
        
        // Check if this hour falls within night diff period (10 PM to 6 AM)
        if (currentHour >= NIGHT_START || currentHour < NIGHT_END) {
            // Calculate overlap with this hour
            let segmentStart = Math.max(startDecimal, hour);
            let segmentEnd = Math.min(endDecimal, hour + 1);
            if (segmentEnd > segmentStart) {
                nightDiffHours += (segmentEnd - segmentStart);
            }
        }
    }
    
    return Math.round(nightDiffHours * 10) / 10;
}

function calculateNightDiffPay(startTime, endTime) {
    const nightDiffHours = calculateNightDiff(startTime, endTime);
    // Night differential pay is ₱10 per hour
    return nightDiffHours * currentDTR.nightDiffRate;
}

function calculateOTPay(startTime, endTime) {
    const otHours = calculateOT(startTime, endTime);
    // Overtime pay is ₱70 per hour
    return otHours * currentDTR.otRate;
}

function calculateDailyGross(startTime, endTime, status) {
    if (status !== 'present') return 0;
    if (!startTime || !endTime) return 0;
    
    const regularPay = calculateRegularPay(startTime, endTime, status);
    const otPay = calculateOTPay(startTime, endTime);
    const nightDiffPay = calculateNightDiffPay(startTime, endTime);
    
    return regularPay + otPay + nightDiffPay;
}

// ==================== DTR Grid ====================
function generateDTRGrid() {
    console.log('%c📊 GENERATING DTR GRID', 'color: purple; font-weight: bold');
    console.log('Current cutoff:', document.getElementById('cutoffSelect').value);
    console.log('Current adminId:', currentDTR.adminId);
    console.log('Current transactions:', currentDTR.transactions);
    
    const cutoff = document.getElementById('cutoffSelect').value;
    if (!cutoff) {
        console.log('No cutoff selected, skipping grid generation');
        return;
    }
    
    currentDTR.cutoff = cutoff;
    
    // Parse cutoff to get dates
    const cutoffParts = cutoff.split(' - ');
    const monthYear = cutoffParts[0].split(' ');
    const month = monthYear[0];
    const year = parseInt(monthYear[1]);
    const period = cutoffParts[1];
    
    let startDay = 1;
    let endDay = 15;
    
    if (period === '2nd Half') {
        startDay = 16;
        const lastDay = new Date(year, getMonthNumber(month) + 1, 0).getDate();
        endDay = lastDay;
    }
    
    // Update deduction fields based on cutoff
    if (currentDTR.adminId) {
        if (isSecondHalfCutoff(cutoff)) {
            // Apply deductions for 2nd cutoff
            document.getElementById('sssDeduction').value = currentDTR.employeeSSS || 0;
            document.getElementById('philhealthDeduction').value = currentDTR.employeePhilhealth || 0;
            document.getElementById('pagibigDeduction').value = currentDTR.employeePagibig || 0;
        } else {
            // Set to 0 for 1st cutoff
            document.getElementById('sssDeduction').value = 0;
            document.getElementById('philhealthDeduction').value = 0;
            document.getElementById('pagibigDeduction').value = 0;
        }
        calculateNetTotal();
    }
    
    // Generate grid rows
    const tbody = document.getElementById('dtrGridBody');
    let html = '';
    
    for (let day = startDay; day <= endDay; day++) {
        const date = `${year}-${String(getMonthNumber(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
        
        const entry = currentDTR.entries[date] || {};
        
        html += `
            <tr data-date="${date}">
                <td>${month} ${day}, ${year}</td>
                <td>${dayName}</td>
                <td><input type="time" class="time-in" value="${entry.timeIn || ''}" onchange="updateDTRRow('${date}')"></td>
                <td><input type="time" class="time-out" value="${entry.timeOut || ''}" onchange="updateDTRRow('${date}')"></td>
                <td><input type="number" class="ot-hours" step="0.5" min="0" value="${entry.ot || 0}" readonly style="background-color:#f0f0f0;"></td>
                <td><input type="number" class="night-diff" step="0.5" min="0" value="${entry.nightDiff || 0}" readonly style="background-color:#f0f0f0;"></td>
                <td><input type="number" class="advance" step="0.01" min="0" value="${entry.advance || 0}" onchange="updateAdvance('${date}', this.value)"></td>
                <td>
                    <select class="status" onchange="updateDTRRow('${date}')">
                        <option value="present" ${entry.status === 'present' ? 'selected' : ''}>Present</option>
                        <option value="absent" ${entry.status === 'absent' ? 'selected' : ''}>Absent</option>
                        <option value="leave" ${entry.status === 'leave' ? 'selected' : ''}>Leave</option>
                        <option value="holiday" ${entry.status === 'holiday' ? 'selected' : ''}>Holiday</option>
                    </select>
                </td>
                <td><button type="button" class="btn-sm btn-danger" onclick="clearDTRRow('${date}')"><i class="fas fa-times"></i></button></td>
            </tr>
        `;
    }

    console.log('Grid generated with', Object.keys(currentDTR.entries).length, 'entries');
    console.log('Transactions to display:', currentDTR.transactions);
    
    tbody.innerHTML = html;
    renderTransactionsList();
}

function updateAdvance(date, amount) {
    const advanceAmount = parseFloat(amount) || 0;
    
    // Ensure transactions.list exists
    if (!currentDTR.transactions.list) {
        currentDTR.transactions.list = {};
    }
    
    // Check if this advance already exists in transactions
    const existingTransactionId = Object.keys(currentDTR.transactions.list).find(id => 
        currentDTR.transactions.list[id]?.date === date && 
        currentDTR.transactions.list[id]?.type === 'utang'
    );
    
    if (existingTransactionId) {
        // Update existing transaction
        const oldAmount = currentDTR.transactions.list[existingTransactionId].amount;
        const difference = advanceAmount - oldAmount;
        
        if (advanceAmount > 0) {
            currentDTR.transactions.list[existingTransactionId].amount = advanceAmount;
        } else {
            delete currentDTR.transactions.list[existingTransactionId];
        }
        
        // Update totals
        currentDTR.transactions.totalUtang = (currentDTR.transactions.totalUtang || 0) + difference;
    } else if (advanceAmount > 0) {
        // Add new transaction
        const transactionId = Date.now().toString();
        currentDTR.transactions.list[transactionId] = {
            id: transactionId,
            date: date,
            amount: advanceAmount,
            type: 'utang',
            description: `Advance for ${date}`
        };
        currentDTR.transactions.totalUtang = (currentDTR.transactions.totalUtang || 0) + advanceAmount;
    }
    
    // Update balance (just for display, not for deduction)
    currentDTR.transactions.totalPaid = currentDTR.transactions.totalPaid || 0;
    currentDTR.transactions.balanceUtang = (currentDTR.transactions.totalUtang || 0) - (currentDTR.transactions.totalPaid || 0);
    
    // Update the entry
    if (currentDTR.entries[date]) {
        currentDTR.entries[date].advance = advanceAmount;
    }
    
    updateTransactionDisplay();
    updateDTRRow(date);
}

function openPaymentModal() {
    if (!document.getElementById('recordId').value) {
        Swal.fire({
            icon: 'warning',
            title: 'Save First',
            text: 'Please save the DTR record first before adding payments.'
        });
        return;
    }
    
    Swal.fire({
        title: 'Add Payment',
        html: `
            <div style="text-align: left;">
                <div class="form-group">
                    <label>Amount to Pay</label>
                    <input type="number" id="paymentAmount" class="swal2-input" step="0.01" min="0" placeholder="Enter amount">
                </div>
                <div class="form-group">
                    <label>Description (Optional)</label>
                    <input type="text" id="paymentDescription" class="swal2-input" placeholder="Payment description">
                </div>
                <div class="form-group">
                    <label>Current Balance: ₱${currentDTR.transactions.balanceUtang.toLocaleString()}</label>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Add Payment',
        preConfirm: () => {
            const amount = document.getElementById('paymentAmount').value;
            if (!amount || parseFloat(amount) <= 0) {
                Swal.showValidationMessage('Please enter a valid amount');
                return false;
            }
            return {
                amount: parseFloat(amount),
                description: document.getElementById('paymentDescription').value
            };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            addPayment(result.value.amount, result.value.description);
        }
    });
}

function addPayment(amount, description) {
    const transactionId = Date.now().toString();
    const today = new Date().toISOString().split('T')[0];
    
    console.log('Adding payment:', {amount, description});
    
    // Ensure transactions.list exists
    if (!currentDTR.transactions.list) {
        currentDTR.transactions.list = {};
    }
    
    // Add the payment transaction
    currentDTR.transactions.list[transactionId] = {
        id: transactionId,
        date: today,
        amount: amount,
        type: 'payment',
        description: description || `Payment made on ${today}`
    };
    
    // Update totals
    currentDTR.transactions.totalPaid = (currentDTR.transactions.totalPaid || 0) + amount;
    currentDTR.transactions.balanceUtang = currentDTR.transactions.totalUtang - currentDTR.transactions.totalPaid;
    
    console.log('Updated transactions after payment:', currentDTR.transactions);
    
    // Update display
    updateTransactionDisplay();
    calculateNetTotal();
    
    Swal.fire({
        icon: 'success',
        title: 'Payment Added',
        text: `₱${amount.toLocaleString()} payment recorded`,
        timer: 1500,
        showConfirmButton: false
    });
}

function deleteTransaction(transactionId) {
    Swal.fire({
        title: 'Delete Transaction?',
        text: 'This action cannot be undone',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        confirmButtonText: 'Yes, Delete'
    }).then((result) => {
        if (result.isConfirmed) {
            // Ensure transactions.list exists
            if (!currentDTR.transactions.list) {
                currentDTR.transactions.list = {};
            }
            
            const transaction = currentDTR.transactions.list[transactionId];
            if (transaction) {
                if (transaction.type === 'utang') {
                    currentDTR.transactions.totalUtang = (currentDTR.transactions.totalUtang || 0) - transaction.amount;
                    // Also remove from daily entry
                    Object.keys(currentDTR.entries).forEach(date => {
                        if (currentDTR.entries[date] && 
                            currentDTR.entries[date].advance === transaction.amount && 
                            currentDTR.entries[date].advance > 0) {
                            currentDTR.entries[date].advance = 0;
                            // Update the input field if visible
                            const row = document.querySelector(`tr[data-date="${date}"]`);
                            if (row) {
                                const advanceInput = row.querySelector('.advance');
                                if (advanceInput) advanceInput.value = 0;
                            }
                        }
                    });
                } else if (transaction.type === 'payment') {
                    currentDTR.transactions.totalPaid = (currentDTR.transactions.totalPaid || 0) - transaction.amount;
                }
                
                delete currentDTR.transactions.list[transactionId];
                currentDTR.transactions.balanceUtang = (currentDTR.transactions.totalUtang || 0) - (currentDTR.transactions.totalPaid || 0);
                
                updateTransactionDisplay();
                calculateNetTotal();
                
                Swal.fire('Deleted!', 'Transaction deleted', 'success');
            }
        }
    });
}

function updateTransactionDisplay() {
    // Update summary fields in Salary Summary section
    const totalUtang = currentDTR.transactions.totalUtang || 0;
    const bayadUtang = currentDTR.transactions.totalPaid || 0;
    const remainingUtang = totalUtang - bayadUtang;
    
    // Update Salary Summary fields
    document.getElementById('totalUtangDisplay').textContent = `₱${totalUtang.toLocaleString()}`;
    document.getElementById('bayadUtang').value = bayadUtang;
    document.getElementById('remainingUtang').textContent = `₱${remainingUtang.toLocaleString()}`;
    
    // Update transaction summary cards
    document.getElementById('totalUtang').textContent = `₱${totalUtang.toLocaleString()}`;
    document.getElementById('totalPaid').textContent = `₱${bayadUtang.toLocaleString()}`;
    document.getElementById('balanceUtang').textContent = `₱${remainingUtang.toLocaleString()}`;
    
    renderTransactionsList();
    calculateNetTotal();
}

function renderTransactionsList() {
    const tbody = document.getElementById('transactionsListBody');
    if (!tbody) return;
    
    const transactions = currentDTR.transactions.list || {};
    
    if (Object.keys(transactions).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No transactions</td></tr>';
        return;
    }
    
    let html = '';
    Object.values(transactions).forEach(trans => {
        const rowClass = trans.type === 'utang' ? 'utang-row' : 'payment-row';
        html += `
            <tr class="${rowClass}">
                <td>${trans.date}</td>
                <td>${trans.type === 'utang' ? 'UTANG (Advance)' : 'BAYAD UTANG'}</td>
                <td>₱${trans.amount.toLocaleString()}</td>
                <td>${trans.description || '—'}</td>
                <td><button class="btn-sm btn-danger" onclick="deleteTransaction('${trans.id}')"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

function updateDTRRow(date) {
    const row = document.querySelector(`tr[data-date="${date}"]`);
    if (!row) return;
    
    const timeIn = row.querySelector('.time-in')?.value || '';
    const timeOut = row.querySelector('.time-out')?.value || '';
    const status = row.querySelector('.status')?.value || 'present';
    const advance = parseFloat(row.querySelector('.advance')?.value) || 0;
    
    let ot = 0;
    let nightDiff = 0;
    
    if (status === 'present' && timeIn && timeOut) {
        ot = calculateOT(timeIn, timeOut);
        nightDiff = calculateNightDiff(timeIn, timeOut);
        
        // Update the input fields with calculated values
        row.querySelector('.ot-hours').value = ot;
        row.querySelector('.night-diff').value = nightDiff;
    } else {
        row.querySelector('.ot-hours').value = 0;
        row.querySelector('.night-diff').value = 0;
    }
    
    currentDTR.entries[date] = {
        date: date,
        timeIn: timeIn,
        timeOut: timeOut,
        ot: ot,
        nightDiff: nightDiff,
        advance: advance,
        status: status
    };
    
    calculateTotals();
}

function clearDTRRow(date) {
    const row = document.querySelector(`tr[data-date="${date}"]`);
    if (!row) return;
    
    // Ensure transactions.list exists
    if (!currentDTR.transactions.list) {
        currentDTR.transactions.list = {};
    }
    
    // Remove advance from transactions if exists
    const advanceAmount = parseFloat(row.querySelector('.advance')?.value) || 0;
    if (advanceAmount > 0) {
        const transactionId = Object.keys(currentDTR.transactions.list).find(id => 
            currentDTR.transactions.list[id]?.date === date && 
            currentDTR.transactions.list[id]?.type === 'utang' &&
            currentDTR.transactions.list[id]?.amount === advanceAmount
        );
        if (transactionId) {
            delete currentDTR.transactions.list[transactionId];
            currentDTR.transactions.totalUtang = (currentDTR.transactions.totalUtang || 0) - advanceAmount;
            currentDTR.transactions.balanceUtang = (currentDTR.transactions.totalUtang || 0) - (currentDTR.transactions.totalPaid || 0);
            updateTransactionDisplay();
        }
    }
    
    row.querySelector('.time-in').value = '';
    row.querySelector('.time-out').value = '';
    row.querySelector('.ot-hours').value = 0;
    row.querySelector('.night-diff').value = 0;
    row.querySelector('.advance').value = 0;
    row.querySelector('.status').value = 'present';
    
    delete currentDTR.entries[date];
    calculateTotals();
}

function calculateTotals() {
    let totalOT = 0;
    let totalNightDiff = 0;
    let totalAdvances = 0;
    
    Object.values(currentDTR.entries).forEach(entry => {
        if (entry.status === 'present') {
            totalOT += entry.ot || 0;
            totalNightDiff += entry.nightDiff || 0;
            totalAdvances += entry.advance || 0;
        }
    });
    
    document.getElementById('totalOT').textContent = totalOT.toFixed(1);
    document.getElementById('totalNightDiff').textContent = totalNightDiff.toFixed(1);
    document.getElementById('totalAdvances').textContent = `₱${totalAdvances.toLocaleString()}`;
    
    calculateGrossSalary();
}

function calculateGrossSalary() {
    let totalGross = 0;
    
    Object.values(currentDTR.entries).forEach(entry => {
        if (entry.status === 'present') {
            const dailyGross = calculateDailyGross(entry.timeIn, entry.timeOut, entry.status);
            totalGross += dailyGross;
        }
    });
    
    document.getElementById('grossSalary').textContent = `₱${totalGross.toLocaleString()}`;
    
    calculateNetTotal();
}

function calculateNetTotal() {
    const grossText = document.getElementById('grossSalary').textContent;
    const gross = parseFloat(grossText.replace('₱', '').replace(/,/g, '')) || 0;
    
    // ONLY Bayad Utang (payment made this cutoff) is deducted from gross salary
    const bayadUtang = parseFloat(document.getElementById('bayadUtang').value) || 0;
    const otherDeductions = parseFloat(document.getElementById('otherDeductions').value) || 0;
    const sss = parseFloat(document.getElementById('sssDeduction').value) || 0;
    const philhealth = parseFloat(document.getElementById('philhealthDeduction').value) || 0;
    const pagibig = parseFloat(document.getElementById('pagibigDeduction').value) || 0;
    
    // Total deductions = bayadUtang (payment made this cutoff) + other deductions + government deductions
    const totalDeductions = bayadUtang + otherDeductions + sss + philhealth + pagibig;
    const netTotal = gross - totalDeductions;
    
    // Update remaining utang display (just for info, not deducted from gross)
    const totalUtang = currentDTR.transactions.totalUtang || 0;
    const remainingUtang = totalUtang - bayadUtang;
    document.getElementById('remainingUtang').textContent = `₱${remainingUtang.toLocaleString()}`;
    document.getElementById('netTotal').textContent = `₱${netTotal.toLocaleString()}`;
}

function calculateAll() {
    // Trigger recalculation for all rows
    Object.keys(currentDTR.entries).forEach(date => {
        updateDTRRow(date);
    });
    
    Swal.fire({
        icon: 'success',
        title: 'Calculated',
        text: 'Salary calculations updated',
        timer: 1500,
        showConfirmButton: false
    });
}

function openDTRModal(recordId = null) {
    // If recordId is an event object (from click), set it to null
    if (recordId && typeof recordId === 'object' && recordId.target) {
        recordId = null;
    }
    
    const modal = document.getElementById('dtrModal');
    
    if (!recordId) {
        // Reset modal title and buttons
        document.getElementById('modalTitle').textContent = 'New DTR Record';
        document.getElementById('recordId').value = '';
        document.getElementById('approveBtn').style.display = 'none';
        document.getElementById('markPaidBtn').style.display = 'none';
        document.getElementById('saveDTRBtn').style.display = 'inline-block';
        
        // Reset the form
        document.getElementById('dtrForm').reset();
        
        // Reset select elements to empty values
        const employeeSelect = document.getElementById('employeeId');
        const cutoffSelect = document.getElementById('cutoffSelect');
        
        if (employeeSelect) employeeSelect.value = '';
        if (cutoffSelect) cutoffSelect.value = '';
        
        // Reset currentDTR object to initial state
        currentDTR = {
            adminId: null,
            cutoff: null,
            entries: {},
            dailyRate: 620,
            hourlyRate: 68.89,
            otRate: 70,
            nightDiffRate: 10,
            employeeSSS: 0,
            employeePhilhealth: 0,
            employeePagibig: 0,
            transactions: {
                totalUtang: 0,
                totalPaid: 0,
                balanceUtang: 0,
                list: {}
            }
        };
        
        // Clear the DTR grid
        const gridBody = document.getElementById('dtrGridBody');
        if (gridBody) gridBody.innerHTML = '';
        
        // Reset all display fields
        document.getElementById('totalOT').textContent = '0';
        document.getElementById('totalNightDiff').textContent = '0';
        document.getElementById('totalAdvances').textContent = '₱0';
        document.getElementById('grossSalary').textContent = '₱0';
        document.getElementById('totalUtangDisplay').textContent = '₱0';
        document.getElementById('bayadUtang').value = 0;
        document.getElementById('remainingUtang').textContent = '₱0';
        document.getElementById('totalUtang').textContent = '₱0';
        document.getElementById('totalPaid').textContent = '₱0';
        document.getElementById('balanceUtang').textContent = '₱0';
        document.getElementById('sssDeduction').value = 0;
        document.getElementById('philhealthDeduction').value = 0;
        document.getElementById('pagibigDeduction').value = 0;
        document.getElementById('otherDeductions').value = 0;
        document.getElementById('netTotal').textContent = '₱0';
        
        // Clear transactions list
        renderTransactionsList();
        
        // Remove existing event listeners by cloning and replacing the selects
        const newEmployeeSelect = employeeSelect.cloneNode(true);
        const newCutoffSelect = cutoffSelect.cloneNode(true);
        employeeSelect.parentNode.replaceChild(newEmployeeSelect, employeeSelect);
        cutoffSelect.parentNode.replaceChild(newCutoffSelect, cutoffSelect);
        
        // Store references to the new elements
        const updatedEmployeeSelect = document.getElementById('employeeId');
        const updatedCutoffSelect = document.getElementById('cutoffSelect');
        
        // Add fresh event listeners
        updatedEmployeeSelect.addEventListener('change', async function() {
            const adminId = this.value;
            const cutoff = updatedCutoffSelect.value;
            
            console.log('%c👤 Employee selection changed', 'color: blue; font-weight: bold');
            console.log('Selected Admin ID:', adminId);
            console.log('Current Cutoff:', cutoff);
            
            if (adminId) {
                try {
                    console.log('🔄 Loading employee rates...');
                    await loadEmployeeRates();
                    console.log('✅ Employee rates loaded');
                    
                    if (cutoff) {
                        console.log('🔄 Loading carryover utang...');
                        await loadCarryOverUtang(adminId, cutoff);
                        console.log('✅ Carryover utang loaded');
                        console.log('🔄 Generating DTR grid...');
                        generateDTRGrid();
                        console.log('✅ DTR grid generated');
                    }
                } catch (error) {
                    console.error('❌ Error loading data:', error);
                }
            }
        });

        updatedCutoffSelect.addEventListener('change', async function() {
            const cutoff = this.value;
            const adminId = updatedEmployeeSelect.value;
            
            console.log('%c📅 Cutoff selection changed', 'color: blue; font-weight: bold');
            console.log('Selected Cutoff:', cutoff);
            console.log('Current Admin ID:', adminId);
            
            if (adminId && cutoff) {
                try {
                    console.log('🔄 Loading employee rates...');
                    await loadEmployeeRates();
                    console.log('✅ Employee rates loaded');
                    
                    console.log('🔄 Loading carryover utang...');
                    await loadCarryOverUtang(adminId, cutoff);
                    console.log('✅ Carryover utang loaded');
                    
                    console.log('🔄 Generating DTR grid...');
                    generateDTRGrid();
                    console.log('✅ DTR grid generated');
                    
                } catch (error) {
                    console.error('❌ Error loading data:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error Loading Data',
                        text: 'There was an error loading the carryover utang. Please try again.'
                    });
                }
            } else if (cutoff && currentDTR.adminId) {
                console.log('Generating DTR grid with existing admin...');
                generateDTRGrid();
            }
        });
        
    } else {
        // Load existing record
        document.getElementById('approveBtn').style.display = 'inline-block';
        document.getElementById('markPaidBtn').style.display = 'none';
        document.getElementById('saveDTRBtn').style.display = 'inline-block';
        loadDTRRecord(recordId);
    }
    
    modal.style.display = 'block';
}

function loadDTRRecord(recordId) {
    fetch(`/api/admin-salary/records/${recordId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const record = data.data;
                
                document.getElementById('modalTitle').textContent = `DTR: ${record.adminName}`;
                document.getElementById('recordId').value = recordId;
                document.getElementById('employeeId').value = record.adminId;
                document.getElementById('cutoffSelect').value = record.cutoff;
                
                // Store employee deduction values from record
                currentDTR.employeeSSS = record.summary?.sss || 0;
                currentDTR.employeePhilhealth = record.summary?.philhealth || 0;
                currentDTR.employeePagibig = record.summary?.pagibig || 0;
                
                currentDTR = {
                    adminId: record.adminId,
                    cutoff: record.cutoff,
                    entries: record.entries || {},
                    dailyRate: record.dailyRate || 620,
                    hourlyRate: (record.dailyRate || 620) / 9,
                    otRate: 70,
                    nightDiffRate: 10,
                    employeeSSS: record.summary?.sss || 0,
                    employeePhilhealth: record.summary?.philhealth || 0,
                    employeePagibig: record.summary?.pagibig || 0,
                    transactions: record.transactions || {
                        totalUtang: 0,
                        totalPaid: 0,
                        balanceUtang: 0,
                        list: {}
                    }
                };
                
                generateDTRGrid();
                
                if (record.summary) {
                    // Load the stored deduction values
                    document.getElementById('sssDeduction').value = record.summary.sss || 0;
                    document.getElementById('philhealthDeduction').value = record.summary.philhealth || 0;
                    document.getElementById('pagibigDeduction').value = record.summary.pagibig || 0;
                    document.getElementById('otherDeductions').value = record.summary.otherDeductions || 0;
                }
                
                // Load transactions display
                updateTransactionDisplay();
                
                calculateTotals();
                calculateGrossSalary();
                calculateNetTotal();
                
                if (record.status === 'draft') {
                    document.getElementById('approveBtn').style.display = 'inline-block';
                    document.getElementById('markPaidBtn').style.display = 'none';
                    document.getElementById('saveDTRBtn').style.display = 'inline-block';
                } else if (record.status === 'approved') {
                    document.getElementById('approveBtn').style.display = 'none';
                    document.getElementById('markPaidBtn').style.display = 'inline-block';
                    document.getElementById('saveDTRBtn').style.display = 'none';
                } else {
                    document.getElementById('approveBtn').style.display = 'none';
                    document.getElementById('markPaidBtn').style.display = 'none';
                    document.getElementById('saveDTRBtn').style.display = 'none';
                }
            }
        });
}

function saveDTR(e) {
    e.preventDefault();
    
    const adminId = document.getElementById('employeeId').value;
    const cutoff = document.getElementById('cutoffSelect').value;
    const recordId = document.getElementById('recordId').value;
    
    if (!adminId || !cutoff) {
        Swal.fire({ icon: 'error', title: 'Missing Fields', text: 'Please select employee and cutoff' });
        return;
    }
    
    if (Object.keys(currentDTR.entries).length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'No Entries',
            text: 'Please add at least one DTR entry'
        });
        return;
    }
    
    const summary = {
        totalDays: Object.values(currentDTR.entries).filter(e => e.status === 'present').length,
        totalOT: parseFloat(document.getElementById('totalOT').textContent) || 0,
        totalNightDiff: parseFloat(document.getElementById('totalNightDiff').textContent) || 0,
        totalAdvances: currentDTR.transactions.totalUtang,
        grossSalary: parseFloat(document.getElementById('grossSalary').textContent.replace('₱', '').replace(/,/g, '')) || 0,
        otherDeductions: parseFloat(document.getElementById('otherDeductions').value) || 0,
        sss: parseFloat(document.getElementById('sssDeduction').value) || 0,
        philhealth: parseFloat(document.getElementById('philhealthDeduction').value) || 0,
        pagibig: parseFloat(document.getElementById('pagibigDeduction').value) || 0,
        benefitsDeduction: (parseFloat(document.getElementById('sssDeduction').value) || 0) +
                          (parseFloat(document.getElementById('philhealthDeduction').value) || 0) +
                          (parseFloat(document.getElementById('pagibigDeduction').value) || 0),
        netTotal: parseFloat(document.getElementById('netTotal').textContent.replace('₱', '').replace(/,/g, '')) || 0,
        bayadUtang: currentDTR.transactions.totalPaid,
        remainingUtang: currentDTR.transactions.totalUtang - currentDTR.transactions.totalPaid
    };
    
    const formData = {
        adminId: adminId,
        cutoff: cutoff,
        entries: currentDTR.entries,
        summary: summary,
        transactions: currentDTR.transactions,
        dailyRate: currentDTR.dailyRate
    };
    
    const url = recordId ? `/api/admin-salary/records/${recordId}` : '/api/admin-salary/records';
    const method = recordId ? 'PUT' : 'POST';
    
    Swal.fire({
        title: 'Saving...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Saved!',
                text: 'DTR record saved successfully',
                timer: 1500,
                showConfirmButton: false
            });
            
            closeAllModals();
            loadDTRRecords();
            loadSummary();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error });
        }
    });
}

function approveDTR() {
    const recordId = document.getElementById('recordId').value;
    if (!recordId) return;
    
    Swal.fire({
        title: 'Approve DTR?',
        text: 'This will mark the record as approved',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3498db',
        confirmButtonText: 'Yes, Approve'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/admin-salary/records/${recordId}/approve`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Approved!', 'DTR record has been approved', 'success');
                    closeAllModals();
                    loadDTRRecords();
                    loadSummary();
                }
            });
        }
    });
}

function markAsPaid() {
    const recordId = document.getElementById('recordId').value;
    if (!recordId) return;
    
    Swal.fire({
        title: 'Mark as Paid',
        text: 'Select payment method',
        input: 'select',
        inputOptions: {
            'bank-transfer': 'Bank Transfer',
            'check': 'Check',
            'cash': 'Cash'
        },
        inputValue: 'bank-transfer',
        showCancelButton: true,
        confirmButtonColor: '#27ae60',
        confirmButtonText: 'Confirm Payment'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/admin-salary/records/${recordId}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentMethod: result.value })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Paid!', 'Payment recorded successfully', 'success');
                    closeAllModals();
                    loadDTRRecords();
                    loadSummary();
                }
            });
        }
    });
}

function deleteDTRRecord(recordId) {
    Swal.fire({
        title: 'Delete Record?',
        text: 'This action cannot be undone',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        confirmButtonText: 'Yes, Delete'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/admin-salary/records/${recordId}`, {
                method: 'DELETE'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Deleted!', 'Record has been deleted', 'success');
                    loadDTRRecords();
                }
            });
        }
    });
}

// ==================== Admin Management ====================
function openAddAdminModal() {
    const modal = document.getElementById('addAdminModal');
    document.getElementById('addAdminForm').reset();
    document.getElementById('effectiveDate').valueAsDate = new Date();
    modal.style.display = 'block';
}

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
        dailyRate: parseFloat(document.getElementById('dailyRate').value) || 620,
        cutoffRate: parseFloat(document.getElementById('cutoffRate').value) || 0,
        monthlyRate: parseFloat(document.getElementById('monthlyRate').value) || 0,
        sss: parseFloat(document.getElementById('adminSSS').value) || 0,
        philhealth: parseFloat(document.getElementById('adminPhilhealth').value) || 0,
        pagibig: parseFloat(document.getElementById('adminPagibig').value) || 0
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
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Admin Added!',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            loadEmployees();
            loadSummary();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error });
        }
    });
}

function viewAdminDetails(adminId) {
    currentAdminId = adminId;
    
    fetch(`/api/admin-salary/employees/${adminId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const admin = data.data;
                const container = document.getElementById('adminInfoContainer');
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Full Name:</span>
                        <span class="detail-value">${escapeHtml(admin.name)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email:</span>
                        <span class="detail-value">${escapeHtml(admin.email || 'N/A')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Position:</span>
                        <span class="detail-value">${escapeHtml(admin.position || 'N/A')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Department:</span>
                        <span class="detail-value">${escapeHtml(admin.department || 'N/A')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Daily Rate:</span>
                        <span class="detail-value">₱${(admin.dailyRate || 620).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Hourly Rate:</span>
                        <span class="detail-value">₱${((admin.dailyRate || 620) / 9).toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">OT Rate:</span>
                        <span class="detail-value">₱70/hr (beyond 9 hours)</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Night Diff Rate:</span>
                        <span class="detail-value">₱10/hr (10PM - 6AM)</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">SSS:</span>
                        <span class="detail-value">₱${(admin.sss || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">PhilHealth:</span>
                        <span class="detail-value">₱${(admin.philhealth || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">PAGIBIG:</span>
                        <span class="detail-value">₱${(admin.pagibig || 0).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge status-${admin.status || 'active'}">${(admin.status || 'active').toUpperCase()}</span></span>
                    </div>
                `;
                
                loadSalaryHistory(adminId);
                document.getElementById('adminDetailsModal').style.display = 'block';
            }
        });
}

function loadSalaryHistory(adminId) {
    fetch(`/api/admin-salary/history/${adminId}`)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('salaryHistoryBody');
            if (data.success && data.data.length > 0) {
                let html = '';
                data.data.forEach(record => {
                    const statusClass = `status-${record.status}`;
                    html += `
                        <tr>
                            <td>${record.cutoff || 'N/A'}</td>
                            <td>₱${(record.grossSalary || 0).toLocaleString()}</td>
                            <td>₱${(record.netTotal || 0).toLocaleString()}</td>
                            <td><span class="status-badge ${statusClass}">${(record.status || 'draft').toUpperCase()}</span></td>
                            <td>${record.paidAt ? new Date(record.paidAt).toLocaleDateString() : record.approvedAt ? new Date(record.approvedAt).toLocaleDateString() : '—'}</td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center">No salary history found</td></tr>';
            }
        });
}

function openEditAdminModal() {
    if (!currentAdminId) return;
    
    fetch(`/api/admin-salary/employees/${currentAdminId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const admin = data.data;
                
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
                document.getElementById('editRateType').value = admin.rateType || 'daily';
                document.getElementById('editEffectiveDate').value = admin.effectiveDate || '';
                document.getElementById('editAdminSSS').value = admin.sss || 0;
                document.getElementById('editAdminPhilhealth').value = admin.philhealth || 0;
                document.getElementById('editAdminPagibig').value = admin.pagibig || 0;
                
                handleEditRateTypeChange();
                
                document.getElementById('editDailyRate').value = admin.dailyRate || 620;
                document.getElementById('editCutoffRate').value = admin.cutoffRate || 0;
                document.getElementById('editMonthlyRate').value = admin.monthlyRate || 0;
                
                document.getElementById('adminDetailsModal').style.display = 'none';
                document.getElementById('editAdminModal').style.display = 'block';
            }
        });
}

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
        dailyRate: parseFloat(document.getElementById('editDailyRate').value) || 620,
        cutoffRate: parseFloat(document.getElementById('editCutoffRate').value) || 0,
        monthlyRate: parseFloat(document.getElementById('editMonthlyRate').value) || 0,
        sss: parseFloat(document.getElementById('editAdminSSS').value) || 0,
        philhealth: parseFloat(document.getElementById('editAdminPhilhealth').value) || 0,
        pagibig: parseFloat(document.getElementById('editAdminPagibig').value) || 0
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
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Admin Updated!',
                timer: 2000,
                showConfirmButton: false
            });
            closeAllModals();
            if (currentAdminId) {
                setTimeout(() => viewAdminDetails(currentAdminId), 500);
            }
            loadEmployees();
        }
    });
}

// ==================== Manage Admins Functions ====================

function openManageAdminsModal() {
    const modal = document.getElementById('manageAdminsModal');
    loadAllAdminsList();
    modal.style.display = 'block';
}

function loadAllAdminsList() {
    fetch('/api/admin-salary/employees/all')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                renderAdminsList(data.data);
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error });
            }
        })
        .catch(error => {
            console.error('Error loading admins:', error);
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to load admins' });
        });
}

function renderAdminsList(admins) {
    const tbody = document.getElementById('manageAdminsTableBody');
    if (!tbody) return;
    
    if (!admins || admins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No admins found</td></tr>';
        return;
    }
    
    let html = '';
    admins.forEach(admin => {
        const statusClass = `status-${admin.status || 'active'}`;
        const statusText = (admin.status || 'active').toUpperCase();
        
        html += `
            <tr data-admin-id="${admin.id}">
                <td><strong>${escapeHtml(admin.name)}</strong><br><small>${escapeHtml(admin.email || 'No email')}</small></td>
                <td>${escapeHtml(admin.position || 'N/A')}</td>
                <td>${escapeHtml(admin.department || 'N/A')}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td class="actions-cell">
                    <button class="action-btn action-view" onclick="viewAdminFromList('${admin.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn action-edit" onclick="editAdminFromList('${admin.id}')" title="Edit Admin">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn action-delete" onclick="deleteAdminFromList('${admin.id}', '${escapeHtml(admin.name)}')" title="Delete Admin">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

function viewAdminFromList(adminId) {
    closeAllModals();
    viewAdminDetails(adminId);
}

function editAdminFromList(adminId) {
    currentAdminId = adminId;
    closeAllModals();
    openEditAdminModal();
}

function deleteAdminFromList(adminId, adminName) {
    const modal = document.getElementById('deleteAdminModal');
    const detailsDiv = document.getElementById('deleteAdminDetails');
    
    detailsDiv.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Name:</span>
            <span class="detail-value">${adminName}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">ID:</span>
            <span class="detail-value">${adminId}</span>
        </div>
    `;
    
    // Store adminId for confirmation
    modal.setAttribute('data-admin-id', adminId);
    modal.style.display = 'block';
}

function confirmDeleteAdmin() {
    const modal = document.getElementById('deleteAdminModal');
    const adminId = modal.getAttribute('data-admin-id');
    
    if (!adminId) return;
    
    Swal.fire({
        title: 'Deleting Admin...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/admin-salary/delete-admin/${adminId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Admin Deleted',
                text: data.message || 'Admin record has been permanently deleted',
                timer: 2000,
                showConfirmButton: false
            });
            
            closeAllModals();
            loadEmployees();
            loadSummary();
            
            // If currently viewing details of deleted admin, close that modal
            if (currentAdminId === adminId) {
                document.getElementById('adminDetailsModal').style.display = 'none';
                currentAdminId = null;
            }
            
            // Refresh the manage admins list if it's open
            const manageModal = document.getElementById('manageAdminsModal');
            if (manageModal.style.display === 'block') {
                loadAllAdminsList();
            }
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error });
        }
    })
    .catch(error => {
        console.error('Error deleting admin:', error);
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to delete admin' });
    });
}

// ==================== Rate Type Handlers ====================
function handleRateTypeChange() {
    const rateType = document.getElementById('rateType').value;
    
    document.getElementById('dailyRateFields').style.display = 'none';
    document.getElementById('cutoffRateFields').style.display = 'none';
    document.getElementById('monthlyRateFields').style.display = 'none';
    
    if (rateType === 'daily') {
        document.getElementById('dailyRateFields').style.display = 'block';
        document.getElementById('dailyRate').required = true;
        document.getElementById('dailyRate').value = 620;
    } else if (rateType === 'cutoff') {
        document.getElementById('cutoffRateFields').style.display = 'block';
        document.getElementById('cutoffRate').required = true;
    } else if (rateType === 'monthly') {
        document.getElementById('monthlyRateFields').style.display = 'block';
        document.getElementById('monthlyRate').required = true;
    }
}

function handleEditRateTypeChange() {
    const rateType = document.getElementById('editRateType').value;
    
    document.getElementById('editDailyRateFields').style.display = 'none';
    document.getElementById('editCutoffRateFields').style.display = 'none';
    document.getElementById('editMonthlyRateFields').style.display = 'none';
    
    if (rateType === 'daily') {
        document.getElementById('editDailyRateFields').style.display = 'block';
        document.getElementById('editDailyRate').required = true;
    } else if (rateType === 'cutoff') {
        document.getElementById('editCutoffRateFields').style.display = 'block';
        document.getElementById('editCutoffRate').required = true;
    } else if (rateType === 'monthly') {
        document.getElementById('editMonthlyRateFields').style.display = 'block';
        document.getElementById('editMonthlyRate').required = true;
    }
}

// ==================== Table Rendering ====================
function renderDTRTable(records) {
    const tbody = document.getElementById('dtrTableBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">No DTR records found</td></tr>';
        return;
    }
    
    let html = '';
    records.forEach(record => {
        const summary = record.summary || {};
        const statusClass = `status-${record.status || 'draft'}`;
        
        html += `
            <tr>
                <td><input type="checkbox" class="record-checkbox" value="${record.id}"></td>
                <td><strong>${escapeHtml(record.adminName)}</strong><br><small>${escapeHtml(record.adminPosition || '')}</small></td>
                <td>${escapeHtml(record.cutoff || '—')}</td>
                <td>${summary.totalDays || 0}</td>
                <td>${(summary.totalOT || 0).toFixed(1)} hrs</td>
                <td>${(summary.totalNightDiff || 0).toFixed(1)} hrs</td>
                <td>₱${(summary.totalAdvances || 0).toLocaleString()}</td>
                <td>₱${(summary.grossSalary || 0).toLocaleString()}</td>
                <td><strong>₱${(summary.netTotal || 0).toLocaleString()}</strong></td>
                <td><span class="status-badge ${statusClass}">${(record.status || 'draft').toUpperCase()}</span></td>
                <td>
                    <button class="action-btn action-view" onclick="openDTRModal('${record.id}')" title="View"><i class="fas fa-eye"></i></button>
                    ${record.status === 'draft' ? 
                        `<button class="action-btn action-edit" onclick="openDTRModal('${record.id}')" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                    <button class="action-btn action-payslip" onclick="viewAdminDetails('${record.adminId}')" title="Admin"><i class="fas fa-user"></i></button>
                    ${record.status === 'draft' ? 
                        `<button class="action-btn action-delete" onclick="deleteDTRRecord('${record.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// ==================== Batch Operations ====================
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll').checked;
    document.querySelectorAll('.record-checkbox').forEach(cb => {
        cb.checked = selectAll;
    });
}

function batchApprove() {
    const selected = [];
    document.querySelectorAll('.record-checkbox:checked').forEach(cb => {
        selected.push(cb.value);
    });
    
    if (selected.length === 0) {
        Swal.fire({ icon: 'warning', title: 'No Selection', text: 'Please select records to approve' });
        return;
    }
    
    Swal.fire({
        title: `Approve ${selected.length} records?`,
        text: 'This will mark all selected DTR records as approved',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, Approve All'
    }).then((result) => {
        if (result.isConfirmed) {
            let approved = 0;
            let failed = 0;
            
            selected.forEach(id => {
                fetch(`/api/admin-salary/records/${id}/approve`, { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) approved++;
                        else failed++;
                        
                        if (approved + failed === selected.length) {
                            Swal.fire({
                                icon: 'success',
                                title: 'Batch Approve Complete',
                                text: `Approved: ${approved}, Failed: ${failed}`
                            });
                            loadDTRRecords();
                        }
                    });
            });
        }
    });
}

function exportCutoff() {
    const options = {};
    document.querySelectorAll('#cutoffFilter option').forEach(opt => {
        if (opt.value !== 'all') {
            options[opt.value] = opt.value;
        }
    });
    
    Swal.fire({
        title: 'Export Cutoff',
        text: 'Select cutoff period to export',
        input: 'select',
        inputOptions: options,
        inputPlaceholder: 'Select cutoff',
        showCancelButton: true,
        confirmButtonText: 'Export'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                icon: 'success',
                title: 'Export Started',
                text: `Exporting ${result.value}`,
                timer: 1500,
                showConfirmButton: false
            });
        }
    });
}

// ==================== Pagination ====================
function updatePagination() {
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
}

function changePage(direction) {
    if (direction === 'prev' && currentPage > 1) {
        currentPage--;
        loadDTRRecords();
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        loadDTRRecords();
    }
}

// ==================== Utility Functions ====================
function getMonthNumber(monthName) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months.indexOf(monthName);
}

function refreshData() {
    Swal.fire({
        title: 'Refreshing...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    setTimeout(() => {
        loadDTRRecords();
        loadSummary();
        Swal.close();
    }, 500);
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function isSecondHalfCutoff(cutoffName) {
    return cutoffName && cutoffName.includes('2nd Half');
}

function setupCutoffListener() {
    const cutoffSelect = document.getElementById('cutoffSelect');
    if (cutoffSelect) {
        cutoffSelect.addEventListener('change', function() {
            if (currentDTR.adminId) {
                const cutoff = this.value;
                if (isSecondHalfCutoff(cutoff)) {
                    // Apply deductions for 2nd cutoff
                    document.getElementById('sssDeduction').value = currentDTR.employeeSSS || 0;
                    document.getElementById('philhealthDeduction').value = currentDTR.employeePhilhealth || 0;
                    document.getElementById('pagibigDeduction').value = currentDTR.employeePagibig || 0;
                } else {
                    // Set to 0 for 1st cutoff
                    document.getElementById('sssDeduction').value = 0;
                    document.getElementById('philhealthDeduction').value = 0;
                    document.getElementById('pagibigDeduction').value = 0;
                }
                calculateNetTotal();
            }
        });
    }
}

// Click outside modal
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};