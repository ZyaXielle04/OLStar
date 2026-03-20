// ==================== Global Variables ====================
let currentPage = 1;
let totalPages = 1;
let currentDTR = {
    adminId: null,
    cutoff: null,
    entries: {},
    dailyRate: 560, // Default daily rate for 8 hours
    hourlyRate: 70, // 70 per hour
    otRate: 14, // 20% of hourly rate = ₱14 per hour
    nightDiffRate: 10, // ₱10 per hour for night differential
    otherAdvances: {
        totalUtang: 0,
        totalPaid: 0,
        balanceUtang: 0,
        transactions: {}
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

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Toggle sidebar
    document.getElementById('btnToggleSidebar')?.addEventListener('click', toggleSidebar);
    
    // Action buttons
    document.getElementById('newDTRBtn')?.addEventListener('click', openDTRModal);
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
    document.getElementById('utangForm')?.addEventListener('submit', saveUtangTransaction);
    
    // Calculate button
    document.getElementById('calculateBtn')?.addEventListener('click', calculateAll);
    
    // Employee selection change
    document.getElementById('employeeId')?.addEventListener('change', loadEmployeeRates);
    document.getElementById('cutoffSelect')?.addEventListener('change', generateDTRGrid);
    
    // Deduction inputs
    ['sssDeduction', 'philhealthDeduction', 'pagibigDeduction', 'otherDeductions'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateNetTotal);
    });
    
    // Utang buttons
    document.getElementById('addUtangBtn')?.addEventListener('click', () => openUtangModal('utang'));
    document.getElementById('addPaymentBtn')?.addEventListener('click', () => openUtangModal('payment'));
    
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
    const adminId = document.getElementById('employeeId').value;
    if (!adminId) return;
    
    fetch(`/api/admin-salary/employees/${adminId}/rates`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                currentDTR.adminId = adminId;
                currentDTR.dailyRate = data.data.dailyRate || 560;
                currentDTR.hourlyRate = data.data.hourlyRate || 70;
                currentDTR.otRate = 14;
                currentDTR.nightDiffRate = 10;
                
                // Store employee deduction values
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
                
                // Check if current cutoff is 2nd half to apply deductions
                const cutoffValue = document.getElementById('cutoffSelect').value;
                if (cutoffValue && isSecondHalfCutoff(cutoffValue)) {
                    // Apply deductions for 2nd cutoff
                    document.getElementById('sssDeduction').value = currentDTR.employeeSSS;
                    document.getElementById('philhealthDeduction').value = currentDTR.employeePhilhealth;
                    document.getElementById('pagibigDeduction').value = currentDTR.employeePagibig;
                } else {
                    // Set to 0 for 1st cutoff
                    document.getElementById('sssDeduction').value = 0;
                    document.getElementById('philhealthDeduction').value = 0;
                    document.getElementById('pagibigDeduction').value = 0;
                }
            }
        })
        .catch(error => {
            console.error('Error loading employee rates:', error);
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
    const hours = calculateHours(startTime, endTime);
    
    // Standard work day is 8 hours
    // OT is any hours beyond 8
    if (hours > 8) {
        const otHours = hours - 8;
        return Math.round(otHours * 10) / 10;
    }
    return 0;
}

function calculateNightDiff(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    
    if (!start || !end) return 0;
    
    // Night differential hours: 10:00 PM (22:00) to 6:00 AM
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
    
    // Check each hour segment
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

// ==================== DTR Grid ====================
function generateDTRGrid() {
    const cutoff = document.getElementById('cutoffSelect').value;
    if (!cutoff) return;
    
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
                <td><input type="number" class="advance" step="0.01" min="0" value="${entry.advance || 0}" onchange="updateDTRRow('${date}')"></td>
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
    
    tbody.innerHTML = html;
}

function updateDTRRow(date) {
    const row = document.querySelector(`tr[data-date="${date}"]`);
    if (!row) return;
    
    const timeIn = row.querySelector('.time-in')?.value || '';
    const timeOut = row.querySelector('.time-out')?.value || '';
    const status = row.querySelector('.status')?.value || 'present';
    
    let ot = 0;
    let nightDiff = 0;
    
    if (status === 'present' && timeIn && timeOut) {
        ot = calculateOT(timeIn, timeOut);
        nightDiff = calculateNightDiff(timeIn, timeOut);
        
        // Calculate the daily gross for debugging
        const totalHours = calculateHours(timeIn, timeOut);
        const regularHours = Math.min(totalHours, 8);
        const regularPay = regularHours * currentDTR.hourlyRate;
        const otPay = ot * currentDTR.otRate;
        const nightDiffPay = nightDiff * currentDTR.nightDiffRate;
        const dailyGross = regularPay + otPay + nightDiffPay;
        
        console.log(`Day ${date}:`, {
            timeIn, timeOut,
            totalHours: totalHours.toFixed(1),
            regularHours: regularHours,
            regularPay: regularPay,
            ot: ot,
            otPay: otPay,
            nightDiff: nightDiff,
            nightDiffPay: nightDiffPay,
            dailyGross: dailyGross
        });
        
        // Update the input fields with calculated values
        row.querySelector('.ot-hours').value = ot;
        row.querySelector('.night-diff').value = nightDiff;
    } else {
        row.querySelector('.ot-hours').value = 0;
        row.querySelector('.night-diff').value = 0;
    }
    
    const advance = parseFloat(row.querySelector('.advance')?.value) || 0;
    
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
    document.getElementById('advancesTotal').textContent = `₱${totalAdvances.toLocaleString()}`;
    
    calculateGrossSalary();
}

function calculateGrossSalary() {
    let totalRegularPay = 0;
    let totalOTPay = 0;
    let totalNightDiffPay = 0;
    
    Object.values(currentDTR.entries).forEach(entry => {
        if (entry.status === 'present') {
            const totalHours = entry.timeIn && entry.timeOut ? calculateHours(entry.timeIn, entry.timeOut) : 8;
            const regularHours = Math.min(totalHours, 8);
            const regularPay = regularHours * currentDTR.hourlyRate;
            const otPay = (entry.ot || 0) * currentDTR.otRate;
            const nightDiffPay = (entry.nightDiff || 0) * currentDTR.nightDiffRate;
            
            totalRegularPay += regularPay;
            totalOTPay += otPay;
            totalNightDiffPay += nightDiffPay;
        }
    });
    
    const grossSalary = totalRegularPay + totalOTPay + totalNightDiffPay;
    
    console.log('Salary Summary:', {
        totalRegularPay: totalRegularPay,
        totalOTPay: totalOTPay,
        totalNightDiffPay: totalNightDiffPay,
        grossSalary: grossSalary
    });
    
    document.getElementById('grossSalary').textContent = `₱${grossSalary.toLocaleString()}`;
    
    calculateNetTotal();
}

function calculateNetTotal() {
    const grossText = document.getElementById('grossSalary').textContent;
    const gross = parseFloat(grossText.replace('₱', '').replace(/,/g, '')) || 0;
    
    const advances = parseFloat(document.getElementById('advancesTotal').textContent.replace('₱', '').replace(/,/g, '')) || 0;
    const otherDeductions = parseFloat(document.getElementById('otherDeductions').value) || 0;
    const sss = parseFloat(document.getElementById('sssDeduction').value) || 0;
    const philhealth = parseFloat(document.getElementById('philhealthDeduction').value) || 0;
    const pagibig = parseFloat(document.getElementById('pagibigDeduction').value) || 0;
    
    const totalDeductions = advances + otherDeductions + sss + philhealth + pagibig;
    const netTotal = gross - totalDeductions;
    
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

// ==================== DTR CRUD ====================
function openDTRModal(recordId = null) {
    const modal = document.getElementById('dtrModal');
    
    if (!recordId) {
        document.getElementById('modalTitle').textContent = 'New DTR Record';
        document.getElementById('dtrForm').reset();
        document.getElementById('recordId').value = '';
        document.getElementById('approveBtn').style.display = 'none';
        document.getElementById('markPaidBtn').style.display = 'none';
        document.getElementById('saveDTRBtn').style.display = 'inline-block';
        
        currentDTR = {
            adminId: null,
            cutoff: null,
            entries: {},
            dailyRate: 560,
            hourlyRate: 70,
            otRate: 14,
            nightDiffRate: 10,
            otherAdvances: {
                totalUtang: 0,
                totalPaid: 0,
                balanceUtang: 0,
                transactions: {}
            }
        };
        
        document.getElementById('dtrGridBody').innerHTML = '';
    } else {
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
                    dailyRate: record.dailyRate || 560,
                    hourlyRate: record.hourlyRate || 70,
                    otRate: 14,
                    nightDiffRate: 10,
                    employeeSSS: record.summary?.sss || 0,
                    employeePhilhealth: record.summary?.philhealth || 0,
                    employeePagibig: record.summary?.pagibig || 0,
                    otherAdvances: record.otherAdvances || {
                        totalUtang: 0,
                        totalPaid: 0,
                        balanceUtang: 0,
                        transactions: {}
                    }
                };
                
                generateDTRGrid();
                
                if (record.summary) {
                    // Load the stored deduction values (which are already correct for the cutoff)
                    document.getElementById('sssDeduction').value = record.summary.sss || 0;
                    document.getElementById('philhealthDeduction').value = record.summary.philhealth || 0;
                    document.getElementById('pagibigDeduction').value = record.summary.pagibig || 0;
                    document.getElementById('otherDeductions').value = record.summary.otherDeductions || 0;
                }
                
                renderUtangTransactions(currentDTR.otherAdvances.transactions);
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
        totalAdvances: parseFloat(document.getElementById('advancesTotal').textContent.replace('₱', '').replace(/,/g, '')) || 0,
        grossSalary: parseFloat(document.getElementById('grossSalary').textContent.replace('₱', '').replace(/,/g, '')) || 0,
        otherDeductions: parseFloat(document.getElementById('otherDeductions').value) || 0,
        sss: parseFloat(document.getElementById('sssDeduction').value) || 0,
        philhealth: parseFloat(document.getElementById('philhealthDeduction').value) || 0,
        pagibig: parseFloat(document.getElementById('pagibigDeduction').value) || 0,
        benefitsDeduction: (parseFloat(document.getElementById('sssDeduction').value) || 0) +
                          (parseFloat(document.getElementById('philhealthDeduction').value) || 0) +
                          (parseFloat(document.getElementById('pagibigDeduction').value) || 0),
        netTotal: parseFloat(document.getElementById('netTotal').textContent.replace('₱', '').replace(/,/g, '')) || 0
    };
    
    const formData = {
        adminId: adminId,
        cutoff: cutoff,
        entries: currentDTR.entries,
        summary: summary,
        otherAdvances: currentDTR.otherAdvances
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

// ==================== Utang Transactions ====================
function openUtangModal(type) {
    if (!document.getElementById('recordId').value) {
        Swal.fire({
            icon: 'warning',
            title: 'Save First',
            text: 'Please save the DTR record first before adding utang transactions.'
        });
        return;
    }
    
    document.getElementById('utangType').value = type;
    document.getElementById('utangAmount').value = '';
    document.getElementById('utangDescription').value = '';
    document.getElementById('utangModal').style.display = 'block';
}

function saveUtangTransaction(e) {
    e.preventDefault();
    
    const dtrId = document.getElementById('recordId').value;
    const type = document.getElementById('utangType').value;
    const amount = parseFloat(document.getElementById('utangAmount').value);
    const description = document.getElementById('utangDescription').value;
    
    if (!amount || amount <= 0) {
        Swal.fire({ icon: 'error', title: 'Invalid Amount', text: 'Please enter a valid amount' });
        return;
    }
    
    fetch('/api/admin-salary/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            adminId: currentDTR.adminId,
            amount: amount,
            type: type,
            cutoff: currentDTR.cutoff,
            description: description,
            dtrRecordId: dtrId
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            Swal.fire({
                icon: 'success',
                title: 'Transaction Added',
                text: `${type === 'utang' ? 'Utang' : 'Payment'} recorded successfully`,
                timer: 1500,
                showConfirmButton: false
            });
            
            closeAllModals();
            loadDTRRecord(dtrId);
        }
    });
}

function deleteTransaction(transactionId) {
    const dtrId = document.getElementById('recordId').value;
    
    Swal.fire({
        title: 'Delete Transaction?',
        text: 'This action cannot be undone',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        confirmButtonText: 'Yes, Delete'
    }).then((result) => {
        if (result.isConfirmed) {
            fetch(`/api/admin-salary/advances/${transactionId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dtrRecordId: dtrId })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    Swal.fire('Deleted!', 'Transaction deleted', 'success');
                    loadDTRRecord(dtrId);
                }
            });
        }
    });
}

function renderUtangTransactions(transactions) {
    const tbody = document.getElementById('utangTransactionsBody');
    if (!tbody) return;
    
    if (!transactions || Object.keys(transactions).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No transactions</td></tr>';
        return;
    }
    
    let html = '';
    let totalUtang = 0;
    let totalPaid = 0;
    
    Object.entries(transactions).forEach(([id, trans]) => {
        const rowClass = trans.type === 'utang' ? 'utang-row' : 'payment-row';
        const amount = trans.amount || 0;
        
        if (trans.type === 'utang') totalUtang += amount;
        else totalPaid += amount;
        
        html += `
            <tr class="${rowClass}">
                <td>${new Date(trans.date).toLocaleDateString()}</td>
                <td>${trans.type === 'utang' ? 'UTANG' : 'PAYMENT'}</td>
                <td>₱${amount.toLocaleString()}</td>
                <td>${trans.description || '—'}</td>
                <td><button class="btn-sm btn-danger" onclick="deleteTransaction('${id}')"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    document.getElementById('totalUtang').value = totalUtang;
    document.getElementById('totalPaid').value = totalPaid;
    document.getElementById('balanceUtang').value = totalUtang - totalPaid;
    document.getElementById('bawas').value = totalPaid;
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
        dailyRate: parseFloat(document.getElementById('dailyRate').value) || 560,
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
                        <span class="detail-value">₱${(admin.dailyRate || 560).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Hourly Rate:</span>
                        <span class="detail-value">₱${(admin.hourlyRate || 70).toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">OT Rate:</span>
                        <span class="detail-value">₱14/hr (20% of hourly)</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Night Diff Rate:</span>
                        <span class="detail-value">₱10/hr</span>
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
                
                document.getElementById('editDailyRate').value = admin.dailyRate || 560;
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
        dailyRate: parseFloat(document.getElementById('editDailyRate').value) || 560,
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
        document.getElementById('dailyRate').value = 560;
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