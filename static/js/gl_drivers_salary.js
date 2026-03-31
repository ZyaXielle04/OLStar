// ==================== Global Variables ====================
let currentPage = 1;
let totalPages = 1;
let currentDriverType = 'main';
let currentCutoff = null;
let currentDriverRecords = [];
let currentDriverDTR = {
    driverId: null,
    driverName: null,
    driverPhone: null,
    cutoff: null,
    entries: {},
    trips: [],
    transactions: {
        totalUtang: 0,
        totalPaid: 0,
        balanceUtang: 0,
        list: {}
    },
    deductions: {
        sss: 0,
        philhealth: 0,
        pagibig: 0,
        otherDeductions: 0
    },
    summary: {
        totalTrips: 0,
        totalDriverRate: 0,
        totalAmount: 0
    }
};
let currentRecordId = null;

// ==================== Document Ready ====================
document.addEventListener('DOMContentLoaded', function() {
    initializePage();
});

function initializePage() {
    loadCutoffs();
    loadSummary();
    setupEventListeners();
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Toggle sidebar
    document.getElementById('btnToggleSidebar')?.addEventListener('click', toggleSidebar);
    
    // Driver type selector
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentDriverType = this.dataset.type;
            if (currentCutoff) {
                loadDriverRecords();
            }
        });
    });
    
    // Cutoff selection change
    document.getElementById('cutoffSelect')?.addEventListener('change', function() {
        currentCutoff = this.value;
        if (currentCutoff) {
            loadDriverRecords();
        } else {
            clearTable();
        }
    });
    
    // Select all checkbox
    document.getElementById('selectAll')?.addEventListener('change', toggleSelectAll);
    
    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    
    // Form submission
    document.getElementById('dtrForm')?.addEventListener('submit', saveDriverDTR);
    
    // Calculate button
    document.getElementById('calculateBtn')?.addEventListener('click', calculateTotals);
    
    // Add payment button
    document.getElementById('addPaymentBtn')?.addEventListener('click', openPaymentModal);
    
    // Deduction inputs
    ['sssDeduction', 'philhealthDeduction', 'pagibigDeduction', 'otherDeductions'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateNetTotal);
    });
    
    // Approve/Paid buttons
    document.getElementById('approveBtn')?.addEventListener('click', approveRecord);
    document.getElementById('markPaidBtn')?.addEventListener('click', markAsPaid);
    
    // Batch approve
    document.getElementById('batchApproveBtn')?.addEventListener('click', batchApprove);
    
    // Export
    document.getElementById('exportCutoffBtn')?.addEventListener('click', exportCutoff);
    
    // Refresh
    document.getElementById('refreshBtn')?.addEventListener('click', refreshData);
    
    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));
}

// ==================== Sidebar ====================
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    document.querySelector('.content').classList.toggle('expanded');
}

// ==================== Data Loading ====================
function loadCutoffs() {
    fetch('/api/driver-dtr/cutoffs')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const cutoffSelect = document.getElementById('cutoffSelect');
                cutoffSelect.innerHTML = '<option value="">— Select Cutoff —</option>';
                
                const periods = Array.isArray(data.data) ? data.data : [data.data];
                
                periods.forEach(period => {
                    if (period['1st_half']) {
                        cutoffSelect.innerHTML += `<option value="${period['1st_half'].name}">${period['1st_half'].name}</option>`;
                    }
                    if (period['2nd_half']) {
                        cutoffSelect.innerHTML += `<option value="${period['2nd_half'].name}">${period['2nd_half'].name}</option>`;
                    }
                });
            }
        });
}

function loadSummary() {
    fetch('/api/driver-dtr/summary')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                document.getElementById('activeDrivers').textContent = data.data.activeDrivers || '—';
                document.getElementById('pendingApproval').textContent = data.data.pendingApproval || '—';
                document.getElementById('pendingPayment').textContent = data.data.pendingPayment || '—';
                document.getElementById('currentPayroll').textContent = `₱${(data.data.currentPayroll || 0).toLocaleString()}`;
                document.getElementById('currentCutoff').textContent = data.data.currentCutoff || '—';
            }
        });
}

