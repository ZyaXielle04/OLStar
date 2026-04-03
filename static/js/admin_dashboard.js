// =======================
// CACHE MANAGEMENT
// =======================
class DashboardDataManager {
    constructor() {
        this.cache = {
            dashboard: null,
            calendar: new Map()
        };
        this.lastFetch = {
            dashboard: 0,
            calendar: new Map()
        };
        this.cacheDuration = {
            dashboard: 5000,    // 5 seconds
            calendar: 30000     // 30 seconds
        };
        this.pendingRequests = new Map();
        this.refreshInterval = null;
    }

    async fetchWithDedupe(url, options = {}) {
        const key = `${url}_${JSON.stringify(options)}`;
        
        // If there's a pending request for the same URL, return that promise
        if (this.pendingRequests.has(key)) {
            console.log(`Deduplicating request to: ${url}`);
            return this.pendingRequests.get(key);
        }
        
        // Create new request
        const promise = fetch(url, options).then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        }).finally(() => {
            this.pendingRequests.delete(key);
        });
        
        this.pendingRequests.set(key, promise);
        return promise;
    }

    async getDashboardData(forceRefresh = false, includeRequests = true, includeDrivers = false) {
        const now = Date.now();
        const cacheAge = now - this.lastFetch.dashboard;
        
        // Return cached data if valid and not forcing refresh
        if (!forceRefresh && this.cache.dashboard && cacheAge < this.cacheDuration.dashboard) {
            console.log(`Using cached dashboard data (age: ${cacheAge}ms)`);
            return this.cache.dashboard;
        }
        
        console.log("Fetching fresh dashboard data...");
        const url = `/api/admin/dashboard-data?include_requests=${includeRequests}&include_drivers=${includeDrivers}&limit=10`;
        
        try {
            const data = await this.fetchWithDedupe(url);
            this.cache.dashboard = data;
            this.lastFetch.dashboard = now;
            return data;
        } catch (err) {
            console.error("Failed to fetch dashboard data:", err);
            // Return stale cache if available
            if (this.cache.dashboard) {
                console.log("Returning stale dashboard data");
                return this.cache.dashboard;
            }
            throw err;
        }
    }

    async getCalendarSchedules(startDate, endDate, forceRefresh = false) {
        const cacheKey = `${startDate}_${endDate}`;
        const now = Date.now();
        const cacheAge = now - (this.lastFetch.calendar.get(cacheKey) || 0);
        
        // Return cached data if valid
        if (!forceRefresh && this.cache.calendar.has(cacheKey) && cacheAge < this.cacheDuration.calendar) {
            console.log(`Using cached calendar data for range: ${cacheKey} (age: ${cacheAge}ms)`);
            return this.cache.calendar.get(cacheKey);
        }
        
        console.log(`Fetching calendar data for range: ${startDate} to ${endDate}`);
        const url = `/api/admin/calendar/schedules?start_date=${startDate}&end_date=${endDate}&limit=200`;
        
        try {
            const data = await this.fetchWithDedupe(url);
            this.cache.calendar.set(cacheKey, data);
            this.lastFetch.calendar.set(cacheKey, now);
            
            // Clean old cache entries (keep last 10)
            if (this.cache.calendar.size > 10) {
                const oldestKey = Array.from(this.lastFetch.calendar.entries())
                    .sort((a, b) => a[1] - b[1])[0][0];
                this.cache.calendar.delete(oldestKey);
                this.lastFetch.calendar.delete(oldestKey);
            }
            
            return data;
        } catch (err) {
            console.error("Failed to fetch calendar data:", err);
            // Return stale cache if available
            if (this.cache.calendar.has(cacheKey)) {
                console.log("Returning stale calendar data");
                return this.cache.calendar.get(cacheKey);
            }
            throw err;
        }
    }

    clearCache() {
        this.cache = {
            dashboard: null,
            calendar: new Map()
        };
        this.lastFetch = {
            dashboard: 0,
            calendar: new Map()
        };
        console.log("Dashboard cache cleared");
    }

    startAutoRefresh(intervalSeconds = 30) {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        
        this.refreshInterval = setInterval(() => {
            console.log("Auto-refreshing dashboard data...");
            this.refreshDashboard();
        }, intervalSeconds * 1000);
    }

    async refreshDashboard() {
        try {
            const data = await this.getDashboardData(true, true, false);
            updateDashboardUI(data);
            updateRecentRequestsUI(data);
        } catch (err) {
            console.error("Auto-refresh failed:", err);
        }
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Initialize data manager
const dataManager = new DashboardDataManager();

// =======================
// UI UPDATE FUNCTIONS
// =======================
function updateDashboardUI(data) {
    if (!data) return;
    
    document.getElementById("totalUsers").textContent = data.totalUsers || 0;
    document.getElementById("activeSessions").textContent = data.activeSessions || 0;
    document.getElementById("bookingsToday").textContent = data.bookingsToday || 0;
    document.getElementById("driversOnline").textContent = data.driversOnline || 0;
    document.getElementById("pendingRequests").textContent = data.pendingRequests || 0;
}

function updateRecentRequestsUI(data) {
    const container = document.getElementById("recentRequestsContainer");
    if (!container) return;
    
    if (!data.recentRequests || data.recentRequests.length === 0) {
        container.innerHTML = "<p>No requests found.</p>";
        return;
    }
    
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();
    
    data.recentRequests.forEach(req => {
        const card = document.createElement("div");
        card.className = "request-card";
        const statusClass = (req.status || "pending").toLowerCase();
        
        card.innerHTML = `
            <div class="card-header">
                <span class="amount">₱${req.amount || 0}</span>
                <span class="status ${statusClass}">${(req.status || "PENDING").toUpperCase()}</span>
            </div>
            <div class="card-body">
                <p><strong>Requested By:</strong> ${escapeHtml(req.requestedByName || 'Unknown')}</p>
                <p><strong>Date:</strong> ${formatTimestamp(req.timestamp)}</p>
                <div class="images">
                    ${createLink(req.receiptUrl, "Receipt")}
                    ${createLink(req.gcashUrl, "GCash")}
                    ${createLink(req.mileageURL, "Mileage")}
                </div>
            </div>
        `;
        fragment.appendChild(card);
    });
    
    container.appendChild(fragment);
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =======================
// CALENDAR FUNCTIONS
// =======================
let calendar = null;
let calendarRefreshTimeout = null;

async function initializeCalendar() {
    const calendarEl = document.getElementById('scheduleCalendar');
    if (!calendarEl) {
        console.error("Calendar element not found");
        return;
    }
    
    // Destroy existing calendar
    if (calendar) {
        calendar.destroy();
        calendar = null;
    }
    
    // Show loading state
    calendarEl.innerHTML = '<div class="calendar-loading">Loading schedules...</div>';
    
    try {
        // Get date range (last 30 days to next 60 days)
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 30);
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 60);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        // Fetch calendar data
        const data = await dataManager.getCalendarSchedules(startDateStr, endDateStr);
        
        if (!data.schedules || data.schedules.length === 0) {
            calendarEl.innerHTML = '<div class="calendar-loading">No schedules found. Add some schedules to see them in the calendar.</div>';
            setupEmptyCalendar(calendarEl);
            return;
        }
        
        // Transform schedules to events
        const events = transformSchedulesToEvents(data.schedules);
        
        // Setup calendar with events
        setupCalendarWithEvents(calendarEl, events);
        
    } catch (err) {
        console.error("Failed to load calendar data:", err);
        calendarEl.innerHTML = `<div class="calendar-error">Failed to load schedules: ${escapeHtml(err.message)}</div>`;
    }
}

