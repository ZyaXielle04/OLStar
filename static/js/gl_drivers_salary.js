// General Ledger - Driver Salary JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the page
    loadDrivers();
    loadSalaryRecords();
    loadCompletedTrips();
    loadCharts();
    setupEventListeners();
    updateSummaryCards();
});

// Global variables
let currentPage = 1;
let totalPages = 1;
let salaryRecords = [];
let drivers = [];
let completedTrips = [];
let charts = {};
let currentRecordId = null;

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
    document.getElementById('driverFilter')?.addEventListener('change', loadSalaryRecords);
    document.getElementById('payPeriodFilter')?.addEventListener('change', loadSalaryRecords);
    document.getElementById('dateRangeFilter')?.addEventListener('change', handleDateRangeChange);
    document.getElementById('applyDateFilter')?.addEventListener('click', loadSalaryRecords);
    document.getElementById('refreshDataBtn')?.addEventListener('click', refreshData);

    // Action buttons
    document.getElementById('processDriverPayrollBtn')?.addEventListener('click', openPayrollModal);
    document.getElementById('addDriverSalaryBtn')?.addEventListener('click', () => openSalaryModal());
    document.getElementById('exportDriverSalaryBtn')?.addEventListener('click', exportReport);
    document.getElementById('viewCompletedSchedulesBtn')?.addEventListener('click', openCompletedSchedulesModal);
    document.getElementById('toggleAnalyticsBtn')?.addEventListener('click', toggleAnalytics);

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => changePage('prev'));
    document.getElementById('nextPage')?.addEventListener('click', () => changePage('next'));

    // Modal close buttons
    document.querySelectorAll('.close-modal, .cancel-btn, .close-btn').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Forms
    document.getElementById('salaryForm')?.addEventListener('submit', saveSalaryRecord);

    // Trip selection
    document.getElementById('selectAllTrips')?.addEventListener('click', selectAllTrips);
    document.getElementById('deselectAllTrips')?.addEventListener('click', deselectAllTrips);
    
    // Driver and period change
    document.getElementById('driverId')?.addEventListener('change', function() {
      const period = document.getElementById('payPeriod').value;
      const driverId = this.value;
      
      console.log('Driver changed:', driverId, 'Period:', period);
      
      if (driverId && period) {
          loadDriverCompletedTrips(driverId, period);
          
          // Also fetch pending deductions and advances
          fetchPendingDeductionsAndAdvances(driverId, period)
              .then(([deductionsData, advancesData]) => {
                  if (deductionsData.success) {
                      const deductions = deductionsData.data;
                      document.getElementById('taxDeduction').value = deductions.tax || 0;
                      document.getElementById('sssDeduction').value = deductions.sss || 0;
                      document.getElementById('philhealthDeduction').value = deductions.philhealth || 0;
                      document.getElementById('pagibigDeduction').value = deductions.pagibig || 0;
                      document.getElementById('loanDeduction').value = deductions.loan || 0;
                      document.getElementById('otherDeductions').value = deductions.other || 0;
                  }
                  
                  if (advancesData.success) {
                      document.getElementById('advanceDeduction').value = advancesData.data.totalAdvance || 0;
                  }
                  
                  calculateTotals();
              })
              .catch(error => console.error('Error fetching pending data:', error));
      } else {
          // Clear trips list
          const container = document.getElementById('completedTripsList');
          if (container) {
              container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Select a driver and period to load trips</div>';
          }
          document.getElementById('selectedTripsCount').textContent = '0 trips selected';
          document.getElementById('totalTrips').value = 0;
          document.getElementById('grossEarnings').value = 0;
      }
  });

  document.getElementById('payPeriod')?.addEventListener('change', function() {
      const driverId = document.getElementById('driverId').value;
      const period = this.value;
      
      console.log('Period changed:', period, 'Driver:', driverId);
      
      if (driverId && period) {
          loadDriverCompletedTrips(driverId, period);
          
          // Also fetch pending deductions and advances
          fetchPendingDeductionsAndAdvances(driverId, period)
              .then(([deductionsData, advancesData]) => {
                  if (deductionsData.success) {
                      const deductions = deductionsData.data;
                      document.getElementById('taxDeduction').value = deductions.tax || 0;
                      document.getElementById('sssDeduction').value = deductions.sss || 0;
                      document.getElementById('philhealthDeduction').value = deductions.philhealth || 0;
                      document.getElementById('pagibigDeduction').value = deductions.pagibig || 0;
                      document.getElementById('loanDeduction').value = deductions.loan || 0;
                      document.getElementById('otherDeductions').value = deductions.other || 0;
                  }
                  
                  if (advancesData.success) {
                      document.getElementById('advanceDeduction').value = advancesData.data.totalAdvance || 0;
                  }
                  
                  calculateTotals();
              })
              .catch(error => console.error('Error fetching pending data:', error));
      } else {
          // Clear trips list
          const container = document.getElementById('completedTripsList');
          if (container) {
              container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Select a driver and period to load trips</div>';
          }
          document.getElementById('selectedTripsCount').textContent = '0 trips selected';
          document.getElementById('totalTrips').value = 0;
          document.getElementById('grossEarnings').value = 0;
      }
  });

    // Calculate totals on input change
    ['taxDeduction', 'sssDeduction', 'philhealthDeduction', 'pagibigDeduction', 
     'loanDeduction', 'otherDeductions', 'advanceDeduction'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateTotals);
    });

    // Details buttons
    document.getElementById('editFromDetailsBtn')?.addEventListener('click', editFromDetails);
    document.getElementById('generatePayslipDetailsBtn')?.addEventListener('click', generatePayslipFromDetails);
    document.getElementById('downloadPayslipBtn')?.addEventListener('click', downloadPayslip);
    document.getElementById('emailPayslipBtn')?.addEventListener('click', emailPayslip);
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
        loadSalaryRecords();
    }
}

