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
  return url ? `<a href="${url}" target="_blank">${label}</a>` : "";
}

function isToday(dateStr) {
  const today = new Date();
  const date = new Date(dateStr);
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

// Parse time string like "8:55PM" to proper format
function parseTimeString(timeStr) {
  if (!timeStr) return null;
  
  // Handle different time formats
  timeStr = timeStr.trim().toUpperCase();
  
  // Check if it's in format like "8:55PM" or "8:55 AM"
  const match = timeStr.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
  if (match) {
    let hour = parseInt(match[1]);
    const minute = parseInt(match[2]) || 0;
    const period = match[3].toUpperCase();
    
    // Convert to 24-hour format
    if (period === 'PM' && hour !== 12) {
      hour += 12;
    } else if (period === 'AM' && hour === 12) {
      hour = 0;
    }
    
    return { hour, minute };
  }
  
  // Try format like "14:30"
  const militaryMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (militaryMatch) {
    return {
      hour: parseInt(militaryMatch[1]),
      minute: parseInt(militaryMatch[2])
    };
  }
  
  return null;
}

// Get status color for calendar events
function getStatusColor(status) {
  const statusLower = (status || '').toLowerCase();
  switch(statusLower) {
    case 'in-progress':
    case 'in progress':
    case 'ongoing':
      return '#f59e0b'; // orange
    case 'completed':
    case 'done':
      return '#10b981'; // green
    case 'cancelled':
    case 'canceled':
      return '#ef4444'; // red
    case 'pending':
      return '#f59e0b'; // orange-yellow
    case 'confirmed':
      return '#3b82f6'; // blue
    default:
      return '#3b82f6'; // blue for scheduled/pending
  }
}

// =======================
// METRICS
// =======================
async function fetchDashboardMetrics() {
  try {
    const res = await fetch("/api/admin/dashboard");
    const data = await res.json();

    document.getElementById("totalUsers").textContent = data.totalUsers || 0;
    document.getElementById("activeSessions").textContent = data.activeSessions || 0;
    document.getElementById("bookingsToday").textContent = data.bookingsToday || 0;
    document.getElementById("driversOnline").textContent = data.driversOnline || 0;
    document.getElementById("pendingRequests").textContent = data.pendingRequests || 0;
  } catch (err) {
    console.error("Failed to fetch dashboard metrics:", err);
  }
}

// =======================
// RECENT REQUESTS
// =======================
async function fetchRecentRequests() {
  const container = document.getElementById("recentRequestsContainer");
  try {
    const res = await fetch("/api/admin/requests");
    const data = await res.json();

    if (!data.requests?.length) {
      container.innerHTML = "<p>No requests found.</p>";
      return;
    }

    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    data.requests.forEach(req => {
      const card = document.createElement("div");
      card.className = "request-card";

      const statusClass = (req.status || "pending").toLowerCase();
      const requestedBy = req.requestedByName || req.requestedBy || "Unknown";
      const timestampFormatted = formatTimestamp(req.timestamp);

      // Highlight today
      const highlightToday = isToday(req.timestamp) ? "highlight-today" : "";

      card.innerHTML = `
        <div class="card-header ${highlightToday}">
          <span class="amount">₱${req.amount}</span>
          <span class="status ${statusClass}">${(req.status || "PENDING").toUpperCase()}</span>
        </div>
        <div class="card-body">
          <p><strong>Requested By:</strong> ${requestedBy}</p>
          <p><strong>Date:</strong> ${timestampFormatted}</p>
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
  } catch (err) {
    console.error("Failed to load requests:", err);
    container.innerHTML = "<p>Error loading requests.</p>";
  }
}

// =======================
// CALENDAR - GOOGLE CALENDAR LIKE VIEW
// =======================
let calendar = null;

async function initializeCalendar() {
  const calendarEl = document.getElementById('scheduleCalendar');
  
  if (!calendarEl) {
    console.error("Calendar element not found");
    return;
  }

  // Destroy existing calendar if it exists
  if (calendar) {
    calendar.destroy();
  }

  // Show loading state
  calendarEl.innerHTML = '<div class="calendar-loading">Loading schedules...</div>';

  try {
    // Fetch schedules from the API
    console.log("Fetching calendar data...");
    const res = await fetch("/api/admin/calendar/schedules");
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const data = await res.json();
    
    console.log(`Found ${data.schedules?.length || 0} schedules`);
    
    // Debug: log first schedule to see if clientName is present
    if (data.schedules && data.schedules.length > 0) {
      console.log("First schedule data:", data.schedules[0]);
      console.log("Client Name present:", data.schedules[0].clientName);
    }
    
    if (!data.schedules || data.schedules.length === 0) {
      calendarEl.innerHTML = '<div class="calendar-loading">No schedules found. Add some schedules to see them in the calendar.</div>';
      
      // Initialize empty calendar
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
        events: [],
        editable: false,
        selectable: true,
        selectMirror: true,
        dayMaxEvents: 3,
        weekends: true,
        height: 'auto',
        eventDisplay: 'block',
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
        // Week view specific settings
        slotDuration: '00:30:00', // 30-minute slots
        slotMinTime: '00:00:00', // Start at midnight
        slotMaxTime: '24:00:00', // End at midnight
        expandRows: true, // Expand rows to fill height
        stickyHeaderDates: true, // Keep header visible when scrolling
        nowIndicator: true, // Show current time indicator
        allDaySlot: false, // Hide all-day slot to save space
        slotEventOverlap: false, // Prevent events from overlapping
      });
      
      calendar.render();
      return;
    }

    // Transform schedules into calendar events
    const events = [];
    
    data.schedules.forEach((schedule, index) => {
      try {
        // Skip if no date
        if (!schedule.date) {
          console.warn(`Schedule ${schedule.id || index} has no date, skipping`);
          return;
        }
        
        // Parse time
        const timeObj = parseTimeString(schedule.time);
        if (!timeObj) {
          console.warn(`Could not parse time for schedule ${schedule.id || index}:`, schedule.time);
          return;
        }
        
        // Create start datetime
        const [year, month, day] = schedule.date.split('-').map(Number);
        const startDateTime = new Date(year, month - 1, day, timeObj.hour, timeObj.minute);
        
        // Calculate end time (default 1 hour later)
        const endDateTime = new Date(startDateTime);
        endDateTime.setHours(endDateTime.getHours() + 1);

        // Get booking info
        const clientName = schedule.clientName || schedule.passengerName || 'Unknown';
        const flightNumber = schedule.flightNumber || '';
        const pax = schedule.pax || '1';
        const luggage = schedule.luggage || '0';
        const unitType = schedule.unitType || schedule.transportUnit || 'Vehicle';
        const plateNumber = schedule.plateNumber || '';
        const tripType = schedule.tripType || '';
        const transactionID = schedule.transactionID || '';
        const pickup = schedule.pickup || 'Not specified';
        const note = schedule.note || schedule.notes || '';
        
        // Create event title based on view
        let title = clientName;
        if (title === 'Unknown' || title.length === 0) {
          title = flightNumber || transactionID || 'Booking';
        }
        
        // Different truncation for different views (handled in eventDidMount)

        // Determine status color
        const status = schedule.status || 'pending';
        const color = getStatusColor(status);

        // Create event object with all available data
        const event = {
          id: schedule.id || `schedule-${index}`,
          title: title,
          start: startDateTime,
          end: endDateTime,
          backgroundColor: color,
          borderColor: color,
          textColor: '#ffffff',
          display: 'block',
          extendedProps: {
            // Client information
            clientName: clientName,
            
            // Flight information
            flightNumber: flightNumber,
            tripType: tripType,
            transactionID: transactionID,
            
            // Passenger details
            pax: pax,
            luggage: luggage,
            
            // Schedule details
            pickup: pickup,
            time: schedule.time,
            date: schedule.date,
            
            // Vehicle information
            unitType: unitType,
            transportUnit: schedule.transportUnit || unitType,
            plateNumber: plateNumber,
            
            // Status
            status: status,
            
            // Additional notes
            notes: note,
            
            // Raw data for debugging
            rawData: schedule
          }
        };
        
        events.push(event);
        
      } catch (err) {
        console.error(`Error processing schedule ${index}:`, err);
      }
    });

    console.log(`Total events created: ${events.length}`);

    // Initialize FullCalendar with improved settings for both views
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
      
      // Month view settings
      dayMaxEvents: 3, // Show max 3 events per day in month view
      
      // Week/Day view settings
      slotDuration: '00:30:00', // 30-minute time slots
      slotMinTime: '00:00:00', // Start at midnight
      slotMaxTime: '24:00:00', // End at midnight
      expandRows: true, // Make rows expand to fill height
      stickyHeaderDates: true, // Keep headers visible
      nowIndicator: true, // Show current time line
      allDaySlot: false, // Hide all-day slot
      slotEventOverlap: false, // Prevent event overlap
      
      weekends: true,
      height: 'auto',
      eventDisplay: 'block',
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
      
      // Custom event rendering based on view
      eventDidMount: function(info) {
        const view = info.view.type;
        
        // Common styles for all views
        info.el.style.borderRadius = '4px';
        info.el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)';
        info.el.style.transition = 'all 0.2s ease';
        info.el.style.cursor = 'pointer';
        
        // View-specific styles
        if (view === 'dayGridMonth') {
          // Month view - compact
          info.el.style.fontSize = '0.75rem';
          info.el.style.padding = '2px 4px';
          info.el.style.margin = '1px 2px';
          info.el.style.whiteSpace = 'nowrap';
          info.el.style.overflow = 'hidden';
          info.el.style.textOverflow = 'ellipsis';
          info.el.style.border = 'none';
          
          // Truncate title for month view
          const titleEl = info.el.querySelector('.fc-event-title');
          if (titleEl) {
            titleEl.style.whiteSpace = 'nowrap';
            titleEl.style.overflow = 'hidden';
            titleEl.style.textOverflow = 'ellipsis';
          }
        } else if (view === 'timeGridWeek' || view === 'timeGridDay') {
          // Week/Day view - more detailed
          info.el.style.fontSize = '0.8rem';
          info.el.style.padding = '4px 6px';
          info.el.style.margin = '1px 2px';
          info.el.style.border = 'none';
          info.el.style.minHeight = '30px';
          info.el.style.display = 'flex';
          info.el.style.flexDirection = 'column';
          info.el.style.justifyContent = 'center';
          
          // Style the time and title
          const timeEl = info.el.querySelector('.fc-event-time');
          if (timeEl) {
            timeEl.style.fontSize = '0.7rem';
            timeEl.style.opacity = '0.9';
            timeEl.style.marginRight = '4px';
          }
          
          const titleEl = info.el.querySelector('.fc-event-title');
          if (titleEl) {
            titleEl.style.fontWeight = '500';
            titleEl.style.whiteSpace = 'nowrap';
            titleEl.style.overflow = 'hidden';
            titleEl.style.textOverflow = 'ellipsis';
          }
        }
        
        // Add hover effect
        info.el.addEventListener('mouseenter', function() {
          this.style.transform = 'translateY(-1px)';
          this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
          this.style.zIndex = '1000';
        });
        
        info.el.addEventListener('mouseleave', function() {
          this.style.transform = 'translateY(0)';
          this.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)';
          this.style.zIndex = 'auto';
        });
      },
      
      // Customize event content
      eventContent: function(arg) {
        const view = arg.view.type;
        const event = arg.event;
        const props = event.extendedProps;
        
        if (view === 'dayGridMonth') {
          // Month view - show only client name or flight number
          let displayText = props.clientName || event.title;
          if (displayText.length > 12) {
            displayText = displayText.substring(0, 10) + '...';
          }
          
          return {
            html: `<div class="fc-event-main-frame" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <div class="fc-event-title" style="font-weight: 500;">${displayText}</div>
                   </div>`
          };
        } else {
          // Week/Day view - show time and client name
          const timeStr = event.start.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          
          let displayName = props.clientName || event.title;
          if (displayName.length > 20) {
            displayName = displayName.substring(0, 18) + '...';
          }
          
          return {
            html: `<div class="fc-event-main-frame" style="display: flex; flex-direction: column; width: 100%; overflow: hidden;">
                    <div class="fc-event-time" style="font-size: 0.7rem; opacity: 0.9;">${timeStr}</div>
                    <div class="fc-event-title" style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</div>
                   </div>`
          };
        }
      },
      
      eventClick: function(info) {
        showEventDetails(info.event);
      },
      
      loading: function(isLoading) {
        console.log("Calendar loading:", isLoading);
      }
    });

    calendar.render();
    console.log("Calendar rendered successfully");

    // Update metrics
    updateCalendarMetrics();

  } catch (err) {
    console.error("Failed to load calendar data:", err);
    calendarEl.innerHTML = `<div class="calendar-error">Failed to load schedules: ${err.message}</div>`;
  }
}

// Show event details in a custom modal
function showEventDetails(event) {
  // Remove existing modal if any
  const existingModal = document.getElementById('eventModal');
  if (existingModal) {
    existingModal.remove();
  }

  const props = event.extendedProps;
  
  // Format date and time
  const startDate = event.start.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const startTime = event.start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  const endTime = event.end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
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
          <p><strong>Client Name:</strong> ${props.clientName || 'N/A'}</p>
          <p><strong>Flight Number:</strong> ${props.flightNumber || 'N/A'}</p>
          <p><strong>Trip Type:</strong> ${props.tripType || 'N/A'}</p>
          <p><strong>Transaction ID:</strong> ${props.transactionID || 'N/A'}</p>
        </div>
        
        <div class="detail-section">
          <h4>Booking Details</h4>
          <p><strong>Number of Passengers:</strong> ${props.pax}</p>
          <p><strong>Luggage:</strong> ${props.luggage} pieces</p>
        </div>
        
        <div class="detail-section">
          <h4>Schedule</h4>
          <p><strong>Date:</strong> ${startDate}</p>
          <p><strong>Time:</strong> ${startTime} - ${endTime}</p>
          <p><strong>Pickup Location:</strong> ${props.pickup}</p>
        </div>
        
        <div class="detail-section">
          <h4>Vehicle Information</h4>
          <p><strong>Vehicle Type:</strong> ${props.unitType}</p>
          <p><strong>Plate Number:</strong> ${props.plateNumber || 'N/A'}</p>
        </div>
        
        <div class="detail-section">
          <h4>Status</h4>
          <p><span class="status-badge ${(props.status || 'pending').toLowerCase()}">${props.status || 'Pending'}</span></p>
        </div>
        
        ${props.notes ? `
        <div class="detail-section">
          <h4>Notes</h4>
          <p>${props.notes}</p>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add close functionality
  modal.querySelector('.close-modal').onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
}

// Update calendar metrics
function updateCalendarMetrics() {
  if (!calendar) return;
  
  const currentEvents = calendar.getEvents();
  console.log(`Total schedules in current view: ${currentEvents.length}`);
}

// =======================
// INITIALIZE DASHBOARD
// =======================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Fetch metrics and requests
    await Promise.all([
      fetchDashboardMetrics(),
      fetchRecentRequests()
    ]);

    // Initialize calendar
    await initializeCalendar();

  } catch (error) {
    console.error('Error initializing dashboard:', error);
  }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (calendar) {
    calendar.destroy();
  }
});