function transformSchedulesToEvents(schedules) {
    const events = [];
    
    schedules.forEach((schedule, index) => {
        try {
            if (!schedule.date) return;
            
            const timeObj = parseTimeString(schedule.time);
            if (!timeObj) return;
            
            const [year, month, day] = schedule.date.split('-').map(Number);
            const startDateTime = new Date(year, month - 1, day, timeObj.hour, timeObj.minute);
            const endDateTime = new Date(startDateTime);
            endDateTime.setHours(endDateTime.getHours() + 1);
            
            // Get client name
            const clientName = schedule.clientName || schedule.passengerName || 'Unknown';
            const title = clientName !== 'Unknown' ? clientName : (schedule.flightNumber || schedule.transactionID || 'Booking');
            
            const event = {
                id: schedule.id || `schedule-${index}`,
                title: title,
                start: startDateTime,
                end: endDateTime,
                backgroundColor: getStatusColor(schedule.status),
                borderColor: getStatusColor(schedule.status),
                textColor: '#ffffff',
                extendedProps: schedule
            };
            
            events.push(event);
        } catch (err) {
            console.error(`Error processing schedule ${index}:`, err);
        }
    });
    
    console.log(`Created ${events.length} calendar events`);
    return events;
}

function setupEmptyCalendar(calendarEl) {
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        events: [],
        height: 'auto'
    });
    calendar.render();
}

