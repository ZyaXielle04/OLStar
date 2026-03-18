// transactions_rfid.js - Complete with user name resolution and transaction history table

// API Base URL
const API_BASE = '/api/admin';

// State
let transportUnits = [];
let rfidCards = [];

// Cache for user data
let userCache = {};

// State for date filtering
let dateFilterState = {
    range: 'all',
    startDate: null,
    endDate: null,
    historyData: null
};

// ==================== LOAD INITIAL DATA ====================

// Load transport units for dropdown
async function loadTransportUnits() {
    try {
        const response = await fetch(`${API_BASE}/transport-units/list`);
        if (!response.ok) throw new Error('Failed to load transport units');
        
        const data = await response.json();
        transportUnits = data.units || [];
        
        // Populate unit filter dropdown
        const unitFilter = document.getElementById('unitFilter');
        const unitSelect = document.getElementById('unitSelect');
        
        let options = '<option value="">All Transport Units</option>';
        let selectOptions = '<option value="">— Unassigned —</option>';
        
        transportUnits.forEach(unit => {
            const displayText = `${unit.name} (${unit.plateNumber})`;
            options += `<option value="${unit.id}">${displayText}</option>`;
            selectOptions += `<option value="${unit.id}">${displayText}</option>`;
        });
        
        unitFilter.innerHTML = options;
        unitSelect.innerHTML = selectOptions;
        
    } catch (error) {
        console.error('Error loading transport units:', error);
        Swal.fire('Error', 'Failed to load transport units', 'error');
    }
}

// Load all users and cache them
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/users/list`);
        if (!response.ok) throw new Error('Failed to load users');
        
        const data = await response.json();
        const users = data.users || [];
        
        // Create a map of userId -> user object
        users.forEach(user => {
            userCache[user.id] = user;
        });
        
        console.log('Users loaded:', Object.keys(userCache).length);
    } catch (error) {
        console.error('Error loading users:', error);
        // Don't show error to user, just log it
    }
}

// Load all RFID cards
async function loadRFIDCards() {
    try {
        const response = await fetch(`${API_BASE}/rfid/cards`);
        if (!response.ok) throw new Error('Failed to load RFID cards');
        
        const data = await response.json();
        rfidCards = data.cards || [];
        displayCardsTable();
        updateSummaryCards();
        
    } catch (error) {
        console.error('Error loading RFID cards:', error);
        document.getElementById('rfidTableBody').innerHTML = 
            '<tr><td colspan="7" class="text-center">Error loading cards</td></tr>';
    }
}

// Display cards in table with filters
function displayCardsTable() {
    const tbody = document.getElementById('rfidTableBody');
    
    // Get filter values
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const unitFilter = document.getElementById('unitFilter')?.value || '';
    
    // Filter cards
    const filteredCards = rfidCards.filter(card => {
        // Status filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'low' && (card.balance || 0) >= 200) return false;
            if (statusFilter !== 'low' && card.status !== statusFilter) return false;
        }
        
        // Unit filter
        if (unitFilter && card.unitId !== unitFilter) return false;
        
        // Search filter
        if (searchTerm) {
            const cardMatch = card.cardNumber.toLowerCase().includes(searchTerm);
            const unitMatch = card.unitName ? 
                `${card.unitName} ${card.unitPlate}`.toLowerCase().includes(searchTerm) : false;
            return cardMatch || unitMatch;
        }
        
        return true;
    });
    
    // Generate table HTML with data-card-id attributes
    let html = '';
    filteredCards.forEach(card => {
        const statusClass = card.status === 'active' ? 'status-active' : 'status-inactive';
        const balanceClass = (card.balance || 0) < 200 ? 'low-balance' : '';
        
        html += `
            <tr data-card-id="${card.id}">
                <td><strong>${card.cardNumber}</strong></td>
                <td>${card.unitName || '—'}</td>
                <td>${card.unitPlate || '—'}</td>
                <td class="balance-cell ${balanceClass}">₱${(card.balance || 0).toFixed(2)}</td>
                <td>${card.lastUpdated ? new Date(parseInt(card.lastUpdated)).toLocaleDateString() : '—'}</td>
                <td><span class="status-badge ${statusClass}">${card.status || 'active'}</span></td>
                <td class="actions-cell">
                    <button onclick="editCard('${card.id}')" class="btn-icon" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="updateBalance('${card.id}', '${card.cardNumber}', ${card.balance || 0})" class="btn-icon" title="Update Balance">
                        <i class="fas fa-coins"></i>
                    </button>
                    <button onclick="adjustBalance('${card.id}', ${card.balance || 0})" class="btn-icon" title="Adjust Balance">
                        <i class="fas fa-plus-minus"></i>
                    </button>
                    <button onclick="deleteCard('${card.id}')" class="btn-icon delete" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">No RFID cards found</td></tr>';
    
    // If there's active history data, reapply highlights
    if (dateFilterState.historyData) {
        highlightAffectedCards(dateFilterState.historyData.history || []);
    }
}