function loadDriverRecords() {
    if (!currentCutoff) return;
    
    Swal.fire({
        title: 'Loading driver records...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    // Use the new generate endpoint that auto-creates records
    fetch(`/api/driver-dtr/records/generate/${encodeURIComponent(currentCutoff)}/${currentDriverType}`)
        .then(res => res.json())
        .then(data => {
            Swal.close();
            
            if (data.success) {
                currentDriverRecords = data.data;
                renderDriverTable(currentDriverRecords);
                totalPages = Math.ceil(currentDriverRecords.length / 10);
                updatePagination();
                document.getElementById('recordCount').textContent = `${currentDriverRecords.length} records`;
                
                // Show batch approve button if there are records
                const batchApproveBtn = document.getElementById('batchApproveBtn');
                if (batchApproveBtn) {
                    batchApproveBtn.style.display = currentDriverRecords.length > 0 ? 'inline-flex' : 'none';
                }
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error });
                clearTable();
            }
        })
        .catch(error => {
            Swal.close();
            console.error('Error loading driver records:', error);
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to load driver records' });
            clearTable();
        });
}

// ==================== Table Rendering ====================
function renderDriverTable(records) {
    const tbody = document.getElementById('dtrTableBody');
    if (!tbody) return;
    
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No driver records found for this cutoff</td></tr>';
        return;
    }
    
    // Pagination
    const start = (currentPage - 1) * 10;
    const end = start + 10;
    const paginatedRecords = records.slice(start, end);
    
    let html = '';
    paginatedRecords.forEach(record => {
        const statusClass = `status-${record.status || 'draft'}`;
        const netTotal = record.netTotal || record.summary?.totalDriverRate || 0;
        
        html += `
            <tr onclick="openDriverDTR('${record.id}')" style="cursor: pointer;">
                <td onclick="event.stopPropagation()"><input type="checkbox" class="record-checkbox" value="${record.id}"></td>
                <td><strong>${escapeHtml(record.driverName)}</strong></td>
                <td>${escapeHtml(record.driverPhone || 'N/A')}</td>
                <td>${record.summary?.totalTrips || 0}</td>
                <td>₱${(record.summary?.totalDriverRate || 0).toLocaleString()}</td>
                <td><strong>₱${(netTotal || 0).toLocaleString()}</strong></td>
                <td><span class="status-badge ${statusClass}">${(record.status || 'draft').toUpperCase()}</span></td>
                <td onclick="event.stopPropagation()">
                    <button class="action-btn action-view" onclick="openDriverDTR('${record.id}')" title="View/Edit">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

function clearTable() {
    const tbody = document.getElementById('dtrTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Select cutoff to view DTR records</td></tr>';
    }
    document.getElementById('recordCount').textContent = '0 records';
    document.getElementById('batchApproveBtn').style.display = 'none';
}

// ==================== Driver DTR Modal ====================
function openDriverDTR(recordId = null) {
    if (!currentCutoff) {
        Swal.fire({ icon: 'warning', title: 'No Cutoff', text: 'Please select a cutoff period first' });
        return;
    }
    
    const modal = document.getElementById('driverDTRModal');
    
    if (!recordId) {
        // This shouldn't happen with the new design
        Swal.fire({ icon: 'error', title: 'Error', text: 'No record selected' });
        return;
    }
    
    // Load existing record
    fetch(`/api/driver-dtr/record/${recordId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const record = data.data;
                currentRecordId = recordId;
                currentDriverDTR = {
                    driverId: record.driverId,
                    driverName: record.driverName,
                    driverPhone: record.driverPhone,
                    cutoff: record.cutoff,
                    entries: record.entries || {},
                    trips: record.trips || [],
                    transactions: record.transactions || {
                        totalUtang: 0, totalPaid: 0, balanceUtang: 0, list: {}
                    },
                    deductions: record.deductions || {
                        sss: 0, philhealth: 0, pagibig: 0, otherDeductions: 0
                    },
                    summary: record.summary || {
                        totalTrips: 0, totalDriverRate: 0, totalAmount: 0
                    }
                };
                
                populateDriverDTRModal(record);
                
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
                
                modal.style.display = 'block';
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error });
            }
        })
        .catch(error => {
            console.error('Error loading driver record:', error);
            Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to load driver record' });
        });
}