function setupCalendarWithEvents(calendarEl, events) {
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Today',
            month: 'Month',
            week: 'Week',
            day: 'Day'
        },
        events: events,
        editable: false,
        selectable: true,
        selectMirror: true,
        dayMaxEvents: 3,
        weekends: true,
        height: 'auto',
        slotDuration: '00:30:00',
        slotMinTime: '00:00:00',
        slotMaxTime: '24:00:00',
        expandRows: true,
        stickyHeaderDates: true,
        nowIndicator: true,
        allDaySlot: false,
        slotEventOverlap: false,
        eventTimeFormat: {
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
        },
        slotLabelFormat: {
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
        },
        
        // Throttled date range change
        datesSet: function(info) {
            if (calendarRefreshTimeout) clearTimeout(calendarRefreshTimeout);
            calendarRefreshTimeout = setTimeout(() => {
                refreshCalendarForDateRange(info.start, info.end);
            }, 500);
        },
        
        eventDidMount: function(info) {
            // Style the event
            info.el.style.borderRadius = '4px';
            info.el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)';
            info.el.style.cursor = 'pointer';
            
            // View-specific styling
            if (info.view.type === 'dayGridMonth') {
                info.el.style.fontSize = '0.75rem';
                info.el.style.padding = '2px 4px';
                info.el.style.whiteSpace = 'nowrap';
                info.el.style.overflow = 'hidden';
                info.el.style.textOverflow = 'ellipsis';
            } else {
                info.el.style.fontSize = '0.8rem';
                info.el.style.padding = '4px 6px';
            }
            
            // Hover effect
            info.el.addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-1px)';
                this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            });
            info.el.addEventListener('mouseleave', function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)';
            });
        },
        
        eventContent: function(arg) {
            const event = arg.event;
            const props = event.extendedProps;
            
            if (arg.view.type === 'dayGridMonth') {
                let displayText = props.clientName || event.title;
                if (displayText.length > 12) displayText = displayText.substring(0, 10) + '...';
                return { html: `<div style="font-weight: 500;">${escapeHtml(displayText)}</div>` };
            } else {
                const timeStr = event.start.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                let displayName = props.clientName || event.title;
                if (displayName.length > 20) displayName = displayName.substring(0, 18) + '...';
                return {
                    html: `<div style="display: flex; flex-direction: column;">
                            <div style="font-size: 0.7rem; opacity: 0.9;">${escapeHtml(timeStr)}</div>
                            <div style="font-weight: 500;">${escapeHtml(displayName)}</div>
                           </div>`
                };
            }
        },
        
        eventClick: function(info) {
            showEventDetails(info.event);
        }
    });
    
    calendar.render();
    console.log("Calendar rendered successfully");
}

async function refreshCalendarForDateRange(start, end) {
    if (!calendar) return;
    
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];
    
    try {
        const data = await dataManager.getCalendarSchedules(startDateStr, endDateStr);
        
        if (data.schedules) {
            const newEvents = transformSchedulesToEvents(data.schedules);
            calendar.removeAllEvents();
            calendar.addEventSource(newEvents);
            console.log(`Calendar refreshed for range: ${startDateStr} to ${endDateStr}`);
        }
    } catch (err) {
        console.error("Failed to refresh calendar:", err);
    }
}