// Update summary cards
function updateSummaryCards() {
    const totalCards = rfidCards.length;
    const totalBalance = rfidCards.reduce((sum, card) => sum + (card.balance || 0), 0);
    const lowBalanceCount = rfidCards.filter(card => (card.balance || 0) < 200).length;
    const assignedUnits = rfidCards.filter(card => card.unitId).length;
    
    document.getElementById('totalCards').textContent = totalCards;
    document.getElementById('totalBalance').textContent = `₱${totalBalance.toFixed(2)}`;
    document.getElementById('lowBalanceCount').textContent = lowBalanceCount;
    document.getElementById('assignedUnits').textContent = assignedUnits;
}

// ==================== USER NAME RESOLUTION ====================

// Get user display name from userId
function getUserDisplayName(userId, userEmail) {
    if (!userId) return userEmail || 'System';
    
    const user = userCache[userId];
    if (user) {
        const firstName = user.firstName || '';
        const lastName = user.lastName || '';
        if (firstName || lastName) {
            return `${firstName} ${lastName}`.trim();
        }
    }
    
    return userEmail || 'Unknown User';
}

// Format transaction type for display
function formatTransactionType(type) {
    if (!type) return 'unknown';
    
    // Convert snake_case or underscores to readable format
    const typeMap = {
        'add': 'Add/Reload',
        'subtract': 'Subtract/Deduction',
        'initial_balance': 'Initial Balance',
        'manual_update': 'Manual Update',
        'bulk_update': 'Bulk Update',
        'toll_deduction': 'Toll Deduction',
        'reload': 'Reload',
        'card_deleted': 'Card Deleted'
    };
    
    return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Display transaction items in the history table
function displayTransactionItems(history) {
    const tbody = document.getElementById('historyTableBody');
    const countSpan = document.getElementById('transactionCount');
    
    if (!history || history.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center">No transactions found for this period</td></tr>';
        if (countSpan) countSpan.textContent = '(0)';
        return;
    }
    
    // Update count
    if (countSpan) countSpan.textContent = `(${history.length})`;
    
    // Sort history by timestamp descending (newest first)
    const sortedHistory = [...history].sort((a, b) => {
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    
    let html = '';
    sortedHistory.forEach(record => {
        const timestamp = record.timestamp ? new Date(parseInt(record.timestamp)) : null;
        const dateStr = timestamp ? timestamp.toLocaleString() : '—';
        
        const type = record.type || 'unknown';
        const amount = record.amount || 0;
        const isPositive = type === 'add' || type === 'reload' || type === 'initial_balance';
        
        // Get user display name
        const userName = getUserDisplayName(record.userId, record.userEmail);
        
        // Determine badge class based on type
        let badgeClass = 'type-badge';
        if (type === 'add' || type === 'reload' || type === 'initial_balance') {
            badgeClass += ' type-add';
        } else if (type === 'subtract' || type === 'toll_deduction') {
            badgeClass += ' type-subtract';
        } else if (type === 'manual_update') {
            badgeClass += ' type-manual_update';
        } else if (type === 'bulk_update') {
            badgeClass += ' type-bulk_update';
        }
        
        // Amount class
        const amountClass = isPositive ? 'amount-positive' : 'amount-negative';
        const amountPrefix = isPositive ? '+' : '-';
        
        html += `
            <tr>
                <td title="${dateStr}">${dateStr}</td>
                <td>
                    <span class="card-link" onclick="editCard('${record.cardId}')" title="Click to view card">
                        ${record.cardNumber || '—'}
                    </span>
                </td>
                <td>
                    <span class="${badgeClass}">${formatTransactionType(type)}</span>
                </td>
                <td class="${amountClass}">
                    ${amountPrefix}₱${Math.abs(amount).toFixed(2)}
                </td>
                <td>
                    <div class="user-info">
                        <span class="user-name">${userName}</span>
                        ${record.userEmail && record.userEmail !== userName ? `<span class="user-email">${record.userEmail}</span>` : ''}
                    </div>
                </td>
                <td class="notes-cell" title="${record.note || ''}">
                    ${record.note || '—'}
                </td>
            </tr>
        `;
    });
    
    if (tbody) tbody.innerHTML = html;
}

// ==================== DATE FILTERING FUNCTIONS ====================

// Convert date string to timestamp in milliseconds
function dateToTimestamp(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    // Set to start of day for start date (12:00 AM)
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

// Convert date string to end of day timestamp
function dateToEndTimestamp(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    // Set to end of day (11:59:59 PM)
    date.setHours(23, 59, 59, 999);
    return date.getTime();
}

// Get date range based on selected filter (returns timestamps)
function getDateRangeFromFilter(filterValue) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let startDate = null;
    let endDate = null;
    
    console.log('Current date:', now.toString());
    console.log('Today (midnight):', today.toString());
    console.log('Filter value:', filterValue);
    
    switch(filterValue) {
        case 'today':
            startDate = new Date(today);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(today);
            endDate.setHours(23, 59, 59, 999);
            console.log('Today range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'yesterday':
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(today);
            endDate.setDate(today.getDate() - 1);
            endDate.setHours(23, 59, 59, 999);
            console.log('Yesterday range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'this_week':
            // Start from Monday
            startDate = new Date(today);
            const day = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
            // Adjust to get Monday (if Sunday, go back 6 days; otherwise go back day-1 days)
            const diff = day === 0 ? 6 : day - 1;
            startDate.setDate(today.getDate() - diff);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            console.log('This week range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'last_week':
            // Last week Monday to Sunday
            startDate = new Date(today);
            const lastWeekDay = today.getDay();
            // Go back to previous Monday
            const daysToLastMonday = lastWeekDay === 0 ? 6 : lastWeekDay + 6;
            startDate.setDate(today.getDate() - daysToLastMonday);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            endDate.setHours(23, 59, 59, 999);
            console.log('Last week range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'this_month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            console.log('This month range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'last_month':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            console.log('Last month range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'this_quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            startDate = new Date(now.getFullYear(), quarter * 3, 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            console.log('This quarter range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'last_quarter':
            const lastQuarter = Math.floor(now.getMonth() / 3) - 1;
            const year = lastQuarter >= 0 ? now.getFullYear() : now.getFullYear() - 1;
            const adjustedQuarter = lastQuarter >= 0 ? lastQuarter : 3;
            
            startDate = new Date(year, adjustedQuarter * 3, 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(year, adjustedQuarter * 3 + 3, 0, 23, 59, 59, 999);
            console.log('Last quarter range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'this_year':
            startDate = new Date(now.getFullYear(), 0, 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            console.log('This year range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'last_year':
            startDate = new Date(now.getFullYear() - 1, 0, 1);
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
            console.log('Last year range:', startDate.toString(), 'to', endDate.toString());
            break;
            
        case 'custom':
            return { custom: true };
            
        default:
            return { startDate: null, endDate: null };
    }
    
    return {
        startDate: startDate ? startDate.getTime() : null,
        endDate: endDate ? endDate.getTime() : null
    };
}

// Load transaction history with date filters
async function loadTransactionHistory() {
    const filterValue = document.getElementById('dateRangeFilter').value;
    let startDate = document.getElementById('startDate').value;
    let endDate = document.getElementById('endDate').value;
    
    let url = `${API_BASE}/rfid/history?limit=5000`;
    
    if (filterValue === 'custom') {
        // Convert custom dates to timestamps
        if (startDate) {
            const startTimestamp = dateToTimestamp(startDate);
            url += `&startDate=${startTimestamp}`;
            console.log('Custom start timestamp:', startTimestamp, new Date(startTimestamp).toString());
        }
        if (endDate) {
            const endTimestamp = dateToEndTimestamp(endDate);
            url += `&endDate=${endTimestamp}`;
            console.log('Custom end timestamp:', endTimestamp, new Date(endTimestamp).toString());
        }
    } else {
        const dateRange = getDateRangeFromFilter(filterValue);
        if (dateRange.startDate) url += `&startDate=${dateRange.startDate}`;
        if (dateRange.endDate) url += `&endDate=${dateRange.endDate}`;
    }
    
    console.log('Fetching history with URL:', url);
    
    // Show loading state
    const historySection = document.getElementById('historySummarySection');
    historySection.style.display = 'block';
    historySection.innerHTML = `
        <div class="summary-header">
            <h3>Loading transaction history...</h3>
        </div>
        <div class="text-center">
            <i class="fas fa-spinner fa-spin fa-3x"></i>
        </div>
    `;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to load transaction history');
        
        const data = await response.json();
        console.log('History data received:', data);
        
        // Double-check filtering on frontend to ensure accuracy
        if (data.history && data.history.length > 0) {
            // Get the actual date range used
            const dateRange = filterValue === 'custom' 
                ? { startDate: dateToTimestamp(startDate), endDate: dateToEndTimestamp(endDate) }
                : getDateRangeFromFilter(filterValue);
            
            console.log('Filtering with date range:', dateRange);
            
            // Filter history on frontend as a safety check
            const filteredHistory = data.history.filter(record => {
                const timestamp = record.timestamp;
                if (!timestamp) return false;
                
                const withinRange = (!dateRange.startDate || timestamp >= dateRange.startDate) &&
                                   (!dateRange.endDate || timestamp <= dateRange.endDate);
                
                if (!withinRange) {
                    console.log('Record outside range:', {
                        timestamp: timestamp,
                        date: new Date(timestamp).toString(),
                        startDate: dateRange.startDate ? new Date(dateRange.startDate).toString() : null,
                        endDate: dateRange.endDate ? new Date(dateRange.endDate).toString() : null
                    });
                }
                
                return withinRange;
            });
            
            console.log(`Original history count: ${data.history.length}, Filtered count: ${filteredHistory.length}`);
            
            // Recalculate summary based on filtered history
            if (filteredHistory.length !== data.history.length) {
                const newSummary = calculateSummary(filteredHistory);
                data.history = filteredHistory;
                data.summary = newSummary;
            }
        }
        
        dateFilterState.historyData = data;
        
        // Restore and update the history section
        rebuildHistorySection(data);
        
    } catch (error) {
        console.error('Error loading transaction history:', error);
        historySection.style.display = 'none';
        Swal.fire('Error', 'Failed to load transaction history', 'error');
    }
}

// Calculate summary from history data
function calculateSummary(history) {
    let totalReloads = 0;
    let totalDeductions = 0;
    
    history.forEach(record => {
        const amount = record.amount || 0;
        const type = record.type || '';
        
        if (type === 'add' || type === 'reload' || type === 'initial_balance') {
            totalReloads += amount;
        } else if (type === 'subtract' || type === 'toll_deduction') {
            totalDeductions += amount;
        }
    });
    
    return {
        totalTransactions: history.length,
        totalReloads: totalReloads,
        totalDeductions: totalDeductions
    };
}

// Rebuild history section with data (includes transaction table)
function rebuildHistorySection(data) {
    const historySection = document.getElementById('historySummarySection');
    const summary = data.summary || {};
    const filterSelect = document.getElementById('dateRangeFilter');
    const selectedOption = filterSelect.options[filterSelect.selectedIndex].text;
    
    // Format the summary values
    const totalReloads = summary.totalReloads || 0;
    const totalDeductions = summary.totalDeductions || 0;
    const netChange = totalReloads - totalDeductions;
    
    historySection.innerHTML = `
        <div class="summary-header">
            <h3>Transaction History Summary <span>(${selectedOption})</span></h3>
            <button id="hideSummaryBtn" class="btn btn-sm btn-secondary">Hide</button>
        </div>
        <div class="summary-cards small">
            <div class="summary-card">
                <div class="summary-icon blue">
                    <i class="fas fa-exchange-alt"></i>
                </div>
                <div class="summary-details">
                    <h4>Total Transactions</h4>
                    <div class="summary-value" id="totalTransactions">${summary.totalTransactions || 0}</div>
                </div>
            </div>
            
            <div class="summary-card">
                <div class="summary-icon green">
                    <i class="fas fa-arrow-up"></i>
                </div>
                <div class="summary-details">
                    <h4>Total Reloads</h4>
                    <div class="summary-value" id="totalReloads">₱${totalReloads.toFixed(2)}</div>
                </div>
            </div>
            
            <div class="summary-card">
                <div class="summary-icon red">
                    <i class="fas fa-arrow-down"></i>
                </div>
                <div class="summary-details">
                    <h4>Total Deductions</h4>
                    <div class="summary-value" id="totalDeductions">₱${totalDeductions.toFixed(2)}</div>
                </div>
            </div>
            
            <div class="summary-card">
                <div class="summary-icon purple">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="summary-details">
                    <h4>Net Change</h4>
                    <div class="summary-value" id="netChange" style="color: ${netChange >= 0 ? '#28a745' : '#dc3545'}">
                        ₱${Math.abs(netChange).toFixed(2)}
                    </div>
                </div>
            </div>
        </div>

        <!-- Transaction History Table -->
        <div class="history-table-container">
            <h4 class="history-table-title">
                <i class="fas fa-list"></i> Filtered Transactions
                <span class="transaction-count" id="transactionCount">(${data.history ? data.history.length : 0})</span>
            </h4>
            <div class="table-responsive">
                <table class="history-table" id="historyTable">
                    <thead>
                        <tr>
                            <th>Date & Time</th>
                            <th>Card Number</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>User</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        <tr>
                            <td colspan="6" class="text-center">Loading transactions...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    // Display the transaction items
    displayTransactionItems(data.history || []);
    
    // Re-attach hide button event listener
    document.getElementById('hideSummaryBtn').addEventListener('click', () => {
        historySection.style.display = 'none';
        // Remove highlights
        document.querySelectorAll('#rfidTableBody tr').forEach(row => {
            row.classList.remove('has-history');
            const indicator = row.querySelector('.history-indicator');
            if (indicator) indicator.remove();
        });
    });
    
    // Highlight affected cards
    highlightAffectedCards(data.history || []);
}

// Highlight cards that had transactions in the filtered period
function highlightAffectedCards(history) {
    const affectedCardIds = new Set(history.map(h => h.cardId).filter(id => id));
    
    console.log('Affected card IDs:', affectedCardIds);
    
    // Add highlight class to rows of affected cards
    const rows = document.querySelectorAll('#rfidTableBody tr');
    rows.forEach(row => {
        const cardId = row.dataset.cardId;
        if (cardId && affectedCardIds.has(cardId)) {
            row.classList.add('has-history');
            
            // Add indicator to balance cell
            const balanceCell = row.querySelector('.balance-cell');
            if (balanceCell && !balanceCell.querySelector('.history-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'history-indicator';
                indicator.title = 'Has transactions in selected period';
                indicator.innerHTML = '<i class="fas fa-history"></i>';
                balanceCell.appendChild(indicator);
            }
        } else {
            row.classList.remove('has-history');
            const indicator = row.querySelector('.history-indicator');
            if (indicator) indicator.remove();
        }
    });
}

// Export filtered history data
function exportFilteredHistory() {
    if (!dateFilterState.historyData || !dateFilterState.historyData.history) {
        Swal.fire('Info', 'No history data to export', 'info');
        return;
    }
    
    const history = dateFilterState.historyData.history;
    
    // Convert history to CSV
    const headers = ['Date', 'Card Number', 'Type', 'Amount', 'Old Balance', 'New Balance', 'Note', 'User'];
    const csvRows = [];
    
    csvRows.push(headers.join(','));
    
    history.forEach(record => {
        const date = record.timestamp ? new Date(parseInt(record.timestamp)).toLocaleString() : '';
        const userName = getUserDisplayName(record.userId, record.userEmail);
        const row = [
            `"${date}"`,
            `"${record.cardNumber || ''}"`,
            `"${record.type || ''}"`,
            record.amount || 0,
            record.oldBalance || 0,
            record.newBalance || 0,
            `"${(record.note || '').replace(/"/g, '""')}"`,
            `"${userName}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const filterValue = document.getElementById('dateRangeFilter').value;
    a.download = `rfid_history_${filterValue}_${new Date().toISOString().split('T')[0]}.csv`;
    
    a.click();
    window.URL.revokeObjectURL(url);
}

// Export cards to CSV
function exportCardsToCSV() {
    const headers = ['Card Number', 'Transport Unit', 'Plate Number', 'Balance', 'Status', 'Last Updated', 'Notes'];
    const csvRows = [];
    
    csvRows.push(headers.join(','));
    
    rfidCards.forEach(card => {
        const row = [
            `"${card.cardNumber}"`,
            `"${card.unitName || ''}"`,
            `"${card.unitPlate || ''}"`,
            card.balance || 0,
            `"${card.status || 'active'}"`,
            `"${card.lastUpdated ? new Date(parseInt(card.lastUpdated)).toLocaleDateString() : ''}"`,
            `"${(card.notes || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rfid_cards_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// ==================== CRUD OPERATIONS ====================

// Add/Edit card form submit
document.getElementById('cardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cardId = document.getElementById('cardId').value;
    const unitId = document.getElementById('unitSelect').value;
    
    const cardData = {
        cardNumber: document.getElementById('cardNumber').value,
        unitId: unitId || null,
        balance: parseFloat(document.getElementById('currentBalance').value) || 0,
        status: document.getElementById('cardStatus').value,
        notes: document.getElementById('cardNotes').value
    };
    
    try {
        let response;
        if (cardId) {
            // Update existing card
            response = await fetch(`${API_BASE}/rfid/cards/${cardId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cardData)
            });
        } else {
            // Create new card
            response = await fetch(`${API_BASE}/rfid/cards`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cardData)
            });
        }
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Operation failed');
        }
        
        Swal.fire('Success', cardId ? 'Card updated successfully' : 'Card added successfully', 'success');
        closeModal('cardModal');
        document.getElementById('cardForm').reset();
        await loadRFIDCards(); // Reload data
        
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
});

// Edit card
window.editCard = async (id) => {
    try {
        const response = await fetch(`${API_BASE}/rfid/cards/${id}`);
        if (!response.ok) throw new Error('Failed to load card details');
        
        const data = await response.json();
        const card = data.card;
        
        document.getElementById('modalTitle').textContent = 'Edit RFID Card';
        document.getElementById('cardId').value = id;
        document.getElementById('cardNumber').value = card.cardNumber;
        document.getElementById('unitSelect').value = card.unitId || '';
        document.getElementById('currentBalance').value = card.balance || 0;
        document.getElementById('cardStatus').value = card.status || 'active';
        document.getElementById('cardNotes').value = card.notes || '';
        
        openModal('cardModal');
        
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
};

// Quick balance update
window.updateBalance = (id, cardNumber, currentBalance) => {
    Swal.fire({
        title: `Update Balance for ${cardNumber}`,
        html: `
            <div style="text-align: left;">
                <p>Current Balance: <strong>₱${currentBalance.toFixed(2)}</strong></p>
                <input type="number" id="newBalance" class="swal2-input" 
                       step="0.01" min="0" value="${currentBalance}" placeholder="New Balance">
                <input type="text" id="updateNote" class="swal2-input" 
                       placeholder="Note (optional)">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Update',
        preConfirm: () => {
            const newBalance = document.getElementById('newBalance').value;
            if (!newBalance) {
                Swal.showValidationMessage('Please enter a balance');
                return false;
            }
            return {
                balance: parseFloat(newBalance),
                note: document.getElementById('updateNote').value
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`${API_BASE}/rfid/cards/${id}/balance`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        balance: result.value.balance,
                        note: result.value.note
                    })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error);
                }
                
                Swal.fire('Success', 'Balance updated successfully', 'success');
                await loadRFIDCards();
                
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });
};

// Adjust balance (add/subtract)
window.adjustBalance = (id, currentBalance) => {
    Swal.fire({
        title: 'Adjust Balance',
        html: `
            <div style="text-align: left;">
                <p>Current Balance: <strong>₱${currentBalance.toFixed(2)}</strong></p>
                <select id="adjustType" class="swal2-select" style="margin-bottom: 10px;">
                    <option value="add">Add (Reload)</option>
                    <option value="subtract">Subtract (Toll Deduction)</option>
                </select>
                <input type="number" id="adjustAmount" class="swal2-input" 
                       step="0.01" min="0" placeholder="Amount">
                <input type="text" id="adjustNote" class="swal2-input" 
                       placeholder="Note (e.g., Reload, Toll payment)">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Apply',
        preConfirm: () => {
            const amount = parseFloat(document.getElementById('adjustAmount').value);
            if (!amount || amount <= 0) {
                Swal.showValidationMessage('Please enter a valid amount');
                return false;
            }
            return {
                type: document.getElementById('adjustType').value,
                amount: amount,
                note: document.getElementById('adjustNote').value
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`${API_BASE}/rfid/cards/${id}/adjust`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error);
                }
                
                const data = await response.json();
                Swal.fire('Success', data.message, 'success');
                await loadRFIDCards();
                
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });
};

// Delete card
window.deleteCard = (id) => {
    Swal.fire({
        title: 'Delete RFID Card?',
        text: 'This action cannot be undone',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Delete'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`${API_BASE}/rfid/cards/${id}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error);
                }
                
                Swal.fire('Deleted!', 'Card has been deleted.', 'success');
                await loadRFIDCards();
                
            } catch (error) {
                Swal.fire('Error', error.message, 'error');
            }
        }
    });
};

// ==================== BULK OPERATIONS ====================

// Quick Balance Update Modal
document.getElementById('bulkUpdateBtn')?.addEventListener('click', async () => {
    try {
        // Load latest cards
        const response = await fetch(`${API_BASE}/rfid/cards`);
        const data = await response.json();
        const cards = data.cards || [];
        
        // Generate bulk update list
        const listDiv = document.getElementById('quickBalanceList');
        let html = '';
        
        cards.forEach(card => {
            const balanceClass = (card.balance || 0) < 200 ? 'low' : '';
            html += `
                <div class="quick-balance-item" data-card-id="${card.id}">
                    <div class="card-info">
                        <span class="card-number">${card.cardNumber}</span>
                        <span class="unit-info">${card.unitName || 'Unassigned'} ${card.unitPlate || ''}</span>
                    </div>
                    <div class="current-balance ${balanceClass}">
                        ₱${(card.balance || 0).toFixed(2)}
                    </div>
                    <input type="number" class="balance-input" 
                           data-original="${card.balance || 0}"
                           placeholder="New balance" step="0.01" min="0">
                </div>
            `;
        });
        
        listDiv.innerHTML = html || '<p class="text-center">No cards to update</p>';
        openModal('quickBalanceModal');
        
    } catch (error) {
        Swal.fire('Error', 'Failed to load cards for bulk update', 'error');
    }
});

// Save all bulk updates
document.getElementById('saveAllBalances')?.addEventListener('click', async () => {
    const updates = [];
    const items = document.querySelectorAll('.quick-balance-item');
    
    items.forEach(item => {
        const input = item.querySelector('.balance-input');
        const newBalance = parseFloat(input.value);
        
        if (!isNaN(newBalance) && newBalance !== parseFloat(input.dataset.original)) {
            updates.push({
                id: item.dataset.cardId,
                balance: newBalance
            });
        }
    });
    
    if (updates.length === 0) {
        Swal.fire('Info', 'No changes to save', 'info');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/rfid/cards/bulk/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }
        
        const result = await response.json();
        Swal.fire('Success', result.message, 'success');
        closeModal('quickBalanceModal');
        await loadRFIDCards();
        
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
});

// ==================== EXPORT DATA ====================

// Export button with options
document.getElementById('exportDataBtn')?.addEventListener('click', (e) => {
    // Show export options
    Swal.fire({
        title: 'Export Options',
        html: `
            <div style="text-align: left; padding: 10px;">
                <label style="display: block; margin-bottom: 10px; cursor: pointer;">
                    <input type="radio" name="exportType" value="cards" checked style="margin-right: 8px;"> 
                    <span>Export RFID Cards</span>
                </label>
                <label style="display: block; margin-bottom: 10px; cursor: pointer;">
                    <input type="radio" name="exportType" value="history" style="margin-right: 8px;"> 
                    <span>Export Transaction History (filtered)</span>
                </label>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Export',
        preConfirm: () => {
            const exportType = document.querySelector('input[name="exportType"]:checked');
            return exportType ? exportType.value : 'cards';
        }
    }).then((result) => {
        if (result.isConfirmed) {
            if (result.value === 'cards') {
                exportCardsToCSV();
            } else {
                exportFilteredHistory();
            }
        }
    });
});

// ==================== FILTER LISTENERS ====================

document.getElementById('searchInput')?.addEventListener('input', displayCardsTable);
document.getElementById('statusFilter')?.addEventListener('change', displayCardsTable);
document.getElementById('unitFilter')?.addEventListener('change', displayCardsTable);

// Date range filter change
document.getElementById('dateRangeFilter')?.addEventListener('change', function() {
    const customRange = document.getElementById('customDateRange');
    if (this.value === 'custom') {
        customRange.style.display = 'flex';
    } else {
        customRange.style.display = 'none';
        if (this.value !== 'all') {
            loadTransactionHistory();
        } else {
            // Hide history section when "All Time" is selected
            document.getElementById('historySummarySection').style.display = 'none';
            // Remove highlights
            document.querySelectorAll('#rfidTableBody tr').forEach(row => {
                row.classList.remove('has-history');
                const indicator = row.querySelector('.history-indicator');
                if (indicator) indicator.remove();
            });
        }
    }
});

// Apply custom date filter
document.getElementById('applyDateFilter')?.addEventListener('click', () => {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) {
        Swal.fire('Warning', 'Please select both start and end dates', 'warning');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        Swal.fire('Warning', 'Start date must be before end date', 'warning');
        return;
    }
    
    loadTransactionHistory();
});

// Refresh data button
document.getElementById('refreshDataBtn')?.addEventListener('click', () => {
    loadRFIDCards();
    if (document.getElementById('dateRangeFilter').value !== 'all') {
        loadTransactionHistory();
    }
});

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
    await loadTransportUnits();
    await loadUsers(); // Load users for name resolution
    await loadRFIDCards();
    
    // Set default dates for custom range
    const today = new Date().toISOString().split('T')[0];
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    document.getElementById('startDate').value = lastMonth.toISOString().split('T')[0];
    document.getElementById('endDate').value = today;
    
    // Add New Card button
    document.getElementById('addNewCardBtn').addEventListener('click', () => {
        document.getElementById('modalTitle').textContent = 'Add New RFID Card';
        document.getElementById('cardId').value = '';
        document.getElementById('cardForm').reset();
        openModal('cardModal');
    });
    
    // Modal close handlers
    document.querySelectorAll('.close-modal, .cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal('cardModal');
            closeModal('quickBalanceModal');
        });
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal('cardModal');
            closeModal('quickBalanceModal');
        }
    });
});

// ==================== HELPER FUNCTIONS ====================

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}