// Load drivers from /users with role "driver"
function loadDrivers() {
    fetch('/api/drivers-salary/drivers')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                drivers = data.data;
                populateDriverFilters();
            }
        })
        .catch(error => console.error('Error loading drivers:', error));
}

// Populate driver filters
function populateDriverFilters() {
    const driverFilter = document.getElementById('driverFilter');
    const driverSelect = document.getElementById('driverId');
    const tripDriverFilter = document.getElementById('tripDriverFilter');
    
    const options = '<option value="all">All Drivers</option>' + 
                    drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    
    if (driverFilter) driverFilter.innerHTML = options;
    if (tripDriverFilter) tripDriverFilter.innerHTML = options;
    
    if (driverSelect) {
        driverSelect.innerHTML = '<option value="">— Select Driver —</option>' + 
            drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }
}

// Load completed trips
function loadCompletedTrips() {
    fetch('/api/drivers-salary/completed-trips')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                completedTrips = data.data;
                renderCompletedTripsTable(completedTrips);
            }
        })
        .catch(error => console.error('Error loading completed trips:', error));
}

// Update loadDriverCompletedTrips function to use driverName
function loadDriverCompletedTrips(driverId, period) {
    console.log('Loading trips for driver ID:', driverId, 'period:', period);
    
    // First, get the driver's full name from the drivers list
    const driverSelect = document.getElementById('driverId');
    const selectedOption = driverSelect.options[driverSelect.selectedIndex];
    const driverName = selectedOption ? selectedOption.text.split(' - ')[0].trim() : '';
    
    console.log('Driver name for matching:', driverName);
    
    if (!driverName) {
        console.error('Could not get driver name');
        const container = document.getElementById('completedTripsList');
        if (container) {
            container.innerHTML = '<div class="error" style="padding: 20px; text-align: center; color: #e74c3c;">Could not identify driver name</div>';
        }
        return;
    }
    
    // Show loading in the trips list
    const container = document.getElementById('completedTripsList');
    if (container) {
        container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Loading trips...</div>';
    }
    
    // Pass both driverId and driverName to the API
    fetch(`/api/drivers-salary/driver-trips/${driverId}?period=${encodeURIComponent(period)}&driverName=${encodeURIComponent(driverName)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Driver trips response:', data);
            
            if (data.success) {
                renderTripsChecklist(data.data);
            } else {
                console.error('Failed to load driver trips:', data.error);
                if (container) {
                    container.innerHTML = `<div class="error" style="padding: 20px; text-align: center; color: #e74c3c;">Error loading trips: ${data.error}</div>`;
                }
            }
        })
        .catch(error => {
            console.error('Error loading driver trips:', error);
            if (container) {
                container.innerHTML = `<div class="error" style="padding: 20px; text-align: center; color: #e74c3c;">Failed to connect to server: ${error.message}</div>`;
            }
        });
}

// Update renderTripsChecklist function
function renderTripsChecklist(trips) {
    const container = document.getElementById('completedTripsList');
    if (!container) return;
    
    console.log('Rendering trips checklist:', trips);
    
    if (!trips || trips.length === 0) {
        container.innerHTML = '<div class="text-center" style="padding: 20px; color: #7f8c8d;">No completed trips found for this period.</div>';
        document.getElementById('selectedTripsCount').textContent = '0 trips selected';
        document.getElementById('totalTrips').value = 0;
        document.getElementById('grossEarnings').value = 0;
        return;
    }
    
    let html = '';
    trips.forEach((trip, index) => {
        const tripDate = trip.date ? new Date(trip.date) : null;
        const formattedDate = tripDate ? tripDate.toLocaleDateString() : 'Unknown date';
        const driverRate = trip.driverRate || 0;
        
        html += `
            <div class="trip-checkbox-item" style="padding: 10px; border-bottom: 1px solid #ecf0f1; display: flex; align-items: center;">
                <input type="checkbox" class="trip-checkbox" 
                       data-id="${trip.id}" 
                       data-rate="${driverRate}"
                       value="${trip.id}"
                       style="width: auto; margin-right: 10px;">
                <div class="trip-checkbox-info" style="flex: 1; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span class="trip-checkbox-date" style="font-weight: 600; color: #2c3e50;">${formattedDate}</span>
                        <span style="margin-left: 10px; color: #7f8c8d;">${trip.time || ''}</span>
                    </div>
                    <div>
                        <span class="trip-checkbox-rate" style="color: #27ae60; font-weight: 500;">₱${parseFloat(driverRate).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.trip-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectedTrips);
    });
    
    // Auto-select all trips by default
    setTimeout(() => {
        document.querySelectorAll('.trip-checkbox').forEach(cb => {
            cb.checked = true;
        });
        updateSelectedTrips();
    }, 100);
}