function populateDriverDTRModal(record) {
    document.getElementById('modalTitle').textContent = `${record.driverName} - DTR`;
    document.getElementById('recordId').value = record.id;
    document.getElementById('driverId').value = record.driverId;
    document.getElementById('driverName').value = record.driverName;
    document.getElementById('driverPhone').value = record.driverPhone || 'N/A';
    document.getElementById('modalCutoff').value = record.cutoff;
    
    // Populate deductions
    document.getElementById('sssDeduction').value = record.deductions?.sss || 0;
    document.getElementById('philhealthDeduction').value = record.deductions?.philhealth || 0;
    document.getElementById('pagibigDeduction').value = record.deductions?.pagibig || 0;
    document.getElementById('otherDeductions').value = record.deductions?.otherDeductions || 0;
    
    // Populate trips grid
    renderTripsGrid(record.entries || {}, record.trips || []);
    
    // Populate transactions
    if (record.transactions) {
        currentDriverDTR.transactions = record.transactions;
        updateTransactionDisplay();
    }
    
    // Calculate totals
    calculateTotals();
}

function renderTripsGrid(entries, trips) {
    const tbody = document.getElementById('tripsGridBody');
    if (!tbody) return;
    
    // Group trips by date
    const groupedTrips = {};
    trips.forEach(trip => {
        const date = trip.date;
        if (!groupedTrips[date]) {
            groupedTrips[date] = {
                date: date,
                time: trip.time,
                scheduleIds: [],
                amount: 0,
                driverRate: 0,
                advance: entries[date]?.advance || 0,
                tripCount: 0
            };
        }
        groupedTrips[date].scheduleIds.push(trip.scheduleId);
        groupedTrips[date].amount += trip.amount;
        groupedTrips[date].driverRate += trip.driverRate;
        groupedTrips[date].tripCount++;
        // Keep the first time entry
        if (groupedTrips[date].time !== trip.time) {
            groupedTrips[date].time = trip.time;
        }
    });
    
    // Convert to array and sort by date
    const sortedDates = Object.keys(groupedTrips).sort();
    
    let html = '';
    sortedDates.forEach(date => {
        const trip = groupedTrips[date];
        const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
        
        html += `
            <tr data-date="${date}">
                <td>${escapeHtml(date)}</td>
                <td>${dayName}</td>
                <td>${escapeHtml(trip.time)}</td>
                <td>${trip.tripCount} trip(s)</td>
                <td>₱${trip.amount.toLocaleString()}</td>
                <td>₱${trip.driverRate.toLocaleString()}</td>
                <td><input type="number" class="advance-input" step="0.01" min="0" value="${trip.advance}" onchange="updateAdvance('${date}', this.value)"></td>
                <td><button type="button" class="btn-sm btn-danger" onclick="clearAdvance('${date}')"><i class="fas fa-times"></i></button></td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

function updateAdvance(date, amount) {
    const advanceAmount = parseFloat(amount) || 0;
    
    // Update entries
    if (!currentDriverDTR.entries[date]) {
        currentDriverDTR.entries[date] = {
            date: date,
            advance: 0,
            driverRate: 0,
            amount: 0,
            tripCount: 0
        };
    }
    
    const oldAmount = currentDriverDTR.entries[date].advance || 0;
    currentDriverDTR.entries[date].advance = advanceAmount;
    
    // Update transactions
    if (!currentDriverDTR.transactions.list) {
        currentDriverDTR.transactions.list = {};
    }
    
    const existingTransactionId = Object.keys(currentDriverDTR.transactions.list).find(id => 
        currentDriverDTR.transactions.list[id]?.date === date && 
        currentDriverDTR.transactions.list[id]?.type === 'utang'
    );
    
    if (existingTransactionId) {
        const difference = advanceAmount - oldAmount;
        if (advanceAmount > 0) {
            currentDriverDTR.transactions.list[existingTransactionId].amount = advanceAmount;
        } else {
            delete currentDriverDTR.transactions.list[existingTransactionId];
        }
        currentDriverDTR.transactions.totalUtang = (currentDriverDTR.transactions.totalUtang || 0) + difference;
    } else if (advanceAmount > 0) {
        const transactionId = Date.now().toString();
        currentDriverDTR.transactions.list[transactionId] = {
            id: transactionId,
            date: date,
            amount: advanceAmount,
            type: 'utang',
            description: `Advance for ${date}`
        };
        currentDriverDTR.transactions.totalUtang = (currentDriverDTR.transactions.totalUtang || 0) + advanceAmount;
    }
    
    currentDriverDTR.transactions.balanceUtang = (currentDriverDTR.transactions.totalUtang || 0) - (currentDriverDTR.transactions.totalPaid || 0);
    
    updateTransactionDisplay();
    calculateTotals();
}

function clearAdvance(date) {
    updateAdvance(date, 0);
}

// ==================== Transactions ====================
function openPaymentModal() {
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
                    <label>Current Balance: ₱${(currentDriverDTR.transactions.balanceUtang || 0).toLocaleString()}</label>
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
    
    if (!currentDriverDTR.transactions.list) {
        currentDriverDTR.transactions.list = {};
    }
    
    currentDriverDTR.transactions.list[transactionId] = {
        id: transactionId,
        date: today,
        amount: amount,
        type: 'payment',
        description: description || `Payment made on ${today}`
    };
    
    currentDriverDTR.transactions.totalPaid = (currentDriverDTR.transactions.totalPaid || 0) + amount;
    currentDriverDTR.transactions.balanceUtang = (currentDriverDTR.transactions.totalUtang || 0) - (currentDriverDTR.transactions.totalPaid || 0);
    
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
            const transaction = currentDriverDTR.transactions.list[transactionId];
            if (transaction) {
                if (transaction.type === 'utang') {
                    currentDriverDTR.transactions.totalUtang = (currentDriverDTR.transactions.totalUtang || 0) - transaction.amount;
                    // Also remove from entry
                    Object.keys(currentDriverDTR.entries).forEach(date => {
                        if (currentDriverDTR.entries[date].advance === transaction.amount) {
                            currentDriverDTR.entries[date].advance = 0;
                        }
                    });
                } else if (transaction.type === 'payment') {
                    currentDriverDTR.transactions.totalPaid = (currentDriverDTR.transactions.totalPaid || 0) - transaction.amount;
                }
                
                delete currentDriverDTR.transactions.list[transactionId];
                currentDriverDTR.transactions.balanceUtang = (currentDriverDTR.transactions.totalUtang || 0) - (currentDriverDTR.transactions.totalPaid || 0);
                
                updateTransactionDisplay();
                calculateNetTotal();
                
                Swal.fire('Deleted!', 'Transaction deleted', 'success');
            }
        }
    });
}

function updateTransactionDisplay() {
    const totalUtang = currentDriverDTR.transactions.totalUtang || 0;
    const totalPaid = currentDriverDTR.transactions.totalPaid || 0;
    const balanceUtang = totalUtang - totalPaid;
    
    document.getElementById('totalUtang').textContent = `₱${totalUtang.toLocaleString()}`;
    document.getElementById('totalPaid').textContent = `₱${totalPaid.toLocaleString()}`;
    document.getElementById('balanceUtang').textContent = `₱${balanceUtang.toLocaleString()}`;
    
    renderTransactionsList();
}

function renderTransactionsList() {
    const tbody = document.getElementById('transactionsListBody');
    if (!tbody) return;
    
    const transactions = currentDriverDTR.transactions.list || {};
    
    if (Object.keys(transactions).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No transactions</td></tr>';
        return;
    }
    
    let html = '';
    Object.values(transactions).forEach(trans => {
        const rowClass = trans.type === 'utang' ? 'utang-row' : 'payment-row';
        html += `
            <tr class="${rowClass}">
                <td>${escapeHtml(trans.date)}</td>
                <td>${trans.type === 'utang' ? 'UTANG (Advance)' : 'BAYAD UTANG'}</td>
                <td>₱${trans.amount.toLocaleString()}</td>
                <td>${escapeHtml(trans.description || '—')}</td>
                <td><button class="btn-sm btn-danger" onclick="deleteTransaction('${trans.id}')"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// ==================== Calculations ====================
function calculateTotals() {
    // Calculate from trips grid
    let totalTrips = 0;
    let totalDriverRate = 0;
    let totalAmount = 0;
    let totalAdvances = 0;
    
    Object.values(currentDriverDTR.entries).forEach(entry => {
        totalTrips += entry.tripCount || 0;
        totalDriverRate += entry.driverRate || 0;
        totalAmount += entry.amount || 0;
        totalAdvances += entry.advance || 0;
    });
    
    currentDriverDTR.summary = {
        totalTrips,
        totalDriverRate,
        totalAmount
    };
    
    document.getElementById('totalTripsCount').textContent = totalTrips;
    document.getElementById('totalAmount').textContent = `₱${totalAmount.toLocaleString()}`;
    document.getElementById('totalDriverRate').textContent = `₱${totalDriverRate.toLocaleString()}`;
    document.getElementById('totalAdvances').textContent = `₱${totalAdvances.toLocaleString()}`;
    
    calculateNetTotal();
}

function calculateNetTotal() {
    const gross = currentDriverDTR.summary.totalDriverRate || 0;
    const sss = parseFloat(document.getElementById('sssDeduction').value) || 0;
    const philhealth = parseFloat(document.getElementById('philhealthDeduction').value) || 0;
    const pagibig = parseFloat(document.getElementById('pagibigDeduction').value) || 0;
    const otherDeductions = parseFloat(document.getElementById('otherDeductions').value) || 0;
    const bayadUtang = currentDriverDTR.transactions.totalPaid || 0;
    
    const totalDeductions = sss + philhealth + pagibig + otherDeductions + bayadUtang;
    const netTotal = gross - totalDeductions;
    
    document.getElementById('netTotal').textContent = `₱${netTotal.toLocaleString()}`;
    
    // Update deductions in current object
    currentDriverDTR.deductions = { sss, philhealth, pagibig, otherDeductions };
}

// ==================== Save Functions ====================
function saveDriverDTR(e) {
    e.preventDefault();
    
    const formData = {
        entries: currentDriverDTR.entries,
        transactions: currentDriverDTR.transactions,
        deductions: currentDriverDTR.deductions
    };
    
    Swal.fire({
        title: 'Saving...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch(`/api/driver-dtr/record/${currentRecordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Saved!',
                text: 'Driver DTR saved successfully',
                timer: 1500,
                showConfirmButton: false
            });
            
            closeAllModals();
            loadDriverRecords();
            loadSummary();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.error });
        }
    });
}