function showEventDetails(event) {
    // Remove existing modal
    const existingModal = document.getElementById('eventModal');
    if (existingModal) existingModal.remove();
    
    const props = event.extendedProps;
    
    const startDate = event.start.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
    const startTime = event.start.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    const endTime = event.end.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    
    const modal = document.createElement('div');
    modal.id = 'eventModal';
    modal.className = 'event-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Booking Details</h3>
                <button class="close-modal">&times;</button>
            </div>
            <div class="modal-body">
                <div class="detail-section">
                    <h4>Client Information</h4>
                    <p><strong>Client Name:</strong> ${escapeHtml(props.clientName || 'N/A')}</p>
                    <p><strong>Flight Number:</strong> ${escapeHtml(props.flightNumber || 'N/A')}</p>
                    <p><strong>Trip Type:</strong> ${escapeHtml(props.tripType || 'N/A')}</p>
                    <p><strong>Transaction ID:</strong> ${escapeHtml(props.transactionID || 'N/A')}</p>
                </div>
                <div class="detail-section">
                    <h4>Booking Details</h4>
                    <p><strong>Passengers:</strong> ${props.pax || '1'}</p>
                    <p><strong>Luggage:</strong> ${props.luggage || '0'} pieces</p>
                </div>
                <div class="detail-section">
                    <h4>Schedule</h4>
                    <p><strong>Date:</strong> ${startDate}</p>
                    <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
                    <p><strong>Pickup:</strong> ${escapeHtml(props.pickup || 'Not specified')}</p>
                </div>
                <div class="detail-section">
                    <h4>Vehicle Information</h4>
                    <p><strong>Unit:</strong> ${escapeHtml(props.transportUnit || 'N/A')}</p>
                    <p><strong>Type:</strong> ${escapeHtml(props.unitType || 'Vehicle')}</p>
                    <p><strong>Plate:</strong> ${escapeHtml(props.plateNumber || 'N/A')}</p>
                </div>
                <div class="detail-section">
                    <h4>Status</h4>
                    <p><span class="status-badge ${(props.status || 'pending').toLowerCase()}">${escapeHtml(props.status || 'Pending')}</span></p>
                </div>
                ${props.note ? `<div class="detail-section"><h4>Notes</h4><p>${escapeHtml(props.note)}</p></div>` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector('.close-modal').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// =======================
// HELPER FUNCTIONS
// =======================
function formatTimestamp(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
        hour12: true,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function createLink(url, label) {
    return url ? `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(label)}</a>` : "";
}

function parseTimeString(timeStr) {
    if (!timeStr) return null;
    timeStr = timeStr.trim().toUpperCase();
    
    const match = timeStr.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (match) {
        let hour = parseInt(match[1]);
        const minute = parseInt(match[2]) || 0;
        const period = match[3].toUpperCase();
        
        if (period === 'PM' && hour !== 12) hour += 12;
        else if (period === 'AM' && hour === 12) hour = 0;
        
        return { hour, minute };
    }
    
    const militaryMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (militaryMatch) {
        return {
            hour: parseInt(militaryMatch[1]),
            minute: parseInt(militaryMatch[2])
        };
    }
    
    return null;
}

function getStatusColor(status) {
    const statusLower = (status || '').toLowerCase();
    switch(statusLower) {
        case 'in-progress': case 'in progress': case 'ongoing':
            return '#f59e0b';
        case 'completed': case 'done':
            return '#10b981';
        case 'cancelled': case 'canceled':
            return '#ef4444';
        case 'pending':
            return '#f59e0b';
        case 'confirmed':
            return '#3b82f6';
        default:
            return '#3b82f6';
    }
}

// =======================
// INITIALIZATION
// =======================
document.addEventListener("DOMContentLoaded", async () => {
    console.log("Initializing optimized dashboard...");
    
    try {
        // Initial data load
        const data = await dataManager.getDashboardData(false, true, false);
        updateDashboardUI(data);
        updateRecentRequestsUI(data);
        
        // Initialize calendar
        await initializeCalendar();
        
        // Start auto-refresh (every 30 seconds)
        dataManager.startAutoRefresh(30);
        
        // Visibility API - pause refresh when tab is inactive
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log("Tab hidden - pausing auto-refresh");
                dataManager.stopAutoRefresh();
            } else {
                console.log("Tab visible - resuming auto-refresh");
                dataManager.startAutoRefresh(30);
                // Refresh immediately when tab becomes visible
                dataManager.refreshDashboard();
            }
        });
        
        console.log("Dashboard initialized successfully");
    } catch (error) {
        console.error('Error initializing dashboard:', error);
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    dataManager.stopAutoRefresh();
    if (calendar) {
        calendar.destroy();
    }
    if (calendarRefreshTimeout) {
        clearTimeout(calendarRefreshTimeout);
    }
});