// Update updateSelectedTrips function
function updateSelectedTrips() {
    const checkboxes = document.querySelectorAll('.trip-checkbox:checked');
    const count = checkboxes.length;
    let total = 0;
    
    checkboxes.forEach(cb => {
        const rate = parseFloat(cb.dataset.rate || 0);
        total += rate;
    });
    
    console.log('Selected trips:', count, 'Total:', total);
    
    document.getElementById('selectedTripsCount').textContent = `${count} trip${count !== 1 ? 's' : ''} selected`;
    document.getElementById('totalTrips').value = count;
    document.getElementById('grossEarnings').value = total.toFixed(2);
    
    calculateTotals();
}

// Select all trips
function selectAllTrips() {
    document.querySelectorAll('.trip-checkbox').forEach(cb => {
        cb.checked = true;
    });
    updateSelectedTrips();
}

// Deselect all trips
function deselectAllTrips() {
    document.querySelectorAll('.trip-checkbox').forEach(cb => {
        cb.checked = false;
    });
    updateSelectedTrips();
}

// Calculate gross earnings from selected trips
function calculateGrossEarnings(trips) {
    let total = 0;
    trips.forEach(trip => {
        total += parseFloat(trip.driverRate || 0);
    });
    document.getElementById('grossEarnings').value = total.toFixed(2);
}

// Calculate totals
function calculateTotals() {
    const grossEarnings = parseFloat(document.getElementById('grossEarnings').value) || 0;
    const taxDeduction = parseFloat(document.getElementById('taxDeduction').value) || 0;
    const sssDeduction = parseFloat(document.getElementById('sssDeduction').value) || 0;
    const philhealthDeduction = parseFloat(document.getElementById('philhealthDeduction').value) || 0;
    const pagibigDeduction = parseFloat(document.getElementById('pagibigDeduction').value) || 0;
    const loanDeduction = parseFloat(document.getElementById('loanDeduction').value) || 0;
    const otherDeductions = parseFloat(document.getElementById('otherDeductions').value) || 0;
    const advanceDeduction = parseFloat(document.getElementById('advanceDeduction').value) || 0;
    
    const totalDeductions = taxDeduction + sssDeduction + philhealthDeduction + 
                           pagibigDeduction + loanDeduction + otherDeductions + advanceDeduction;
    const netPay = grossEarnings - totalDeductions;
    
    document.getElementById('totalDeductions').value = totalDeductions.toFixed(2);
    document.getElementById('netPay').value = netPay.toFixed(2);
}