function approveRecord() {
    Swal.fire({
        title: 'Approve DTR?',
        text: 'This will mark the record as approved',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2ecc71',
        confirmButtonText: 'Yes, Approve'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/driver-dtr/record/${currentRecordId}/approve`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Approved!', 'DTR record has been approved', 'success');
                    closeAllModals();
                    loadDriverRecords();
                    loadSummary();
                }
            });
        }
    });
}

function markAsPaid() {
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
        confirmButtonColor: '#f39c12',
        confirmButtonText: 'Confirm Payment'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/driver-dtr/record/${currentRecordId}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentMethod: result.value })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Paid!', 'Payment recorded successfully', 'success');
                    closeAllModals();
                    loadDriverRecords();
                    loadSummary();
                }
            });
        }
    });
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
                fetch(`/api/driver-dtr/record/${id}/approve`, { method: 'POST' })
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
                            loadDriverRecords();
                            loadSummary();
                        }
                    });
            });
        }
    });
}

function exportCutoff() {
    if (!currentCutoff) {
        Swal.fire({ icon: 'warning', title: 'No Cutoff', text: 'Please select a cutoff period first' });
        return;
    }
    
    Swal.fire({
        icon: 'success',
        title: 'Export Started',
        text: `Exporting ${currentCutoff} for ${getDriverTypeDisplay(currentDriverType)}`,
        timer: 1500,
        showConfirmButton: false
    });
}

function getDriverTypeDisplay(type) {
    const types = {
        'main': 'Main Drivers',
        'direct': 'Outsource Direct',
        'indirect': 'Outsource Indirect',
        'others': 'Others'
    };
    return types[type] || type;
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
        renderDriverTable(currentDriverRecords);
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        renderDriverTable(currentDriverRecords);
    }
}

// ==================== Utility Functions ====================
function refreshData() {
    Swal.fire({
        title: 'Refreshing...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    setTimeout(() => {
        loadSummary();
        if (currentCutoff) {
            loadDriverRecords();
        }
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

// Click outside modal
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};