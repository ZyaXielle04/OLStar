document.addEventListener("DOMContentLoaded", () => {

    // ---------------- DOM Elements ----------------
    const bookingsContainer = document.getElementById("bookingsContainer");
    const fileInput = document.getElementById("fileInput");
    const modal = document.getElementById("manualModal");
    const addManualBtn = document.getElementById("addManualBtn");
    const closeModalBtn = document.getElementById("closeModal");
    const manualForm = document.getElementById("manualForm");
    const dateFilter = document.getElementById("dateFilter");
    const driverInput = document.getElementById("driverName");
    const cellPhoneInput = document.getElementById("cellPhone");
    const driverDatalist = document.getElementById("driverSuggestions");
    const plateInput = document.getElementById("plateNumber");
    const transportUnitInput = document.getElementById("transportUnit");
    const unitTypeInput = document.getElementById("unitType");
    const colorInput = document.getElementById("color");
    const plateDatalist = document.getElementById("plateSuggestions");
    const driverFilter = document.getElementById("driverFilter");
    
    // Flight Screenshot Modal Elements
    const flightScreenshotModal = document.getElementById("flightScreenshotModal");
    const flightScreenshotImg = document.getElementById("flightScreenshotImg");
    const closeFlightModal = document.getElementById("closeFlightModal");
    const refreshFlightBtn = document.getElementById("refreshFlightBtn");
    const downloadFlightBtn = document.getElementById("downloadFlightBtn");
    
    const STATUS_PHOTO_MAP = {
        "Confirmed": "pendingPhotoUrl",
        "Arrived": "confirmedPhotoUrl",
        "On Route": "arrivedPhotoUrl",
        "Completed": "OnRoutePhotoUrl"
    };

    const statusPhotoModal = document.getElementById("statusPhotoModal");
    const statusPhotoImg = document.getElementById("statusPhotoImg");
    const downloadStatusPhoto = document.getElementById("downloadStatusPhoto");
    const closeStatusPhotoModal = document.getElementById("closeStatusPhotoModal");
    let selectedScheduleIDs = new Set();


    function openStatusPhotoModal(photoUrl) {
        if (!photoUrl) {
            showToast("No photo uploaded for this status yet.", "info");
            return;
        }

        statusPhotoImg.src = photoUrl;
        downloadStatusPhoto.href = photoUrl;
        statusPhotoModal.style.display = "block";
    }

    closeStatusPhotoModal.onclick = () => {
        statusPhotoModal.style.display = "none";
        statusPhotoImg.src = "";
    };

    window.addEventListener("click", e => {
        if (e.target === statusPhotoModal) {
            statusPhotoModal.style.display = "none";
            statusPhotoImg.src = "";
        }
    });


    // ---------------- Plate Number Auto-fill ----------------
    plateInput.addEventListener("input", () => {
        const value = plateInput.value.trim();
        const match = transportUnitsList.find(u => u.plateNumber === value);
        if (match) {
            transportUnitInput.value = match.transportUnit || "";
            unitTypeInput.value = match.unitType || "";
            colorInput.value = match.color || "";
        } else {
            transportUnitInput.value = "";
            unitTypeInput.value = "";
            colorInput.value = "";
        }
    });

    // ---------------- SweetAlert2 Toast ----------------
    function showToast(message, icon = "success") {
        Swal.fire({
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            icon,
            title: message
        });
    }

    // ---------------- Utilities ----------------
    function generateTransactionID() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const randomLetters = Array.from({ length: 3 }, () =>
            letters[Math.floor(Math.random() * letters.length)]
        ).join("");
        const randomNumbers = Math.floor(100 + Math.random() * 900);
        return randomLetters + randomNumbers;
    }

    function cleanDriverName(name) {
        if (!name) return "";
        return /^[A-Z]\s/.test(name) ? name.slice(2).trim() : name.trim();
    }

    function excelToISODate(value) {
        if (!value) return "";
        let d;
        if (typeof value === "number") {
            const p = XLSX.SSF.parse_date_code(value);
            d = new Date(p.y, p.m - 1, p.d);
        } else {
            d = new Date(value);
            if (isNaN(d)) return "";
        }
        const month = (d.getMonth() + 1).toString().padStart(2, "0");
        const day = d.getDate().toString().padStart(2, "0");
        const year = d.getFullYear();
        return `${year}-${month}-${day}`;
    }

    function parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const match = timeStr.match(/(\d{1,2}):(\d{2})(AM|PM)/i);
        if (!match) return 0;
        let [, hour, minute, period] = match;
        hour = parseInt(hour, 10);
        minute = parseInt(minute, 10);
        if (period.toUpperCase() === "PM" && hour !== 12) hour += 12;
        if (period.toUpperCase() === "AM" && hour === 12) hour = 0;
        return hour * 60 + minute;
    }

    function sortSchedulesByDateTime(schedules) {
        return schedules.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
            return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
        });
    }

    // ---------------- Philippine Local Date Utilities ----------------
    function getPHLocalISODate() {
        const nowPH = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
        const d = new Date(nowPH);

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");

        console.log("PH Local ISO Date:", `${year}-${month}-${day}`);

        return `${year}-${month}-${day}`;
    }

    function getTomorrowPHISO() {
        const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
        const d = new Date(now);
        d.setDate(d.getDate() + 1);

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    // ---------------- CSRF ----------------
    function getCSRFToken() {
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        return match ? match[1] : "";
    }

    async function sendSchedulesToBackend(data, method = "POST", transactionID = null) {
        try {
            const url = transactionID ? `/api/schedules/${transactionID}` : "/api/schedules";
            const res = await fetch(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error(await res.text());
            return true;
        } catch (err) {
            console.error("Failed to save schedules:", err);
            showToast("Failed to save schedules.", "error");
            return false;
        }
    }
    
    async function fetchTransportUnits() {
        try {
            const res = await fetch("/api/transportUnits");
            if (!res.ok) throw new Error("Failed to fetch transport units");
            const data = await res.json();
            transportUnitsList = data.transportUnits || [];
        } catch (err) {
            console.error(err);
            transportUnitsList = [];
        }
    }

    // call this on page load
    fetchTransportUnits();

    async function deleteScheduleFromBackend(transactionID) {
        try {
            const res = await fetch(`/api/schedules/${transactionID}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await res.text());
            return true;
        } catch (err) {
            console.error("Failed to delete schedule:", err);
            showToast("Failed to delete schedule.", "error");
            return false;
        }
    }

    // ---------------- Global Data ----------------
    let allSchedules = [];
    let usersList = [];
    let editingTransactionID = null;
    let transportUnitsList = [];

    async function captureFlightScreenshot(flightNumber, transactionId = null) {
        if (!flightNumber) {
            showToast("No flight number available", "info");
            return;
        }
        
        // Show loading state
        Swal.fire({
            title: 'Capturing Flight Screenshot',
            text: `Please wait while we capture ${flightNumber} from FlightAware...`,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        try {
            let url;
            if (transactionId) {
                url = `/api/flight/screenshot/${transactionId}/${flightNumber}`;
            } else {
                url = `/api/flight/screenshot/${flightNumber}`;
            }
            
            const response = await fetch(url);
            const data = await response.json();
            
            Swal.close();
            
            if (data.success && data.screenshot_url) {
                if (transactionId) {
                    showToast("✅ Flight screenshot captured and saved to schedule!");
                } else {
                    showToast("✅ Flight screenshot captured successfully!");
                }
            } else {
                showToast(`❌ Failed: ${data.error || 'Unknown error'}`, "error");
            }
        } catch (err) {
            Swal.close();
            console.error("Flight screenshot error:", err);
            showToast("❌ Failed to capture flight screenshot", "error");
        }
    }

    async function saveFlightScreenshotToSchedule(transactionId, screenshotUrl) {
        try {
            const response = await fetch(`/api/schedules/${transactionId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify({
                    flightScreenshot: screenshotUrl,
                    flightScreenshotTimestamp: new Date().toISOString()
                })
            });
            
            if (!response.ok) {
                console.error("Failed to save flight screenshot reference");
            }
        } catch (err) {
            console.error("Error saving flight screenshot:", err);
        }
    }

    function viewExistingFlightScreenshot(schedule) {
        const screenshotUrl = schedule.PhotoUrl?.flightAwareUrl || schedule.flightScreenshot;
        if (screenshotUrl) {
            // Open in new tab
            window.open(screenshotUrl, '_blank');
        } else {
            showToast("No screenshot available for this flight", "info");
        }
    }

    // ---------------- Fetch Users for Autocomplete ----------------
    async function fetchUsers() {
        try {
            const res = await fetch("/api/admin/users");
            if (!res.ok) throw new Error("Failed to fetch users");
            const data = await res.json();
            usersList = data.users.map(u => ({
                fullName: `${u.firstName} ${u.middleName} ${u.lastName}`.replace(/\s+/g, " ").trim(),
                cellPhone: u.phone || ""
            }));
        } catch (err) {
            console.error(err);
            usersList = [];
        }
    }
    fetchUsers();

    // ---------------- Autocomplete for Driver Name ----------------
    driverInput.addEventListener("input", () => {
        const value = driverInput.value.toLowerCase();
        driverDatalist.innerHTML = "";

        const matches = usersList.filter(u => u.fullName.toLowerCase().startsWith(value));
        matches.forEach(u => {
            const option = document.createElement("option");
            option.value = u.fullName;
            driverDatalist.appendChild(option);
        });

        const exactMatch = usersList.find(u => u.fullName.toLowerCase() === value);
        if (exactMatch) {
            cellPhoneInput.value = exactMatch.cellPhone.replace(/\D/g, "");
        } else {
            cellPhoneInput.value = "";
        }
    });

    async function fetchSchedules(selectedISO = null) {
        try {
            const res = await fetch("/api/schedules");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            
            // Check each schedule for cancellation
            const schedules = (data.schedules || []).map(schedule => {
                if (shouldBeCancelled(schedule) && schedule.status !== "Cancelled") {
                    schedule.status = "Cancelled";
                }
                return schedule;
            });
            
            // Assign permanent trip numbers to ALL schedules
            allSchedules = assignTripNumbers(schedules);
            
            const filterISO = selectedISO || dateFilter.value || getPHLocalISODate();
            dateFilter.value = filterISO;

            populateDriverFilter(filterISO);
            applyActiveFilters();
        } catch (err) {
            console.error("Failed to fetch schedules:", err);
            showToast("Failed to load schedules.", "error");
        }
    }

    // ---------------- Auto Refresh (Real-time-ish) ----------------
    let autoRefreshTimer = null;

    function startAutoRefresh(intervalMs = 5000) {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);

        autoRefreshTimer = setInterval(() => {
            const selectedDate = dateFilter?.value || getPHLocalISODate();
            fetchSchedules(selectedDate);
        }, intervalMs);
    }

    if (dateFilter) {
        dateFilter.value = getPHLocalISODate();
        dateFilter.addEventListener("change", () => {
            populateDriverFilter(dateFilter.value);
            applyActiveFilters();
        });
    }

    function buildWhatsAppMessage(item) {
        const current = item.current || {};

        return `Hi Sir/Madam ${item.clientName || ""},

This is from ${item.company || ""} X Ol-Star Transport. Here are your vehicle service details:

✈️ FLIGHT DETAILS
📅 Date: ${item.date || ""}
⏰ Pickup Time: ${item.time || ""}
👥 Passengers: ${item.pax || ""}

📍 PICKUP AREA
${item.pickup || ""}

📍 DROP-OFF LOCATION
${item.dropOff || ""}

🚗 DRIVER INFORMATION
Name: ${current.driverName || ""}
Mobile: ${current.cellPhone || ""}
Vehicle: ${item.transportUnit || ""} (${item.unitType || ""})
Color: ${item.color || ""}
Plate No: ${item.plateNumber || ""}

🧳 CAR TYPE & LUGGAGE INFO
Please note that the car type you have reserved is ${item.bookingType || ""}.
The luggage specification allows a maximum of ${item.luggage || ""} pcs (24-inch max).

ℹ️ ADDITIONAL INFO
You have a free one (1) hour waiting period.
After that, PHP 150 per succeeding hour.

📞 0917-657-7693
📱 WhatsApp: 0963-492-2662
📧 olstaropc@gmail.com

This is an automated message. Please do not reply.`;
    }

        function createCalendarEvent(data) {
        const event = document.createElement("div");
        event.classList.add("calendar-event");

        // Get driver-specific trip number
        const driverName = data.current?.driverName || "Unassigned";
        const tripNumber = data.tripNumber || null;

        // Add no-show class if clientNoShow is true
        if (data.clientNoShow === true) {
            event.classList.add("no-show-trip");
        }

        // Add completed class if status is Completed
        if (data.status === "Completed") {
            event.classList.add("completed-trip");
        }

        const statusMap = {
            "Pending": "The Driver is preparing to dispatch.",
            "Confirmed": "Driver has departed.",
            "Arrived": "Driver has arrived.",
            "On Route": "Client On-board.",
            "Completed": "Client has been dropped off.",
            "Cancelled": "Booking Cancelled"
        };

        const rawStatus = data.status || "Pending";
        const statusClass = rawStatus.toLowerCase().replace(/\s+/g, "-");
        const statusLabel = statusMap[rawStatus] || rawStatus;

        // Create driver badge with trip number and camera icon if screenshot exists
        let driverBadge = '';
        if (tripNumber) {
            const hasScreenshot = data.PhotoUrl?.flightAwareUrl || data.flightScreenshot;
            driverBadge = `
                <div class="driver-trip-badge" title="${driverName}">
                    <span class="trip-num">#${tripNumber}</span>
                    ${hasScreenshot ? 
                        `<span class="screenshot-indicator" title="View flight screenshot" style="cursor:pointer; margin-left:5px; font-size:20px;">📸</span>` 
                        : ''}
                </div>
            `;
        }

        event.innerHTML = `
            <div class="event-select">
                <input
                type="checkbox"
                class="schedule-checkbox"
                data-id="${data.transactionID}"
                />
            </div>

            <div class="event-header">
                ${driverBadge}
                <div class="event-time">${data.time || ""}</div>
                <div class="event-tripType">${getTripTypeLabel(data.tripType)}</div>
                <div class="event-id">
                    ${data.transactionID || ""}
                </div>
                ${data.clientNoShow === true ? '<span class="no-show-badge">🚫 NO SHOW</span>' : ''}
                <span class="status ${statusClass}">${statusLabel}</span>
            </div>

            <div class="event-info">

                <div class="event-top-row">
                    <div class="event-company">
                        <strong>Company: ${data.company || "-"}</strong> (${data.unitType})
                    </div>

                    <div class="event-vehicle">
                        <strong>
                            ${data.transportUnit || ""} |
                            ${data.color || ""} |
                            ${data.plateNumber || ""}
                        </strong>
                    </div>
                </div>

                <div class="client-info">
                    <strong class="client-name">${data.clientName || ""}</strong>
                    <button class="btn-copy-client" title="Copy client name">📋</button>

                    <span> | </span>

                    <strong class="client-contact">${data.contactNumber || ""}</strong>
                    <button class="btn-copy-contact" title="Copy contact number">📋</button>

                    <span> | </span>

                    <strong class="event-note">(${data.note || "No email available on the note"})</strong>
                </div>

                <div class="event-route">
                    <p>Pickup Location: <strong>${data.pickup || ""}</strong></p>
                    <p>Drop Off Location: <strong>${data.dropOff || ""}</strong></p>
                </div>

                <div class="event-footer">
                    <div class="event-actions">
                        <div class="action-left">
                            <button class="btn-copy">📋 Message Template</button>
                            <button class="btn-flightaware">✈️ FlightAware</button>
                            <button class="btn-driver-transfer">🚕 Driver Transfer</button>
                            <button class="btn-email-client">📧 Email Client</button>
                            <button class="btn-ring-driver" data-transaction="${data.transactionID}">🔔 Ring Driver</button>
                        </div>

                        <div class="action-center">
                            <button class="btn-edit">Edit</button>
                            <button class="btn-delete">Delete</button>
                        </div>
                    </div>

                    <div class="driver-info">
                        <div class="driver-name">
                            <strong>${driverName}</strong> | ${data.current?.cellPhone || ""}
                        </div>
                    </div>
                </div>
            </div>

            <div class="event-details">
                <div class="status-progress" id="statusProgress"></div>
                <div class="details-grid">
                    <div class="detail">
                        <span class="label">Pax</span>
                        <span class="value">${data.pax || "-"}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Trip Type</span>
                        <span class="value">${getTripTypeLabel(data.tripType)}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Flight</span>
                        <span class="value">${data.flightNumber || "-"}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Booking Type</span>
                        <span class="value">${data.bookingType || "-"}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Amount</span>
                        <span class="value">${data.amount || "-"}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Driver Rate</span>
                        <span class="value">${data.driverRate || "-"}</span>
                    </div>
                    <div class="detail">
                        <span class="label">Luggage</span>
                        <span class="value">${data.luggage || "-"}</span>
                    </div>
                </div>
            </div>
        `;

        document.getElementById("migrateDriversBtn")?.addEventListener("click", async () => {
            const result = await Swal.fire({
                title: 'Migrate Driver Fields?',
                text: 'This will add fcm_token and notifications_enabled fields to all drivers.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, Migrate',
                cancelButtonText: 'Cancel'
            });
            
            if (!result.isConfirmed) return;
            
            Swal.fire({
                title: 'Migrating...',
                text: 'Please wait',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
            
            try {
                const response = await fetch('/api/admin/migrate-driver-fields', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    }
                });
                
                const data = await response.json();
                Swal.close();
                
                if (data.success) {
                    Swal.fire({
                        title: '✅ Migration Complete',
                        html: `
                            <p><strong>Updated:</strong> ${data.updated} drivers</p>
                            <p><strong>Skipped:</strong> ${data.skipped} drivers</p>
                        `,
                        icon: 'success'
                    });
                } else {
                    Swal.fire({
                        title: '❌ Migration Failed',
                        text: data.error,
                        icon: 'error'
                    });
                }
            } catch (err) {
                Swal.close();
                Swal.fire({
                    title: '❌ Error',
                    text: err.message,
                    icon: 'error'
                });
            }
        });

        // Ring Driver Function
        async function ringDriver(transactionId, driverName) {
            if (!transactionId) {
                showToast("No transaction ID available", "info");
                return;
            }
            
            if (!driverName || driverName === "Unassigned") {
                showToast("No driver assigned to this trip", "warning");
                return;
            }
            
            // Confirm with admin
            const result = await Swal.fire({
                title: '🔔 Ring Driver?',
                html: `
                    <div style="text-align: left;">
                        <p><strong>Driver:</strong> ${driverName}</p>
                        <p><strong>Trip:</strong> ${transactionId}</p>
                        <p style="color: #ff6b6b; margin-top: 15px;">
                            This will send an alarm notification to the driver's phone.
                        </p>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: '🔔 Ring Now',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#ff6b6b'
            });
            
            if (!result.isConfirmed) return;
            
            // Show loading
            Swal.fire({
                title: 'Ringing Driver...',
                text: 'Sending alarm notification',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
            
            try {
                const response = await fetch(`/api/driver/ring/${transactionId}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCSRFToken()
                    }
                });
                
                const data = await response.json();
                Swal.close();
                
                if (data.success) {
                    await Swal.fire({
                        title: '✅ Ring Sent!',
                        html: `
                            <p>Alarm sent to ${driverName}</p>
                            <p style="font-size: 12px; color: #666;">Message ID: ${data.fcm_message_id}</p>
                        `,
                        icon: 'success',
                        confirmButtonText: 'OK'
                    });
                } else if (data.error === "Driver not registered for push notifications") {
                    // Driver not registered - show phone number
                    Swal.fire({
                        title: '📱 Driver Not Registered',
                        html: `
                            <p>${driverName} hasn't registered for push notifications.</p>
                            ${data.driver_phone ? `<p><strong>Phone:</strong> ${data.driver_phone}</p>` : ''}
                        `,
                        icon: 'warning',
                        confirmButtonText: 'OK'
                    });
                } else {
                    showToast(`Failed: ${data.error || 'Unknown error'}`, "error");
                }
            } catch (err) {
                Swal.close();
                console.error("Ring driver error:", err);
                showToast("Failed to ring driver", "error");
            }
        }

        // Add event listener for ring button
        const btnRingDriver = event.querySelector(".btn-ring-driver");
        if (btnRingDriver) {
            const driverName = data.current?.driverName;
            
            // Disable if no driver
            if (!driverName || driverName === "Unassigned") {
                btnRingDriver.disabled = true;
                btnRingDriver.title = "No driver assigned";
                btnRingDriver.style.opacity = "0.5";
            }
            
            btnRingDriver.addEventListener("click", () => {
                ringDriver(data.transactionID, data.current?.driverName);
            });
        }

        // View ring history function
        async function viewRingHistory(transactionId) {
            try {
                const response = await fetch(`/api/driver/ring-history/${transactionId}`);
                const data = await response.json();
                
                if (data.success && data.rings && data.rings.length > 0) {
                    let historyHtml = `
                        <div style="max-height: 400px; overflow-y: auto;">
                            <p><strong>Total Rings:</strong> ${data.total_rings}</p>
                    `;
                    
                    data.rings.forEach((ring, index) => {
                        const ringDate = ring.timestamp ? new Date(ring.timestamp).toLocaleString() : 'Unknown';
                        historyHtml += `
                            <div style="padding: 12px; margin: 8px 0; background: #f8f9fa; border-radius: 6px; border-left: 4px solid ${ring.status === 'sent' ? '#28a745' : '#dc3545'};">
                                <div><strong>Ring #${index + 1}</strong></div>
                                <div>📅 ${ringDate}</div>
                                <div>📊 Status: <span style="color: ${ring.status === 'sent' ? '#28a745' : '#dc3545'};">${ring.status}</span></div>
                                ${ring.trip_details ? `
                                    <div style="margin-top: 5px; font-size: 12px; color: #666;">
                                        Trip #${ring.trip_details.trip_number} - ${ring.trip_details.time}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    });
                    
                    historyHtml += '</div>';
                    
                    Swal.fire({
                        title: '🔔 Ring History',
                        html: historyHtml,
                        icon: 'info',
                        width: '600px',
                        confirmButtonText: 'Close'
                    });
                } else {
                    showToast("No ring history found for this trip", "info");
                }
            } catch (err) {
                console.error("Error fetching ring history:", err);
                showToast("Failed to load ring history", "error");
            }
        }

        // Add click handler for screenshot indicator (next to trip number)
        const screenshotIndicator = event.querySelector('.screenshot-indicator');
        if (screenshotIndicator) {
            screenshotIndicator.addEventListener('click', (e) => {
                e.stopPropagation();
                viewExistingFlightScreenshot(data);
            });
        }

        // ---------------- Select schedule by clicking anywhere ----------------
        const checkbox = event.querySelector(".schedule-checkbox");

        // Prevent clicks on buttons inside the card from toggling selection
        event.addEventListener("click", (e) => {
            if (
                e.target.closest("button") ||  // buttons
                e.target.closest("a")          // links
            ) return;

            // Toggle checkbox
            checkbox.checked = !checkbox.checked;

            const id = checkbox.dataset.id;
            if (checkbox.checked) {
                selectedScheduleIDs.add(id);
            } else {
                selectedScheduleIDs.delete(id);
            }

            // Enable / disable bulk delete button
            document.getElementById("bulkDeleteBtn").disabled =
                selectedScheduleIDs.size === 0;

            // Optional: highlight selected card
            event.classList.toggle("selected-schedule", checkbox.checked);
        });

        // --- Render Status Progress ---
        function renderStatusProgress(status) {
            const container = document.createElement("div");
            container.classList.add("status-progress");

            const statusMap = {
                "Pending": "The Driver is preparing to dispatch.",
                "Confirmed": "Driver has departed",
                "Arrived": "Driver has arrived",
                "On Route": "Service Start",
                "Completed": "Service finished",
                "Cancelled": "Booking Cancelled"
            };

            const statusKeys = ["Pending", "Confirmed", "Arrived", "On Route", "Completed"];
            const cancelled = status === "Cancelled";
            const noShow = data.clientNoShow === true;
            const currentIndex = statusKeys.indexOf(status);

            statusKeys.forEach((key, index) => {
                // Step container
                const step = document.createElement("div");
                step.classList.add("status-step");

                // Circle
                const circle = document.createElement("div");
                circle.classList.add("status-circle");
                circle.textContent = index + 1;

                if (cancelled || noShow) {
                    circle.style.backgroundColor = "red";
                } else if (index <= currentIndex) {
                    circle.style.backgroundColor = "#aacafd"; // blue for completed steps
                }

                circle.style.cursor = "pointer";

                circle.addEventListener("click", () => {
                    const statusKey = statusKeys[index];
                    const photoKey = STATUS_PHOTO_MAP[statusKey];
                    if (!photoKey) return;

                    const photoContainer =
                        data.PhotoUrl ||
                        data.photoUrl ||
                        data.photos ||
                        {};

                    const photoUrl = photoContainer[photoKey];

                    console.log("Clicked:", statusKey);
                    console.log("Photo key:", photoKey);
                    console.log("Resolved URL:", photoUrl);

                    openStatusPhotoModal(photoUrl);
                });

                // Label
                const label = document.createElement("div");
                label.classList.add("status-label");

                if (cancelled) {
                    label.textContent = index === 2 ? "Booking Cancelled" : "";
                } else if (noShow) {
                    label.textContent = index === 2 ? "Client No Show" : "";
                } else {
                    label.textContent = statusMap[key];
                }

                // Append circle and label
                step.appendChild(circle);
                step.appendChild(label);

                // Line (except last step)
                if (index < statusKeys.length - 1) {
                    const line = document.createElement("div");
                    line.classList.add("status-line");

                    if (cancelled || noShow) {
                        line.style.backgroundColor = "red";
                    } else if (index < currentIndex) {
                        line.style.backgroundColor = "blue";
                    }

                    step.appendChild(line);
                }

                container.appendChild(step);
            });

            return container;
        }

        // Insert the progress bar into the event
        event.appendChild(renderStatusProgress(rawStatus));

        const btnCopy = event.querySelector(".btn-copy");
        const btnFlightAware = event.querySelector(".btn-flightaware");
        const btnCopyClient = event.querySelector(".btn-copy-client");
        const btnCopyContact = event.querySelector(".btn-copy-contact");
        const btnDriverTransfer = event.querySelector(".btn-driver-transfer");
        const btnEmailClient = event.querySelector(".btn-email-client");

        btnEmailClient.addEventListener("click", () => {
            const email = (data.note || "").trim(); // email stored in "note"

            if (!email || !email.includes("@")) {
                showToast("No valid email found for this client.", "info");
                return;
            }

            const subject = `Your Transport Booking – ${data.company || "Ol-Star Transport"}`;

            // ✅ Reuse WhatsApp message
            const body = buildWhatsAppMessage(data);

            const gmailUrl =
                `https://mail.google.com/mail/?view=cm&fs=1` +
                `&to=${encodeURIComponent(email)}` +
                `&su=${encodeURIComponent(subject)}` +
                `&body=${encodeURIComponent(body)}`;

            window.open(gmailUrl, "_blank");
        });
        

        btnDriverTransfer.addEventListener("click", () => {
            const clientName = data.clientName || "[Client Name]";
            const driverName = data.current?.driverName || "[New Driver Name]";
            const unit = data.transportUnit || "[Unit]";
            const plate = data.plateNumber || "[Plate No.]";
            const color = data.color || "[Color]";

            const message = `Hi Sir/Madam ${clientName},\n\n` +
                `We apologize that we have to change your assigned driver and unit due to certain reason. Here is the new assigned Driver information:\n\n` +
                `Driver's Name: ${driverName}\n` +
                `Unit: ${unit}\n` +
                `Plate No.: ${plate}\n` +
                `Color: ${color}\n\n` +
                `Rest assured that the driver will be there.`;

            // Use your existing copy function
            copyText(message, "Driver transfer message copied!");
        });

        btnCopy.addEventListener("click", async () => {
            const message = buildWhatsAppMessage(data);

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(message);
                } else {
                    // Fallback for HTTP / older browsers
                    const textarea = document.createElement("textarea");
                    textarea.value = message;
                    textarea.style.position = "fixed"; // prevent scroll jump
                    textarea.style.opacity = "0";
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    document.execCommand("copy");
                    document.body.removeChild(textarea);
                }

                showToast("Message copied to clipboard!");
            } catch (err) {
                console.error("Copy failed:", err);
                showToast("Failed to copy message", "error");
            }
        });

        function copyText(text, successMsg) {
            if (!text) {
                showToast("Nothing to copy", "info");
                return;
            }

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
            }

            showToast(successMsg);
        }

        btnCopyClient?.addEventListener("click", () => {
            copyText(data.clientName, "Client name copied!");
        });

        btnCopyContact?.addEventListener("click", () => {
            copyText(data.contactNumber, "Contact number copied!");
        });

        function hasExistingFlightScreenshot(schedule) {
            return schedule.photoUrl?.flightAwareUrl || schedule.flightScreenshot;
        }

        btnFlightAware.addEventListener("click", async () => {
            if (!data.flightNumber) {
                showToast("No flight number available", "info");
                return;
            }

            // Clean flight number (remove spaces)
            const flightNumber = data.flightNumber.replace(/\s+/g, "").toUpperCase();
            
            // Check if there's an existing screenshot
            const existingScreenshot = data.PhotoUrl?.flightAwareUrl || data.flightScreenshot;

            if (existingScreenshot) {
                // Show options with view screenshot button
                Swal.fire({
                    title: 'Flight Options',
                    html: `
                        <div style="margin-bottom: 20px;">
                            <strong>Flight:</strong> ${flightNumber}
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <button class="swal2-confirm swal2-styled" style="background-color: #3085d6;" onclick="window.open('https://www.flightaware.com/live/flight/${flightNumber}', '_blank')">
                                🌐 Open FlightAware
                            </button>
                            <button class="swal2-confirm swal2-styled" style="background-color: #28a745;" onclick="viewFlightScreenshotInNewTab('${existingScreenshot}')">
                                👁️ View Screenshot
                            </button>
                            <button class="swal2-deny swal2-styled" style="background-color: #dd33dd;" onclick="captureFlightScreenshot('${flightNumber}', '${data.transactionID}')">
                                📸 Take New Screenshot
                            </button>
                            <button class="swal2-cancel swal2-styled" onclick="Swal.close()">
                                Cancel
                            </button>
                        </div>
                    `,
                    showConfirmButton: false,
                    showDenyButton: false,
                    showCancelButton: false,
                    didOpen: () => {
                        // Make functions global for the buttons
                        window.viewFlightScreenshotInNewTab = function(url) {
                            Swal.close();
                            window.open(url, '_blank');
                        };
                        
                        window.captureFlightScreenshot = function(flightNum, transId) {
                            Swal.close();
                            captureFlightScreenshot(flightNum, transId);
                        };
                    }
                });
            } else {
                // No existing screenshot - show simple options
                const result = await Swal.fire({
                    title: 'Flight Options',
                    text: `Flight: ${flightNumber}`,
                    icon: 'question',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: '🌐 Open FlightAware',
                    denyButtonText: '📸 Take Screenshot',
                    cancelButtonText: 'Cancel'
                });

                if (result.isConfirmed) {
                    // Open FlightAware website
                    const url = `https://www.flightaware.com/live/flight/${flightNumber}`;
                    window.open(url, "_blank");
                } else if (result.isDenied) {
                    // Capture screenshot
                    await captureFlightScreenshot(flightNumber, data.transactionID);
                }
            }
        });

        const btnEdit = event.querySelector(".btn-edit");
        btnEdit.addEventListener("click", () => {
            modal.style.display = "block";
            editingTransactionID = data.transactionID;

            for (let [key, value] of Object.entries(data)) {
                const input = manualForm.querySelector(`[name="${key}"]`);
                if (input) input.value = value;
            }

            if (data.current) {
                driverInput.value = data.current.driverName || "";
                cellPhoneInput.value = data.current.cellPhone || "";
            }
        });

        const btnDelete = event.querySelector(".btn-delete");
        btnDelete.addEventListener("click", async () => {
            const result = await Swal.fire({
                title: "Delete Schedule",
                text: "This action cannot be undone. Please type 'Confirm Delete' below to proceed.",
                input: "text",
                inputPlaceholder: "Type 'Confirm Delete' here",
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Delete",        cancelButtonText: "Cancel",
                confirmButtonColor: "#d33",
                preConfirm: (input) => {
                    if (input !== "Confirm Delete") {
                        Swal.showValidationMessage("You must type exactly 'Confirm Delete'");
                        return false;
                    }
                    return input;
                }
            });

            // Check if the user confirmed and the input matches
            if (result.isConfirmed && result.value === "Confirm Delete") {
                if (await deleteScheduleFromBackend(data.transactionID)) {
                    event.remove();
                    showToast("Schedule deleted.", "success");
                }
            }
        });

        return event;
    }

    // Helper function to get initials from driver name
    function getInitials(name) {
        if (!name || name === "Unassigned") return "DR";
        return name.split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    }

    function assignTripNumbers(schedules) {
        // First, group by driver
        const schedulesByDriver = {};
        
        schedules.forEach(schedule => {
            const driverName = schedule.current?.driverName || "Unassigned";
            if (!schedulesByDriver[driverName]) {
                schedulesByDriver[driverName] = [];
            }
            schedulesByDriver[driverName].push(schedule);
        });
        
        // For each driver, group by date and assign numbers
        Object.keys(schedulesByDriver).forEach(driver => {
            const driverSchedules = schedulesByDriver[driver];
            
            // Group driver's schedules by date
            const byDate = {};
            driverSchedules.forEach(schedule => {
                if (!byDate[schedule.date]) {
                    byDate[schedule.date] = [];
                }
                byDate[schedule.date].push(schedule);
            });
            
            // For each date, sort by time and assign numbers starting from 1
            Object.keys(byDate).forEach(date => {
                const dateSchedules = byDate[date];
                
                // Sort by time (earliest to latest)
                dateSchedules.sort((a, b) => {
                    return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
                });
                
                // Assign PERMANENT trip numbers (1, 2, 3, etc.) for THIS driver on THIS date
                let tripNumber = 1;
                dateSchedules.forEach(schedule => {
                    schedule.tripNumber = tripNumber++;  // Each driver's trips start at #1
                    schedule.tripNumberForDriver = `${driver}-${schedule.date}-${schedule.tripNumber}`; // Unique identifier
                });
            });
        });
        
        return schedules;
    }

    function renderSchedules(schedules) {
        bookingsContainer.innerHTML = "";
        if (!schedules.length) {
            bookingsContainer.innerHTML = `<p style="text-align:center;color:#6b7280;font-style:italic;">No schedules for this day.</p>`;
            return;
        }
        sortSchedulesByDateTime(schedules).forEach(s => bookingsContainer.appendChild(createCalendarEvent(s)));

        document.querySelectorAll(".schedule-checkbox").forEach(cb => {
            cb.addEventListener("change", e => {
                const id = e.target.dataset.id;

                if (e.target.checked) {
                selectedScheduleIDs.add(id);
                } else {
                selectedScheduleIDs.delete(id);
                }

                document.getElementById("bulkDeleteBtn").disabled =
                selectedScheduleIDs.size === 0;
            });
        });
    }

    document.getElementById("bulkDeleteBtn").addEventListener("click", async () => {
        const result = await Swal.fire({
            title: `Delete ${selectedScheduleIDs.size} selected schedules?`,
            text: "This action cannot be undone. Please type 'Confirm Delete' below to proceed.",
            input: "text",
            inputPlaceholder: "Type 'Confirm Delete' here",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Delete",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#d33",
            preConfirm: (input) => {
                if (input !== "Confirm Delete") {
                    Swal.showValidationMessage("You must type exactly 'Confirm Delete'");
                    return false;
                }
                return input;
            }
        });

        if (result.isConfirmed && result.value === "Confirm Delete") {
            for (const id of selectedScheduleIDs) {
                await deleteScheduleFromBackend(id);
            }

            selectedScheduleIDs.clear();
            await fetchSchedules(dateFilter.value);
            showToast("Selected schedules deleted.", "success");
        }
    });

    document.getElementById("deleteAllBtn").addEventListener("click", async () => {
        const selectedDate = dateFilter.value || getPHLocalISODate();
        const selectedDriver = driverFilter.value;

        const targets = allSchedules.filter(s => {
            if (s.date !== selectedDate) return false;
            if (selectedDriver && s.current?.driverName !== selectedDriver) return false;
            return true;
        });

        if (!targets.length) {
            showToast("No schedules to delete.", "info");
            return;
        }

        const result = await Swal.fire({
            title: `Delete ALL ${targets.length} filtered schedules?`,
            text: "This action cannot be undone. Please type 'Confirm Delete' below to proceed.",
            input: "text",
            inputPlaceholder: "Type 'Confirm Delete' here",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Delete",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#d33",
            preConfirm: (input) => {
                if (input !== "Confirm Delete") {
                    Swal.showValidationMessage("You must type exactly 'Confirm Delete'");
                    return false;
                }
                return input;
            }
        });

        if (result.isConfirmed && result.value === "Confirm Delete") {
            for (const s of targets) {
                await deleteScheduleFromBackend(s.transactionID);
            }

            await fetchSchedules(selectedDate);
            showToast("All filtered schedules deleted.", "success");
        }
    });

    fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const selectedDate = document.getElementById("dateFilter")?.value;
        if (!selectedDate) {
            showToast("Please select a date to import.", "error");
            return;
        }

        const phoneMap = await fetchUsersPhoneMap();
        const reader = new FileReader();

        reader.onload = async (ev) => {
            const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
            const sheetName = "BOOKING";

            if (!workbook.SheetNames.includes(sheetName)) {
                showToast("Sheet BOOKING not found", "error");
                return;
            }

            const sheet = workbook.Sheets[sheetName];
            const range = XLSX.utils.decode_range(sheet["!ref"]);
            const schedules = [];
            const emailPromises = [];

            for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const dateValue = sheet[`A${row + 1}`]?.v;
                const dateISO = excelToISODate(dateValue);

                // Only save rows that match selected date
                if (dateISO !== selectedDate) continue;

                const rawPhone = sheet[`Q${row + 1}`]?.v || "";
                const digits = String(rawPhone).replace(/\D/g, "");
                const cellPhone = digits.match(/09\d{9}/)?.[0] || "";

                let driverName = cleanDriverName(String(sheet[`K${row + 1}`]?.v || ""));
                if (cellPhone && phoneMap[cellPhone]) {
                    driverName = phoneMap[cellPhone];
                }

                const clientEmail = String(sheet[`E${row + 1}`]?.v || "").trim();

                const schedule = {
                    transactionID: String(generateTransactionID()),
                    date: String(dateISO),
                    time: String(sheet[`B${row + 1}`]?.v || ""),
                    clientName: String(sheet[`C${row + 1}`]?.v || ""),
                    contactNumber: String(sheet[`D${row + 1}`]?.v || ""),
                    note: String(sheet[`E${row + 1}`]?.v || ""),
                    pax: String(sheet[`F${row + 1}`]?.v || ""),
                    tripType: String(sheet[`G${row + 1}`]?.v || "Departure"),
                    flightNumber: String(sheet[`H${row + 1}`]?.v || ""),
                    pickup: String(sheet[`I${row + 1}`]?.v || ""),
                    dropOff: String(sheet[`J${row + 1}`]?.v || ""),
                    unitType: String(sheet[`L${row + 1}`]?.v || ""),
                    amount: String(sheet[`M${row + 1}`]?.v || ""),
                    driverRate: String(sheet[`N${row + 1}`]?.v || ""),
                    company: String(sheet[`O${row + 1}`]?.v || "Ol-Star Transport"),
                    bookingType: String(sheet[`P${row + 1}`]?.v || ""),
                    transportUnit: String(sheet[`R${row + 1}`]?.v || ""),
                    color: String(sheet[`S${row + 1}`]?.v || ""),
                    plateNumber: String(sheet[`T${row + 1}`]?.v || ""),
                    luggage: String(sheet[`U${row + 1}`]?.v || "1"),
                    current: { driverName: String(driverName), cellPhone: String(cellPhone) },
                    status: String(sheet[`E${row + 1}`]?.v || "").toLowerCase().includes("cancel") ? "Cancelled" : "Pending"
                };

                schedules.push(schedule);

                // Optional: EmailJS sending (if client email exists)
                if (clientEmail) {
                    const emailData = {
                        to_email: clientEmail,
                        client_name: schedule.clientName,
                        company: schedule.company,
                        date: schedule.date,
                        time: schedule.time,
                        pax: schedule.pax,
                        pickup: schedule.pickup,
                        dropOff: schedule.dropOff,
                        driverName: String(driverName),
                        cellPhone: String(cellPhone),
                        transportUnit: schedule.transportUnit,
                        unitType: schedule.unitType,
                        color: schedule.color,
                        plateNumber: schedule.plateNumber,
                        bookingType: schedule.bookingType,
                        luggage: schedule.luggage
                    };

                    emailPromises.push(
                        emailjs.send("service_xpol5bw", "template_4qbpeez", emailData)
                            .then(resp => console.log(`Email sent to ${clientEmail}`, resp.status))
                            .catch(err => console.error(`Failed to send email to ${clientEmail}`, err))
                    );
                }
            }

            if (!schedules.length) {
                showToast(`No schedules found for ${selectedDate}!`, "info");
                return;
            }

            // Save to Firebase
            const saved = await sendSchedulesToBackend(schedules);
            if (saved) {
                await fetchSchedules(selectedDate);
                showToast(`Schedules for ${selectedDate} saved successfully!`, "success");
            }

            if (emailPromises.length) await Promise.all(emailPromises);
        };

        reader.readAsArrayBuffer(file);
    });

    function populateDriverFilter(selectedDate) {
        const drivers = new Set();
        const currentSelection = driverFilter.value;

        // Filter schedules by selected date and collect drivers
        allSchedules
            .filter(s => s.date === selectedDate)
            .forEach(s => {
                if (s.current?.driverName) {
                    drivers.add(s.current.driverName);
                }
            });

        // Clear previous options
        driverFilter.innerHTML = `<option value="">— All Drivers —</option>`;

        // Add drivers with their trip counts for the day
        Array.from(drivers)
            .sort((a, b) => a.localeCompare(b))
            .forEach(driver => {
                const opt = document.createElement("option");
                opt.value = driver;
                
                // Count how many trips this driver has on selected date
                const tripCount = allSchedules.filter(s => 
                    s.date === selectedDate && 
                    s.current?.driverName === driver
                ).length;
                
                opt.textContent = `${driver} (${tripCount} trips)`;
                driverFilter.appendChild(opt);
            });

        // Restore previous selection if it still exists
        if (currentSelection && Array.from(driverFilter.options).some(o => o.value === currentSelection)) {
            driverFilter.value = currentSelection;
        }
    }

    driverFilter.addEventListener("change", () => {
        const selectedDriver = driverFilter.value;
        const selectedDate = dateFilter.value || getPHLocalISODate();

        let filtered = allSchedules.filter(s => s.date === selectedDate);

        if (selectedDriver) {
            filtered = filtered.filter(s => s.current?.driverName === selectedDriver);
        }

        renderSchedules(filtered);
    });

    function getTripTypeLabel(val) {
        return val || "-";
    }

    async function fetchUsersPhoneMap() {
        try {
            const res = await fetch("/api/admin/users");
            if (!res.ok) throw new Error("Failed to fetch users");
            const data = await res.json();
            const phoneMap = {};
            data.users.forEach(u => {
                const phoneDigits = (u.phone || "").replace(/\D/g, "");
                if (phoneDigits) {
                    phoneMap[phoneDigits] = `${u.firstName} ${u.middleName} ${u.lastName}`.replace(/\s+/g, " ").trim();
                }
            });
            return phoneMap;
        } catch (err) {
            console.error(err);
            return {};
        }
    }
    // ----------------- Reset Add Modal -----------------
    function resetManualForm() {
        manualForm.reset();
        editingTransactionID = null;
        driverInput.value = "";
        cellPhoneInput.value = "";
    }

    // ---------------- Manual Add / Edit ----------------
    addManualBtn.onclick = () => {
        resetManualForm();
        modal.style.display = "block";
    };
    closeModalBtn.onclick = () => {
        modal.style.display = "none";
        resetManualForm();
    };
    window.onclick = e => {
        if (e.target === modal) {
            modal.style.display = "none";
            resetManualForm();
        }
    };

    manualForm.onsubmit = async e => {
        e.preventDefault();

        const f = new FormData(manualForm);
        
        // Get the note value
        const note = f.get("note") || "";

        const data = {
            date: f.get("date"),
            time: f.get("time"),
            clientName: f.get("clientName"),
            contactNumber: f.get("contactNumber"),
            pickup: f.get("pickup"),
            dropOff: f.get("dropOff"),
            pax: f.get("pax"),
            flightNumber: f.get("flightNumber"),
            note: note,
            unitType: f.get("unitType"),
            amount: f.get("amount"),
            driverRate: f.get("driverRate"),
            company: f.get("company"),
            bookingType: f.get("bookingType"),
            transportUnit: f.get("transportUnit"),
            color: f.get("color"),
            plateNumber: f.get("plateNumber"),
            luggage: f.get("luggage"),
            tripType: f.get("tripType"),
            current: {
                driverName: driverInput.value,
                cellPhone: cellPhoneInput.value
            }
        };

        const url = editingTransactionID
            ? `/api/schedules/${editingTransactionID}`
            : `/api/schedules`;

        if (!editingTransactionID) {
            data.transactionID = generateTransactionID();
            // Check if note contains "cancel" (case insensitive)
            data.status = note.toLowerCase().includes("cancel") ? "Cancelled" : "Pending";
        } else {
            // For edits, preserve existing status unless note contains "cancel"
            if (note.toLowerCase().includes("cancel")) {
                data.status = "Cancelled";
            }
        }

        try {
            const res = await fetch(url, {
                method: editingTransactionID ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg);
            }

            modal.style.display = "none";
            resetManualForm();
            await fetchSchedules(dateFilter.value);

            showToast(
                editingTransactionID
                    ? "Schedule updated successfully!"
                    : "Schedule added successfully!"
            );

        } catch (err) {
            console.error("Manual save failed:", err);
            showToast("Failed to save schedule.", "error");
        }
    };

    function shouldBeCancelled(schedule) {
        return schedule.note && schedule.note.toLowerCase().includes("cancel");
    }


    // ---------------- Initial Load ----------------
    fetchSchedules();
    startAutoRefresh(); // refresh every 5000 milliseconds

    function applyActiveFilters() {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        const selectedDriver = driverFilter?.value || "";

        let filtered = allSchedules.filter(s => s.date === selectedDate);

        if (selectedDriver) {
            filtered = filtered.filter(
                s => s.current?.driverName === selectedDriver
            );
            // When filtering by driver, their trip numbers remain 1,2,3 etc.
            // No need to renumber - they keep their permanent numbers
        }

        renderSchedules(filtered);
    }

    document.getElementById("getSchedulesBtn").addEventListener("click", async () => {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        const selectedDriver = driverFilter?.value || "";
        
        // Filter schedules based on current filters
        let filteredSchedules = allSchedules.filter(s => s.date === selectedDate);
        
        if (selectedDriver) {
            filteredSchedules = filteredSchedules.filter(
                s => s.current?.driverName === selectedDriver
            );
        }
        
        if (filteredSchedules.length === 0) {
            showToast("No schedules found for the selected filters.", "info");
            return;
        }
        
        // Sort schedules by time
        const sortedSchedules = sortSchedulesByDateTime(filteredSchedules);
        
        // Format the date
        const formattedDate = new Date(selectedDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        // Build the formatted text
        let formattedText = '';
        
        sortedSchedules.forEach((schedule, index) => {
            // Get driver name and clean contact number
            const driverName = schedule.current?.driverName || "Unassigned";
            const contactNumber = schedule.contactNumber || "";
            
            // Clean and format contact number (remove spaces, ensure format)
            const cleanContact = contactNumber.replace(/\s+/g, "");
            
            // If this is the first item, add header with date and driver info
            if (index === 0) {
                formattedText += `Date: ${formattedDate}\n`;
                formattedText += `Driver: ${driverName}\n`;
                formattedText += `_________________________________________\n`;
            }
            
            // Add each schedule entry
            formattedText += `${index + 1})\n`;
            formattedText += `TRANSPOR UNIT:  ${schedule.transportUnit || "N/A"}\n`;
            formattedText += `PLATE NO:  ${schedule.plateNumber || "N/A"}\n`;
            formattedText += `SAHOD: ${schedule.driverRate || "0"}\n`;
            formattedText += `\n`;
            formattedText += `COMPANY NAME: ${schedule.company || "N/A"}\n`;
            formattedText += `TYPE OF SERVICE:  ${formattedDate}\n`;
            formattedText += `\n`;
            formattedText += `Date: ${formattedDate}\n`;
            formattedText += `Pickup Time: ${schedule.time || "N/A"}\n`;
            formattedText += `Clients Name: ${schedule.clientName || "N/A"}\n`;
            formattedText += `Contact No: ${schedule.contactNumber || "N/A"}\n`;
            formattedText += `Number of Pax: ${schedule.pax || "0"}\n`;
            formattedText += `Flight ${schedule.flightNumber || "0"}\n`;
            formattedText += `\n`;
            formattedText += `Pickup Area:\n`;
            formattedText += `${schedule.pickup || "N/A"}\n`;
            formattedText += `\n`;
            formattedText += `Drop Off:\n`;
            formattedText += `${schedule.dropOff || "N/A"}\n`;
            
            // Add separator between entries (except for the last one)
            if (index < sortedSchedules.length - 1) {
                formattedText += `__________________________\n`;
            }
        });
        
        // Add rate at the end
        formattedText += `\nRate: 1750`;
        
        // Copy to clipboard
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(formattedText);
            } else {
                // Fallback for HTTP / older browsers
                const textarea = document.createElement("textarea");
                textarea.value = formattedText;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
            }
            
            showToast(`✅ Copied ${sortedSchedules.length} schedule(s) to clipboard!`);
        } catch (err) {
            console.error("Copy failed:", err);
            showToast("Failed to copy to clipboard", "error");
        }
    });
});