// Fetch pending deductions and advances for a driver
function fetchPendingDeductionsAndAdvances(driverId, period) {
    return Promise.all([
        fetch(`/api/drivers-salary/pending-deductions/${driverId}?period=${encodeURIComponent(period)}`).then(res => res.json()),
        fetch(`/api/drivers-salary/pending-advances/${driverId}?period=${encodeURIComponent(period)}`).then(res => res.json())
    ]);
}

// Update the openSalaryModal function to ensure event listeners work
function openSalaryModal(recordId = null) {
    const modal = document.getElementById('salaryModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('salaryForm');
    
    if (!recordId) {
        title.textContent = 'Add Driver Salary Record';
        form.reset();
        document.getElementById('recordId').value = '';
        document.getElementById('paymentDate').valueAsDate = new Date();
        
        // Clear trips list
        const container = document.getElementById('completedTripsList');
        if (container) {
            container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Select a driver and period to load trips</div>';
        }
        
        document.getElementById('selectedTripsCount').textContent = '0 trips selected';
        document.getElementById('totalTrips').value = 0;
        document.getElementById('grossEarnings').value = 0;
        
        // Clear values
        document.getElementById('taxDeduction').value = 0;
        document.getElementById('sssDeduction').value = 0;
        document.getElementById('philhealthDeduction').value = 0;
        document.getElementById('pagibigDeduction').value = 0;
        document.getElementById('loanDeduction').value = 0;
        document.getElementById('otherDeductions').value = 0;
        document.getElementById('advanceDeduction').value = 0;
        
        calculateTotals();
        
        // Check if both driver and period are already selected
        const driverId = document.getElementById('driverId').value;
        const period = document.getElementById('payPeriod').value;
        
        if (driverId && period) {
            setTimeout(() => {
                loadDriverCompletedTrips(driverId, period);
            }, 200);
        }
    } else {
        title.textContent = 'Edit Driver Salary Record';
        fetch(`/api/drivers-salary/records/${recordId}`)
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
    document.getElementById('driverId').value = record.driverId;
    document.getElementById('payPeriod').value = record.payPeriod || '';
    document.getElementById('totalTrips').value = record.totalTrips || 0;
    document.getElementById('grossEarnings').value = record.grossEarnings || 0;
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
    
    // Get selected trip IDs
    const selectedTrips = [];
    document.querySelectorAll('.trip-checkbox:checked').forEach(cb => {
        selectedTrips.push(cb.value);
    });
    
    if (selectedTrips.length === 0 && !document.getElementById('recordId').value) {
        Swal.fire({
            icon: 'error',
            title: 'No Trips Selected',
            text: 'Please select at least one completed trip.'
        });
        return;
    }
    
    const formData = {
        driverId: document.getElementById('driverId').value,
        payPeriod: document.getElementById('payPeriod').value,
        tripIds: selectedTrips,
        totalTrips: parseInt(document.getElementById('totalTrips').value) || 0,
        grossEarnings: parseFloat(document.getElementById('grossEarnings').value) || 0,
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
    const url = recordId ? `/api/drivers-salary/records/${recordId}` : '/api/drivers-salary/records';
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

// Load salary records
function loadSalaryRecords() {
    showLoading();
    
    const params = new URLSearchParams({
        search: document.getElementById('searchInput')?.value || '',
        status: document.getElementById('statusFilter')?.value || 'all',
        driverId: document.getElementById('driverFilter')?.value || 'all',
        payPeriod: document.getElementById('payPeriodFilter')?.value || 'all',
        dateRange: document.getElementById('dateRangeFilter')?.value || 'all',
        startDate: document.getElementById('startDate')?.value || '',
        endDate: document.getElementById('endDate')?.value || '',
        page: currentPage,
        limit: 10
    });
    
    fetch(`/api/drivers-salary/records?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                salaryRecords = data.data;
                totalPages = data.total_pages;
                renderSalaryTable(salaryRecords);
                updatePagination();
                updateRecordCount(data.total);
                updateCharts(salaryRecords);
            }
        })
        .catch(error => console.error('Error loading records:', error))
        .finally(() => hideLoading());
}

// Render salary table
function renderSalaryTable(records) {
    const tbody = document.getElementById('salaryTableBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">No salary records found</td></tr>';
        return;
    }
    
    let html = '';
    records.forEach(record => {
        const totalDeductions = (record.taxDeduction || 0) + (record.sssDeduction || 0) + 
                               (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) +
                               (record.loanDeduction || 0) + (record.otherDeductions || 0) +
                               (record.advanceDeduction || 0);
        
        html += `
            <tr>
                <td>
                    <div><strong>${record.driverName}</strong></div>
                    <div style="font-size:12px; color:#7f8c8d;">ID: ${record.driverId}</div>
                </td>
                <td>${record.payPeriod || 'N/A'}</td>
                <td>${record.totalTrips || 0}</td>
                <td>₱${(record.grossEarnings || 0).toLocaleString()}</td>
                <td>₱${((record.taxDeduction || 0) + (record.sssDeduction || 0) + (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) + (record.loanDeduction || 0) + (record.otherDeductions || 0)).toLocaleString()}</td>
                <td>₱${(record.advanceDeduction || 0).toLocaleString()}</td>
                <td><strong>₱${(record.netPay || 0).toLocaleString()}</strong></td>
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
                    <button class="action-btn action-delete" onclick="deleteSalaryRecord('${record.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// View salary record
function viewSalaryRecord(recordId) {
    fetch(`/api/drivers-salary/records/${recordId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const record = data.data;
                const container = document.getElementById('detailsContainer');
                const tripsDiv = document.getElementById('tripsIncluded');
                const modal = document.getElementById('detailsModal');
                
                const totalDeductions = (record.taxDeduction || 0) + (record.sssDeduction || 0) + 
                                       (record.philhealthDeduction || 0) + (record.pagibigDeduction || 0) +
                                       (record.loanDeduction || 0) + (record.otherDeductions || 0) +
                                       (record.advanceDeduction || 0);
                
                container.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">Driver:</span>
                        <span class="detail-value">${record.driverName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Pay Period:</span>
                        <span class="detail-value">${record.payPeriod || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Trips:</span>
                        <span class="detail-value">${record.totalTrips || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Gross Earnings:</span>
                        <span class="detail-value">₱${(record.grossEarnings || 0).toLocaleString()}</span>
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
                        <span class="detail-label">Total Deductions:</span>
                        <span class="detail-value">₱${totalDeductions.toLocaleString()}</span>
                    </div>
                    <div class="detail-row" style="border-bottom: 2px solid #3498db;">
                        <span class="detail-label"><strong>Net Pay:</strong></span>
                        <span class="detail-value"><strong>₱${(record.netPay || 0).toLocaleString()}</strong></span>
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
                
                // Show trips included
                if (record.trips && record.trips.length > 0) {
                    let tripsHtml = '';
                    record.trips.forEach(trip => {
                        tripsHtml += `
                            <tr>
                                <td>${new Date(trip.date).toLocaleDateString()}</td>
                                <td>${trip.time || '—'}</td>
                                <td>₱${parseFloat(trip.driverRate).toLocaleString()}</td>
                            </tr>
                        `;
                    });
                    document.getElementById('tripsIncludedBody').innerHTML = tripsHtml;
                    tripsDiv.style.display = 'block';
                } else {
                    tripsDiv.style.display = 'none';
                }
                
                currentRecordId = recordId;
                document.getElementById('editFromDetailsBtn').dataset.recordId = recordId;
                document.getElementById('generatePayslipDetailsBtn').dataset.recordId = recordId;
                
                modal.style.display = 'block';
            }
        });
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
            fetch(`/api/drivers-salary/records/${recordId}`, { method: 'DELETE' })
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

// Edit from details
function editFromDetails() {
    const recordId = document.getElementById('editFromDetailsBtn').dataset.recordId;
    closeAllModals();
    openSalaryModal(recordId);
}

// Generate payslip
function generatePayslip(recordId) {
    fetch(`/api/drivers-salary/generate-payslip/${recordId}`)
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

// Generate payslip from details
function generatePayslipFromDetails() {
    const recordId = document.getElementById('generatePayslipDetailsBtn').dataset.recordId;
    closeAllModals();
    generatePayslip(recordId);
}

// Display payslip
function displayPayslip(data) {
    const modal = document.getElementById('payslipModal');
    const container = document.getElementById('payslipContainer');
    
    container.innerHTML = `
        <div class="payslip-header">
            <h2>OLStar Transport</h2>
            <p>Driver Payslip - ${data.payPeriod}</p>
        </div>
        
        <div class="payslip-section">
            <h3>Driver Information</h3>
            <div class="payslip-row">
                <span>Driver Name:</span>
                <span>${data.driver.name}</span>
            </div>
            <div class="payslip-row">
                <span>Driver ID:</span>
                <span>${data.driver.id}</span>
            </div>
        </div>
        
        <div class="payslip-section">
            <h3>Earnings</h3>
            <div class="payslip-row">
                <span>Total Trips:</span>
                <span>${data.totalTrips}</span>
            </div>
            <div class="payslip-row">
                <span>Gross Earnings:</span>
                <span>₱${data.grossEarnings.toLocaleString()}</span>
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

// Update summary cards
function updateSummaryCards() {
    fetch('/api/drivers-salary/summary')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const summary = data.data;
                document.getElementById('totalDrivers').textContent = summary.totalDrivers;
                document.getElementById('monthlyPayout').textContent = `₱${summary.monthlyPayout.toLocaleString()}`;
                document.getElementById('monthlyPeriod').textContent = summary.monthlyPeriod;
                document.getElementById('pendingPayouts').textContent = `₱${summary.pendingPayouts.toLocaleString()}`;
                document.getElementById('pendingCount').textContent = `${summary.pendingCount} pending`;
                document.getElementById('completedTrips').textContent = summary.completedTrips;
            }
        })
        .catch(error => console.error('Error loading summary:', error));
}

// Load charts
function loadCharts() {
    fetch('/api/drivers-salary/analytics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const analytics = data.data;
                
                // Destroy existing charts
                if (charts.monthlyTrend) charts.monthlyTrend.destroy();
                if (charts.status) charts.status.destroy();
                
                // Monthly Trend Chart
                const trendCtx = document.getElementById('monthlyTrendChart')?.getContext('2d');
                if (trendCtx && analytics.monthlyTrend) {
                    charts.monthlyTrend = new Chart(trendCtx, {
                        type: 'line',
                        data: {
                            labels: analytics.monthlyTrend.labels || [],
                            datasets: [{
                                label: 'Monthly Payout',
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
                            }
                        }
                    });
                }
                
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
                                legend: { position: 'bottom' }
                            }
                        }
                    });
                }
                
                // Top Drivers List
                if (analytics.topDrivers) {
                    const container = document.getElementById('topDriversList');
                    let html = '';
                    analytics.topDrivers.forEach((driver, index) => {
                        html += `
                            <div class="driver-item">
                                <div class="driver-info">
                                    <div class="driver-name">${index + 1}. ${driver.name}</div>
                                </div>
                                <div class="driver-earnings">₱${driver.total.toLocaleString()}</div>
                            </div>
                        `;
                    });
                    container.innerHTML = html;
                }
                
                // Recent Trips List
                if (analytics.recentTrips) {
                    const container = document.getElementById('recentTripsList');
                    let html = '';
                    analytics.recentTrips.forEach(trip => {
                        html += `
                            <div class="trip-item">
                                <div class="trip-info">
                                    <div class="trip-date">${new Date(trip.date).toLocaleDateString()}</div>
                                    <div class="trip-details">${trip.driverName} • ${trip.time || ''}</div>
                                </div>
                                <div class="driver-earnings">₱${trip.driverRate.toLocaleString()}</div>
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
    
    const statusCounts = { paid: 0, pending: 0, processing: 0, cancelled: 0 };
    records.forEach(record => {
        if (statusCounts.hasOwnProperty(record.paymentStatus)) {
            statusCounts[record.paymentStatus]++;
        }
    });
    
    charts.status.data.datasets[0].data = Object.values(statusCounts);
    charts.status.update();
}

// Open completed schedules modal
function openCompletedSchedulesModal() {
    const modal = document.getElementById('completedSchedulesModal');
    loadCompletedTrips();
    modal.style.display = 'block';
}

// Update the renderCompletedTripsTable function
function renderCompletedTripsTable(trips) {
    const tbody = document.getElementById('completedTripsTableBody');
    if (!tbody) return;
    
    if (trips.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No completed trips found</td></tr>';
        return;
    }
    
    let html = '';
    trips.forEach(trip => {
        html += `
            <tr>
                <td>${new Date(trip.date).toLocaleDateString()}</td>
                <td>${trip.time || '—'}</td>
                <td>${trip.driverName || 'Unknown'}</td>
                <td>₱${parseFloat(trip.amount || 0).toLocaleString()}</td>
                <td>₱${parseFloat(trip.driverRate || 0).toLocaleString()}</td>
                <td><span class="status-badge status-paid">COMPLETED</span></td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="quickAddToSalary('${trip.driverId}', '${trip.driverName}', '${trip.date}')">
                        Add to Salary
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Update quickAddToSalary to work with driverName
function quickAddToSalary(driverId, driverName, tripDate) {
    closeAllModals();
    
    // Parse date to determine period
    const date = new Date(tripDate);
    const month = date.toLocaleString('default', { month: 'long' });
    const year = date.getFullYear();
    const day = date.getDate();
    const half = day <= 15 ? '1st Half' : '2nd Half';
    const period = `${month} ${year} - ${half}`;
    
    // Open salary modal with pre-selected driver and period
    setTimeout(() => {
        openSalaryModal();
        
        // Find and select the driver in dropdown
        const driverSelect = document.getElementById('driverId');
        for (let i = 0; i < driverSelect.options.length; i++) {
            if (driverSelect.options[i].value === driverId) {
                driverSelect.selectedIndex = i;
                break;
            }
        }
        
        document.getElementById('payPeriod').value = period;
        
        // Trigger change to load trips (will use driverName from selected option)
        const event = new Event('change');
        document.getElementById('driverId').dispatchEvent(event);
        document.getElementById('payPeriod').dispatchEvent(event);
    }, 100);
}

// Open payroll modal
function openPayrollModal() {
    Swal.fire({
        title: 'Process Driver Payroll',
        html: `
            <div style="text-align: left;">
                <p>This will create salary records for all drivers with completed trips in the selected period.</p>
                <select id="payrollPeriodSelect" class="swal2-select" style="width: 100%; margin-top: 10px;">
                    <option value="">Select Period</option>
                    <option value="January 2026 - 1st Half">January 2026 - 1st Half</option>
                    <option value="January 2026 - 2nd Half">January 2026 - 2nd Half</option>
                    <option value="February 2026 - 1st Half">February 2026 - 1st Half</option>
                    <option value="February 2026 - 2nd Half">February 2026 - 2nd Half</option>
                    <option value="March 2026 - 1st Half">March 2026 - 1st Half</option>
                    <option value="March 2026 - 2nd Half">March 2026 - 2nd Half</option>
                </select>
                <input type="date" id="payrollDateSelect" class="swal2-input" style="margin-top: 10px;" value="${new Date().toISOString().split('T')[0]}">
                <select id="payrollMethodSelect" class="swal2-select" style="width: 100%; margin-top: 10px;">
                    <option value="bank-transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Process',
        cancelButtonText: 'Cancel',
        preConfirm: () => {
            const period = document.getElementById('payrollPeriodSelect').value;
            const date = document.getElementById('payrollDateSelect').value;
            const method = document.getElementById('payrollMethodSelect').value;
            
            if (!period) {
                Swal.showValidationMessage('Please select a period');
                return false;
            }
            
            return { payrollPeriod: period, payrollDate: date, paymentMethod: method };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            processBulkPayroll(result.value);
        }
    });
}

// Process bulk payroll
function processBulkPayroll(data) {
    Swal.fire({
        title: 'Processing Payroll...',
        text: 'Please wait',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    fetch('/api/drivers-salary/process-payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
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
        inputValue: 'driver@example.com',
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