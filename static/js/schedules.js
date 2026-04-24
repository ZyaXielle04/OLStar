// =======================
// SCHEDULES MANAGEMENT - OPTIMIZED VERSION WITH DOWNLOAD
// =======================

// =======================
// CACHE MANAGEMENT
// =======================
class ScheduleDataManager {
    constructor() {
        this.schedulesCache = null;
        this.transportUnitsCache = null;
        this.lastSchedulesFetch = 0;
        this.lastTransportFetch = 0;
        this.cacheDuration = {
            schedules: 5000,    // 5 seconds
            transportUnits: 3600000  // 1 hour
        };
        this.pendingRequests = new Map();
    }

    async fetchWithDedupe(url, options = {}) {
        const key = `${url}_${JSON.stringify(options)}`;
        
        if (this.pendingRequests.has(key)) {
            console.log(`Deduplicating request to: ${url}`);
            return this.pendingRequests.get(key);
        }
        
        const promise = fetch(url, options).then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        }).finally(() => {
            this.pendingRequests.delete(key);
        });
        
        this.pendingRequests.set(key, promise);
        return promise;
    }

    async getSchedules(forceRefresh = false) {
        const now = Date.now();
        
        if (!forceRefresh && this.schedulesCache && 
            (now - this.lastSchedulesFetch) < this.cacheDuration.schedules) {
            console.log("Using cached schedules");
            return this.schedulesCache;
        }
        
        console.log("Fetching fresh schedules...");
        const data = await this.fetchWithDedupe("/api/schedules");
        
        if (data.success) {
            this.schedulesCache = data;
            this.lastSchedulesFetch = now;
        }
        
        return data;
    }

    async getTransportUnits(forceRefresh = false) {
        const now = Date.now();
        
        if (!forceRefresh && this.transportUnitsCache && 
            (now - this.lastTransportFetch) < this.cacheDuration.transportUnits) {
            console.log("Using cached transport units");
            return this.transportUnitsCache;
        }
        
        console.log("Fetching fresh transport units...");
        const data = await this.fetchWithDedupe("/api/transportUnits");
        
        if (data.success) {
            this.transportUnitsCache = data;
            this.lastTransportFetch = now;
        }
        
        return data;
    }

    clearCache() {
        this.schedulesCache = null;
        this.transportUnitsCache = null;
        this.lastSchedulesFetch = 0;
        this.lastTransportFetch = 0;
    }
}

// Initialize data manager
const scheduleManager = new ScheduleDataManager();

// =======================
// DOM ELEMENTS
// =======================
document.addEventListener("DOMContentLoaded", () => {
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

    // Schedule History Modal
    const scheduleHistoryModal = document.getElementById("scheduleHistoryModal");
    const historyContent = document.getElementById("historyContent");
    const closeHistoryModal = document.getElementById("closeHistoryModal");
    const closeHistoryBtn = document.getElementById("closeHistoryBtn");

    // =======================
    // GLOBAL VARIABLES
    // =======================
    let allSchedules = [];
    let usersList = [];
    let editingTransactionID = null;
    let transportUnitsList = [];
    let autoRefreshTimer = null;
    let isPageVisible = true;
    let searchTimeout = null;

    // =======================
    // HELPER FUNCTIONS
    // =======================
    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

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

    function getPHLocalISODate() {
        const nowPH = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
        const d = new Date(nowPH);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

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

    function getTripTypeLabel(val) {
        return val || "-";
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

    function shouldBeCancelled(schedule) {
        return schedule.note && schedule.note.toLowerCase().includes("cancel");
    }

    // =======================
    // STRUCTURED DOWNLOAD FUNCTIONS (INSIDE DOMContentLoaded)
    // =======================
    
    function formatTimeForFolder(timeStr) {
        if (!timeStr) return "0000";
        
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!match) return timeStr.replace(/[^0-9]/g, '');
        
        let [, hour, minute, period] = match;
        hour = parseInt(hour, 10);
        minute = parseInt(minute, 10);
        
        if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12;
        if (period.toUpperCase() === 'AM' && hour === 12) hour = 0;
        
        return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
    }

    async function downloadStructuredImage(imageUrl, schedule, imageType, imageIndex = 1) {
        console.log(`[DOWNLOAD] Starting download for ${imageType} - ${schedule.transactionID}`);
        
        if (!imageUrl) {
            showToast(`No ${imageType} image available`, "info");
            return false;
        }
        
        // Fix Cloudinary URLs
        let downloadUrl = imageUrl;
        
        // Ensure HTTPS in production
        if (window.location.protocol === 'https:' && downloadUrl.startsWith('http:')) {
            downloadUrl = downloadUrl.replace('http:', 'https:');
        }
        
        const timeFolder = formatTimeForFolder(schedule.time);
        const displayTime = schedule.time || "0000";
        const filename = `${imageType}_${imageIndex}.jpg`;
        const fullPath = `${schedule.date}/${displayTime}/${filename}`;
        
        Swal.fire({
            title: 'Downloading...',
            text: `Saving to: ${fullPath}`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        try {
            // Use backend API to download
            const response = await fetch('/api/schedules/download-structured', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    imageUrl: downloadUrl,
                    dateFolder: schedule.date,
                    timeFolder: timeFolder,
                    filename: filename,
                    scheduleId: schedule.transactionID,
                    imageType: imageType
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            // Get the blob from response
            const blob = await response.blob();
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fullPath;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Swal.close();
            showToast(`✅ Downloaded: ${filename}`, "success");
            return true;
            
        } catch (error) {
            Swal.close();
            console.error('Download failed:', error);
            
            // Fallback: Open in new tab
            const result = await Swal.fire({
                title: 'Download Failed',
                text: error.message || 'Could not download automatically. Open image in new tab?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Open Image',
                cancelButtonText: 'Cancel'
            });
            
            if (result.isConfirmed) {
                window.open(downloadUrl, '_blank');
                showToast("Right-click the image and select 'Save Image As'", "info");
            } else {
                showToast("Download cancelled", "info");
            }
            return false;
        }
    }

    async function downloadAllScheduleImages(schedule) {
        const images = [];
        
        const flightScreenshot = schedule.PhotoUrl?.flightAwareUrl || schedule.flightScreenshot;
        const pendingPhoto = schedule.PhotoUrl?.pendingPhotoUrl;
        const confirmedPhoto = schedule.PhotoUrl?.confirmedPhotoUrl;
        const arrivedPhoto = schedule.PhotoUrl?.arrivedPhotoUrl;
        const onRoutePhoto = schedule.PhotoUrl?.OnRoutePhotoUrl;
        
        if (flightScreenshot) images.push({ url: flightScreenshot, type: 'flight' });
        if (pendingPhoto) images.push({ url: pendingPhoto, type: 'pending' });
        if (confirmedPhoto) images.push({ url: confirmedPhoto, type: 'confirmed' });
        if (arrivedPhoto) images.push({ url: arrivedPhoto, type: 'arrived' });
        if (onRoutePhoto) images.push({ url: onRoutePhoto, type: 'onroute' });
        
        if (images.length === 0) {
            showToast("No images available for this schedule", "info");
            return;
        }
        
        Swal.fire({
            title: 'Downloading All Images',
            html: `Downloading ${images.length} images for schedule ${schedule.transactionID}...<br><progress id="downloadProgress" value="0" max="${images.length}" style="width: 100%; margin-top: 10px;"></progress>`,
            allowOutsideClick: false,
            showConfirmButton: false
        });
        
        let successCount = 0;
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const timeFolder = formatTimeForFolder(schedule.time);
            const displayTime = schedule.time || "0000";
            const filename = `${img.type}_${schedule.transactionID}.jpg`;
            
            try {
                const response = await fetch('/api/schedules/download-structured', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        imageUrl: img.url,
                        dateFolder: schedule.date,
                        timeFolder: timeFolder,
                        filename: filename,
                        scheduleId: schedule.transactionID,
                        imageType: img.type
                    })
                });
                
                if (response.ok) {
                    // Get blob and trigger download
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${schedule.date}_${displayTime}_${filename}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    successCount++;
                }
                
                const progress = document.getElementById('downloadProgress');
                if (progress) progress.value = i + 1;
                
                // Add delay between downloads
                if (i < images.length - 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }
                
            } catch (error) {
                console.error('Download failed:', error);
                const progress = document.getElementById('downloadProgress');
                if (progress) progress.value = i + 1;
            }
        }
        
        Swal.close();
        showToast(`✅ Downloaded ${successCount}/${images.length} images for ${schedule.transactionID}`, "success");
    }

    // =======================
    // TRIP NUMBER ASSIGNMENT
    // =======================
    function assignTripNumbers(schedules) {
        const schedulesByDriver = {};
        
        schedules.forEach(schedule => {
            const driverName = schedule.current?.driverName || "Unassigned";
            if (!schedulesByDriver[driverName]) {
                schedulesByDriver[driverName] = [];
            }
            schedulesByDriver[driverName].push(schedule);
        });
        
        Object.keys(schedulesByDriver).forEach(driver => {
            const driverSchedules = schedulesByDriver[driver];
            const byDate = {};
            
            driverSchedules.forEach(schedule => {
                if (!byDate[schedule.date]) {
                    byDate[schedule.date] = [];
                }
                byDate[schedule.date].push(schedule);
            });
            
            Object.keys(byDate).forEach(date => {
                const dateSchedules = byDate[date];
                dateSchedules.sort((a, b) => {
                    return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
                });
                
                let tripNumber = 1;
                dateSchedules.forEach(schedule => {
                    schedule.tripNumber = tripNumber++;
                });
            });
        });
        
        return schedules;
    }

    // =======================
    // MODAL FUNCTIONS
    // =======================
    function openStatusPhotoModal(photoUrl) {
        if (!photoUrl) {
            showToast("No photo uploaded for this status yet.", "info");
            return;
        }
        statusPhotoImg.src = photoUrl;
        downloadStatusPhoto.href = photoUrl;
        statusPhotoModal.style.display = "block";
    }

    function closeStatusPhotoModalHandler() {
        statusPhotoModal.style.display = "none";
        statusPhotoImg.src = "";
    }

    // =======================
    // API FUNCTIONS
    // =======================
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

    async function fetchTransportUnits(forceRefresh = false) {
        try {
            const data = await scheduleManager.getTransportUnits(forceRefresh);
            if (data.success) {
                transportUnitsList = data.transportUnits || [];
                populatePlateSuggestions();
            }
        } catch (err) {
            console.error("Error fetching transport units:", err);
            transportUnitsList = [];
        }
    }

    function populatePlateSuggestions() {
        if (!plateDatalist) return;
        plateDatalist.innerHTML = "";
        transportUnitsList.forEach(unit => {
            if (unit.plateNumber) {
                const option = document.createElement("option");
                option.value = unit.plateNumber;
                plateDatalist.appendChild(option);
            }
        });
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

    async function deleteScheduleFromBackend(transactionID) {
        try {
            const res = await fetch(`/api/schedules/${transactionID}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await res.text());
            scheduleManager.clearCache();
            return true;
        } catch (err) {
            console.error("Failed to delete schedule:", err);
            showToast("Failed to delete schedule.", "error");
            return false;
        }
    }

    // =======================
    // FLIGHT SCREENSHOT
    // =======================
    async function captureFlightScreenshot(flightNumber, transactionId = null) {
        if (!flightNumber) {
            showToast("No flight number available", "info");
            return;
        }
        
        Swal.fire({
            title: 'Capturing Flight Screenshot',
            text: `Please wait while we capture ${flightNumber} from FlightAware...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
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
                showToast(transactionId ? "✅ Flight screenshot captured and saved!" : "✅ Flight screenshot captured!");
                scheduleManager.clearCache();
            } else {
                showToast(`❌ Failed: ${data.error || 'Unknown error'}`, "error");
            }
        } catch (err) {
            Swal.close();
            console.error("Flight screenshot error:", err);
            showToast("❌ Failed to capture flight screenshot", "error");
        }
    }

    function viewExistingFlightScreenshot(schedule) {
        const screenshotUrl = schedule.PhotoUrl?.flightAwareUrl || schedule.flightScreenshot;
        if (screenshotUrl) {
            window.open(screenshotUrl, '_blank');
        } else {
            showToast("No screenshot available for this flight", "info");
        }
    }

    // =======================
    // SCHEDULE HISTORY
    // =======================
    async function viewScheduleHistory(transactionId) {
        if (!transactionId) {
            showToast("No transaction ID available", "error");
            return;
        }
        
        try {
            const response = await fetch(`/api/schedules/${transactionId}/history`);
            const data = await response.json();
            
            if (data.success) {
                displayHistoryModal(data.history, transactionId);
            } else {
                showToast("Failed to load history", "error");
            }
        } catch (err) {
            console.error("Error loading history:", err);
            showToast("Error loading history", "error");
        }
    }

    function displayHistoryModal(history, transactionId) {
        if (!historyContent) return;
        
        if (!history || history.length === 0) {
            historyContent.innerHTML = `<div style="text-align: center; padding: 40px; color: #666;"><p>No change history available for this schedule.</p></div>`;
        } else {
            const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            let historyHtml = '';
            
            sortedHistory.forEach((entry, index) => {
                const date = new Date(entry.timestamp);
                const formattedDate = date.toLocaleString();
                let userDisplay = entry.user || 'System';
                
                historyHtml += `
                    <div class="history-entry" style="background: ${index === 0 ? '#f0f7ff' : '#f8f9fa'}; border-left: 4px solid ${index === 0 ? '#007bff' : '#6c757d'}; padding: 15px; margin-bottom: 15px; border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <strong style="color: ${index === 0 ? '#007bff' : '#495057'};">${entry.action === 'created' ? '📝 Created' : '✏️ Updated'}</strong>
                            <span style="color: #666; font-size: 0.9em;">🕒 ${formattedDate}</span>
                        </div>
                        <div style="margin-bottom: 15px; background: #e3f2fd; padding: 8px 12px; border-radius: 4px; display: inline-block;">
                            👤 <strong>Edited by:</strong> <span style="color: #0d47a1;">${escapeHtml(userDisplay)}</span>
                        </div>
                        <div style="margin-top: 15px; border: 1px solid #dee2e6; border-radius: 6px; overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                                <thead>
                                    <tr style="background: #343a40; color: white;">
                                        <th style="padding: 10px; text-align: left;">Field</th>
                                        <th style="padding: 10px; text-align: left;">Old Value</th>
                                        <th style="padding: 10px; text-align: left;">New Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;
                
                entry.changes.forEach(change => {
                    let fieldName = change.field;
                    let oldVal = change.old || '(empty)';
                    let newVal = change.new || '(empty)';
                    
                    const fieldLabels = {
                        'driverName': 'Driver Name', 'cellPhone': 'Contact #', 'driver_transfer': 'Driver Transfer',
                        'date': 'Date', 'time': 'Time', 'clientName': 'Client Name', 'contactNumber': 'Client Contact',
                        'pickup': 'Pickup Location', 'dropOff': 'Drop Off Location', 'pax': 'Pax', 'flightNumber': 'Flight Number',
                        'note': 'Note/Email', 'unitType': 'Unit Type', 'amount': 'Amount', 'driverRate': 'Driver Rate',
                        'company': 'Company', 'bookingType': 'Booking Type', 'transportUnit': 'Transport Unit',
                        'color': 'Color', 'plateNumber': 'Plate Number', 'luggage': 'Luggage', 'tripType': 'Trip Type'
                    };
                    
                    fieldName = fieldLabels[change.field] || change.field;
                    const isTransfer = change.field === 'driver_transfer';
                    const rowStyle = isTransfer ? 'background: #fff3cd;' : '';
                    
                    if (oldVal.length > 50) oldVal = oldVal.substring(0, 50) + '...';
                    if (newVal.length > 50) newVal = newVal.substring(0, 50) + '...';
                    
                    historyHtml += `
                        <tr style="${rowStyle} border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 10px; font-weight: 600;">${escapeHtml(fieldName)}</td>
                            <td style="padding: 10px; ${oldVal === '(empty)' ? 'color: #999; font-style: italic;' : ''}">${escapeHtml(oldVal)}</td>
                            <td style="padding: 10px; ${newVal === '(empty)' ? 'color: #999; font-style: italic;' : ''}">${escapeHtml(newVal)}</td>
                        </tr>
                    `;
                });
                
                historyHtml += `</tbody>}}</div></div>`;
            });
            historyContent.innerHTML = historyHtml;
        }
        
        if (scheduleHistoryModal) {
            scheduleHistoryModal.style.display = "block";
        }
    }

    // =======================
    // BUILD MESSAGE
    // =======================
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

    // =======================
    // RENDER STATUS PROGRESS
    // =======================
    function renderStatusProgress(status, data) {
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
            const step = document.createElement("div");
            step.classList.add("status-step");
            
            const circle = document.createElement("div");
            circle.classList.add("status-circle");
            circle.textContent = index + 1;
            
            if (cancelled || noShow) {
                circle.style.backgroundColor = "red";
            } else if (index <= currentIndex) {
                circle.style.backgroundColor = "#aacafd";
            }
            
            circle.style.cursor = "pointer";
            circle.addEventListener("click", () => {
                const statusKey = statusKeys[index];
                const photoKey = STATUS_PHOTO_MAP[statusKey];
                if (!photoKey) return;
                const photoContainer = data.PhotoUrl || data.photoUrl || data.photos || {};
                const photoUrl = photoContainer[photoKey];
                openStatusPhotoModal(photoUrl);
            });
            
            const label = document.createElement("div");
            label.classList.add("status-label");
            
            if (cancelled) {
                label.textContent = index === 2 ? "Booking Cancelled" : "";
            } else if (noShow) {
                label.textContent = index === 2 ? "Client No Show" : "";
            } else {
                label.textContent = statusMap[key];
            }
            
            step.appendChild(circle);
            step.appendChild(label);
            
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

    // =======================
    // RING DRIVER FUNCTION
    // =======================
    async function ringDriver(transactionId, driverName) {
        if (!transactionId) {
            showToast("No transaction ID available", "info");
            return;
        }
        
        if (!driverName || driverName === "Unassigned") {
            showToast("No driver assigned to this trip", "warning");
            return;
        }
        
        const result = await Swal.fire({
            title: '🔔 Ring Driver?',
            html: `<div style="text-align: left;"><p><strong>Driver:</strong> ${escapeHtml(driverName)}</p><p><strong>Trip:</strong> ${escapeHtml(transactionId)}</p><p style="color: #ff6b6b; margin-top: 15px;">This will send an alarm notification to the driver's phone.</p></div>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '🔔 Ring Now',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#ff6b6b'
        });
        
        if (!result.isConfirmed) return;
        
        Swal.fire({
            title: 'Ringing Driver...',
            text: 'Sending alarm notification',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        try {
            const getCookie = (name) => {
                const value = `; ${document.cookie}`;
                const parts = value.split(`; ${name}=`);
                if (parts.length === 2) return parts.pop().split(";").shift();
                return "";
            };
            
            const response = await fetch(`/api/driver/ring/${transactionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("XSRF-TOKEN") }
            });
            
            const data = await response.json();
            Swal.close();
            
            if (data.success) {
                await Swal.fire({ title: '✅ Ring Sent!', html: `<p>Alarm sent to ${escapeHtml(driverName)}</p>`, icon: 'success' });
            } else if (data.error === "Driver not registered for push notifications") {
                Swal.fire({ title: '📱 Driver Not Registered', html: `<p>${escapeHtml(driverName)} hasn't registered for push notifications.</p>${data.driver_phone ? `<p><strong>Phone:</strong> ${data.driver_phone}</p>` : ''}`, icon: 'warning' });
            } else {
                showToast(`Failed: ${data.error || 'Unknown error'}`, "error");
            }
        } catch (err) {
            Swal.close();
            console.error("Ring driver error:", err);
            showToast("Failed to ring driver", "error");
        }
    }

    // =======================
    // CREATE CALENDAR EVENT
    // =======================
    function isSuperAdmin() {
        const superadminEmails = [
            "zyacodesservices@gmail.com",
            "olstaropc@gmail.com",
            "far.ana@gmail.com"
        ];
        
        const userRole = window.userRole || "";
        const userEmail = window.userEmail || "";
        
        console.log("isSuperAdmin check - Role:", userRole, "Email:", userEmail);
        
        const isSuper = userRole === 'admin' && superadminEmails.includes(userEmail);
        console.log("Is Super Admin:", isSuper);
        
        return isSuper;
    }

    function createCalendarEvent(data) {
        console.log("Creating event for:", data.transactionID, "Amount:", data.amount);
        
        const event = document.createElement("div");
        event.classList.add("calendar-event");

        const driverName = data.current?.driverName || "Unassigned";
        const tripNumber = data.tripNumber || null;
        const showAmount = isSuperAdmin();
        
        console.log("Show amount for this event:", showAmount);

        if (data.clientNoShow === true) event.classList.add("no-show-trip");
        if (data.status === "Completed") event.classList.add("completed-trip");

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

        let driverBadge = '';
        if (tripNumber) {
            const hasScreenshot = data.PhotoUrl?.flightAwareUrl || data.flightScreenshot;
            driverBadge = `<div class="driver-trip-badge" title="${escapeHtml(driverName)}"><span class="trip-num">#${tripNumber}</span>${hasScreenshot ? `<span class="screenshot-indicator" style="cursor:pointer; margin-left:5px; font-size:20px;">📸</span>` : ''}</div>`;
        }

        event.innerHTML = `
            <div class="event-select"><input type="checkbox" class="schedule-checkbox" data-id="${data.transactionID}" /></div>
            <div class="event-header">
                ${driverBadge}
                <div class="event-time">${data.time || ""}</div>
                <div class="event-tripType">${getTripTypeLabel(data.tripType)}</div>
                <div class="event-id">${data.transactionID || ""}</div>
                ${data.clientNoShow === true ? '<span class="no-show-badge">🚫 NO SHOW</span>' : ''}
                <span class="status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="event-info">
                <div class="event-top-row">
                    <div class="event-company"><strong>Company: ${escapeHtml(data.company || "-")}</strong> (${escapeHtml(data.unitType)})</div>
                    <div class="event-vehicle"><strong>${escapeHtml(data.transportUnit || "")} | ${escapeHtml(data.color || "")} | ${escapeHtml(data.plateNumber || "")}</strong></div>
                </div>
                <div class="client-info">
                    <strong class="client-name">${escapeHtml(data.clientName || "")}</strong>
                    <button class="btn-copy-client" title="Copy client name">📋</button>
                    <span> | </span>
                    <strong class="client-contact">${escapeHtml(data.contactNumber || "")}</strong>
                    <button class="btn-copy-contact" title="Copy contact number">📋</button>
                    <span> | </span>
                    <strong class="event-note">(${escapeHtml(data.note || "No email available on the note")})</strong>
                </div>
                <div class="event-route">
                    <p>Pickup Location: <strong>${escapeHtml(data.pickup || "")}</strong></p>
                    <p>Drop Off Location: <strong>${escapeHtml(data.dropOff || "")}</strong></p>
                </div>
                <div class="event-footer">
                    <div class="event-actions">
                        <div class="action-left">
                            <button class="btn-copy">📋 Message Template</button>
                            <button class="btn-flightaware">✈️ FlightAware</button>
                            <button class="btn-driver-transfer">🚕 Driver Transfer</button>
                            <button class="btn-email-client">📧 Email Client</button>
                            <button class="btn-ring-driver" data-transaction="${data.transactionID}">🔔 Ring Driver</button>
                            <button class="btn-download-images" data-schedule='${JSON.stringify(data)}'>⬇️ Download Images</button>
                        </div>
                        <div class="action-center">
                            <button class="btn-edit">Edit</button>
                            <button class="btn-delete">Delete</button>
                            <button class="btn-history" data-transaction="${data.transactionID}">📜 History</button>
                        </div>
                    </div>
                    <div class="driver-info">
                        <div class="driver-name"><strong>${escapeHtml(driverName)}</strong> | ${escapeHtml(data.current?.cellPhone || "")}</div>
                    </div>
                </div>
            </div>
            <div class="event-details">
                <div class="details-grid">
                    <div class="detail"><span class="label">Pax</span><span class="value">${data.pax || "-"}</span></div>
                    <div class="detail"><span class="label">Trip Type</span><span class="value">${getTripTypeLabel(data.tripType)}</span></div>
                    <div class="detail"><span class="label">Flight</span><span class="value">${escapeHtml(data.flightNumber || "-")}</span></div>
                    <div class="detail"><span class="label">Booking Type</span><span class="value">${escapeHtml(data.bookingType || "-")}</span></div>
                    ${showAmount ? `<div class="detail"><span class="label">Amount</span><span class="value">${data.amount || "-"}</span></div>` : ''}
                    <div class="detail"><span class="label">Driver Rate</span><span class="value">${data.driverRate || "-"}</span></div>
                    <div class="detail"><span class="label">Luggage</span><span class="value">${data.luggage || "-"}</span></div>
                </div>
            </div>
        `;

        event.appendChild(renderStatusProgress(rawStatus, data));

        // Event Listeners
        const btnRingDriver = event.querySelector(".btn-ring-driver");
        if (btnRingDriver) {
            if (!driverName || driverName === "Unassigned") {
                btnRingDriver.disabled = true;
                btnRingDriver.title = "No driver assigned";
                btnRingDriver.style.opacity = "0.5";
            }
            btnRingDriver.addEventListener("click", () => ringDriver(data.transactionID, driverName));
        }

        const btnHistory = event.querySelector(".btn-history");
        if (btnHistory) {
            btnHistory.addEventListener("click", () => viewScheduleHistory(data.transactionID));
        }

        const screenshotIndicator = event.querySelector('.screenshot-indicator');
        if (screenshotIndicator) {
            screenshotIndicator.addEventListener('click', (e) => {
                e.stopPropagation();
                viewExistingFlightScreenshot(data);
            });
        }

        // Download Images Button
        const btnDownloadImages = event.querySelector(".btn-download-images");
        // In the download button click handler
        if (btnDownloadImages) {
            btnDownloadImages.addEventListener("click", async (e) => {
                e.stopPropagation();
                let scheduleData;
                try {
                    scheduleData = JSON.parse(btnDownloadImages.getAttribute('data-schedule'));
                } catch (err) {
                    scheduleData = data;
                }
                
                const result = await Swal.fire({
                    title: 'Download Options',
                    text: 'How would you like to download?',
                    icon: 'question',
                    showDenyButton: true,
                    confirmButtonText: '📦 Download as ZIP',
                    denyButtonText: '📸 Download One by One',
                    cancelButtonText: 'Cancel'
                });
                
                if (result.isConfirmed) {
                    // Download as ZIP for this single schedule
                    await downloadScheduleAsZip(scheduleData);
                } else if (result.isDenied) {
                    // Original one-by-one download
                    await downloadAllScheduleImages(scheduleData);
                }
            });
        }

        const checkbox = event.querySelector(".schedule-checkbox");
        event.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("a")) return;
            checkbox.checked = !checkbox.checked;
            const id = checkbox.dataset.id;
            if (checkbox.checked) {
                selectedScheduleIDs.add(id);
            } else {
                selectedScheduleIDs.delete(id);
            }
            const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
            if (bulkDeleteBtn) bulkDeleteBtn.disabled = selectedScheduleIDs.size === 0;
            event.classList.toggle("selected-schedule", checkbox.checked);
        });

        const btnCopy = event.querySelector(".btn-copy");
        const btnFlightAware = event.querySelector(".btn-flightaware");
        const btnCopyClient = event.querySelector(".btn-copy-client");
        const btnCopyContact = event.querySelector(".btn-copy-contact");
        const btnDriverTransfer = event.querySelector(".btn-driver-transfer");
        const btnEmailClient = event.querySelector(".btn-email-client");

        if (btnEmailClient) {
            btnEmailClient.addEventListener("click", () => {
                const email = (data.note || "").trim();
                if (!email || !email.includes("@")) {
                    showToast("No valid email found for this client.", "info");
                    return;
                }
                const subject = `Your Transport Booking – ${data.company || "Ol-Star Transport"}`;
                const body = buildWhatsAppMessage(data);
                const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                window.open(gmailUrl, "_blank");
            });
        }

        if (btnDriverTransfer) {
            btnDriverTransfer.addEventListener("click", () => {
                const clientName = data.clientName || "[Client Name]";
                const newDriverName = data.current?.driverName || "[New Driver Name]";
                const unit = data.transportUnit || "[Unit]";
                const plate = data.plateNumber || "[Plate No.]";
                const color = data.color || "[Color]";
                const message = `Hi Sir/Madam ${clientName},\n\nWe apologize that we have to change your assigned driver and unit due to certain reason. Here is the new assigned Driver information:\n\nDriver's Name: ${newDriverName}\nUnit: ${unit}\nPlate No.: ${plate}\nColor: ${color}\n\nRest assured that the driver will be there.`;
                copyText(message, "Driver transfer message copied!");
            });
        }

        if (btnCopy) {
            btnCopy.addEventListener("click", async () => {
                const message = buildWhatsAppMessage(data);
                copyText(message, "Message copied to clipboard!");
            });
        }

        if (btnCopyClient) {
            btnCopyClient.addEventListener("click", () => copyText(data.clientName, "Client name copied!"));
        }
        
        if (btnCopyContact) {
            btnCopyContact.addEventListener("click", () => copyText(data.contactNumber, "Contact number copied!"));
        }

        if (btnFlightAware) {
            btnFlightAware.addEventListener("click", async () => {
                if (!data.flightNumber) {
                    showToast("No flight number available", "info");
                    return;
                }
                const flightNumber = data.flightNumber.replace(/\s+/g, "").toUpperCase();
                const existingScreenshot = data.PhotoUrl?.flightAwareUrl || data.flightScreenshot;
                
                if (existingScreenshot) {
                    Swal.fire({
                        title: 'Flight Options',
                        html: `<div style="margin-bottom: 20px;"><strong>Flight:</strong> ${flightNumber}</div><div style="display: flex; flex-direction: column; gap: 10px;"><button class="swal2-confirm swal2-styled" style="background-color: #3085d6;" onclick="window.open('https://www.flightaware.com/live/flight/${flightNumber}', '_blank')">🌐 Open FlightAware</button><button class="swal2-confirm swal2-styled" style="background-color: #28a745;" onclick="window.open('${existingScreenshot}', '_blank')">👁️ View Screenshot</button><button class="swal2-deny swal2-styled" style="background-color: #dd33dd;" onclick="captureFlightScreenshot('${flightNumber}', '${data.transactionID}')">📸 Take New Screenshot</button><button class="swal2-cancel swal2-styled" onclick="Swal.close()">Cancel</button></div>`,
                        showConfirmButton: false
                    });
                } else {
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
                        window.open(`https://www.flightaware.com/live/flight/${flightNumber}`, "_blank");
                    } else if (result.isDenied) {
                        await captureFlightScreenshot(flightNumber, data.transactionID);
                    }
                }
            });
        }

        const btnEdit = event.querySelector(".btn-edit");
        if (btnEdit) {
            btnEdit.addEventListener("click", () => {
                if (modal) modal.style.display = "block";
                editingTransactionID = data.transactionID;
                for (let [key, value] of Object.entries(data)) {
                    const input = manualForm ? manualForm.querySelector(`[name="${key}"]`) : null;
                    if (input) input.value = value;
                }
                if (data.current) {
                    if (driverInput) driverInput.value = data.current.driverName || "";
                    if (cellPhoneInput) cellPhoneInput.value = data.current.cellPhone || "";
                }
            });
        }

        const btnDelete = event.querySelector(".btn-delete");
        if (btnDelete) {
            btnDelete.addEventListener("click", async () => {
                const result = await Swal.fire({
                    title: "Delete Schedule",
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
                    if (await deleteScheduleFromBackend(data.transactionID)) {
                        event.remove();
                        showToast("Schedule deleted.", "success");
                    }
                }
            });
        }

        return event;
    }

    async function downloadScheduleAsZip(schedule) {
        console.log(`[ZIP DOWNLOAD] Creating ZIP for schedule: ${schedule.transactionID}`);
        
        // Collect all images for this schedule
        const images = [];
        
        const flightScreenshot = schedule.PhotoUrl?.flightAwareUrl || schedule.flightScreenshot;
        const pendingPhoto = schedule.PhotoUrl?.pendingPhotoUrl;
        const confirmedPhoto = schedule.PhotoUrl?.confirmedPhotoUrl;
        const arrivedPhoto = schedule.PhotoUrl?.arrivedPhotoUrl;
        const onRoutePhoto = schedule.PhotoUrl?.OnRoutePhotoUrl;
        
        if (flightScreenshot) images.push({ url: flightScreenshot, schedule: schedule, type: 'flight' });
        if (pendingPhoto) images.push({ url: pendingPhoto, schedule: schedule, type: 'pending' });
        if (confirmedPhoto) images.push({ url: confirmedPhoto, schedule: schedule, type: 'confirmed' });
        if (arrivedPhoto) images.push({ url: arrivedPhoto, schedule: schedule, type: 'arrived' });
        if (onRoutePhoto) images.push({ url: onRoutePhoto, schedule: schedule, type: 'onroute' });
        
        if (images.length === 0) {
            showToast("No images available for this schedule", "info");
            return;
        }
        
        Swal.fire({
            title: 'Creating ZIP File',
            text: `Preparing ${images.length} images for schedule ${schedule.transactionID}...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        try {
            const response = await fetch('/api/schedules/download-all-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    date: schedule.date,
                    images: images
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Download failed');
            }
            
            // Download the ZIP file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${schedule.date}_${schedule.transactionID}_images.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Swal.close();
            
            await Swal.fire({
                title: '✅ Download Complete!',
                html: `<div style="text-align: left;">
                    <p>Downloaded <strong>${images.length}</strong> images for schedule <strong>${schedule.transactionID}</strong>.</p>
                    <p><strong>To extract:</strong></p>
                    <ul>
                        <li><strong>Windows:</strong> Right-click → Extract All</li>
                        <li><strong>Mac:</strong> Double-click to unzip</li>
                    </ul>
                    <p>The ZIP contains the folder structure:<br>
                    <code>${schedule.date}/HHMM/type_${schedule.transactionID}.jpg</code></p>
                </div>`,
                icon: 'success',
                confirmButtonText: 'OK'
            });
            
        } catch (error) {
            Swal.close();
            console.error('ZIP download failed:', error);
            showToast(`Failed to create ZIP: ${error.message}`, "error");
        }
    }

    // =======================
    // RENDER SCHEDULES
    // =======================
    function renderSchedules(schedules) {
        if (!bookingsContainer) return;
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
                document.getElementById("bulkDeleteBtn").disabled = selectedScheduleIDs.size === 0;
            });
        });
    }

    // =======================
    // FETCH SCHEDULES (CACHED)
    // =======================
    async function fetchSchedules(selectedISO = null) {
        try {
            const data = await scheduleManager.getSchedules();
            if (!data.success) throw new Error("Failed to fetch schedules");
            
            const schedules = (data.schedules || []).map(schedule => {
                if (shouldBeCancelled(schedule) && schedule.status !== "Cancelled") {
                    schedule.status = "Cancelled";
                }
                return schedule;
            });
            
            allSchedules = assignTripNumbers(schedules);
            const filterISO = selectedISO || dateFilter.value || getPHLocalISODate();
            if (dateFilter) dateFilter.value = filterISO;
            populateDriverFilter(filterISO);
            applyActiveFilters();
        } catch (err) {
            console.error("Failed to fetch schedules:", err);
            if (selectedISO !== undefined) {
                showToast("Failed to load schedules.", "error");
            }
        }
    }

    // =======================
    // POPULATE DRIVER FILTER
    // =======================
    function populateDriverFilter(selectedDate) {
        if (!driverFilter) return;
        const drivers = new Set();
        const currentSelection = driverFilter.value;
        
        allSchedules.filter(s => s.date === selectedDate).forEach(s => {
            if (s.current?.driverName) drivers.add(s.current.driverName);
        });
        
        driverFilter.innerHTML = `<option value="">— All Drivers —</option>`;
        Array.from(drivers).sort((a, b) => a.localeCompare(b)).forEach(driver => {
            const tripCount = allSchedules.filter(s => s.date === selectedDate && s.current?.driverName === driver).length;
            const opt = document.createElement("option");
            opt.value = driver;
            opt.textContent = `${driver} (${tripCount} trips)`;
            driverFilter.appendChild(opt);
        });
        
        if (currentSelection && Array.from(driverFilter.options).some(o => o.value === currentSelection)) {
            driverFilter.value = currentSelection;
        }
    }

    function applyActiveFilters() {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        const selectedDriver = driverFilter?.value || "";
        let filtered = allSchedules.filter(s => s.date === selectedDate);
        if (selectedDriver) {
            filtered = filtered.filter(s => s.current?.driverName === selectedDriver);
        }
        renderSchedules(filtered);
    }

    // =======================
    // EXCEL IMPORT
    // =======================
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

    async function sendSchedulesToBackend(data, method = "POST", transactionID = null) {
        try {
            const getCookie = (name) => {
                const value = `; ${document.cookie}`;
                const parts = value.split(`; ${name}=`);
                if (parts.length === 2) return parts.pop().split(";").shift();
                return "";
            };
            const url = transactionID ? `/api/schedules/${transactionID}` : "/api/schedules";
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("XSRF-TOKEN") },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error(await res.text());
            scheduleManager.clearCache();
            return true;
        } catch (err) {
            console.error("Failed to save schedules:", err);
            showToast("Failed to save schedules.", "error");
            return false;
        }
    }

    // =======================
    // AUTO-REFRESH
    // =======================
    function startAutoRefresh(intervalMs = 10000) {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        autoRefreshTimer = setInterval(() => {
            if (isPageVisible) {
                const selectedDate = dateFilter?.value || getPHLocalISODate();
                fetchSchedules(selectedDate);
            }
        }, intervalMs);
    }

    // =======================
    // RESET FORM
    // =======================
    function resetManualForm() {
        if (manualForm) manualForm.reset();
        editingTransactionID = null;
        if (driverInput) driverInput.value = "";
        if (cellPhoneInput) cellPhoneInput.value = "";
    }

    // =======================
    // EVENT LISTENERS
    // =======================
    if (plateInput) {
        plateInput.addEventListener("input", () => {
            const value = plateInput.value.trim();
            const match = transportUnitsList.find(u => u.plateNumber === value);
            if (match) {
                if (transportUnitInput) transportUnitInput.value = match.transportUnit || "";
                if (unitTypeInput) unitTypeInput.value = match.unitType || "";
                if (colorInput) colorInput.value = match.color || "";
            } else {
                if (transportUnitInput) transportUnitInput.value = "";
                if (unitTypeInput) unitTypeInput.value = "";
                if (colorInput) colorInput.value = "";
            }
        });
    }

    if (driverInput) {
        driverInput.addEventListener("input", () => {
            const value = driverInput.value.toLowerCase();
            if (driverDatalist) driverDatalist.innerHTML = "";
            const matches = usersList.filter(u => u.fullName.toLowerCase().startsWith(value));
            matches.forEach(u => {
                const option = document.createElement("option");
                option.value = u.fullName;
                if (driverDatalist) driverDatalist.appendChild(option);
            });
            const exactMatch = usersList.find(u => u.fullName.toLowerCase() === value);
            if (exactMatch && cellPhoneInput) {
                cellPhoneInput.value = exactMatch.cellPhone.replace(/\D/g, "");
            } else if (cellPhoneInput) {
                cellPhoneInput.value = "";
            }
        });
    }

    if (dateFilter) {
        dateFilter.value = getPHLocalISODate();
        dateFilter.addEventListener("change", () => {
            populateDriverFilter(dateFilter.value);
            applyActiveFilters();
        });
    }

    if (driverFilter) {
        driverFilter.addEventListener("change", applyActiveFilters);
    }

    if (fileInput) {
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
                for (let row = range.s.r + 1; row <= range.e.r; row++) {
                    const dateValue = sheet[`A${row + 1}`]?.v;
                    const dateISO = excelToISODate(dateValue);
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
                }
                if (!schedules.length) {
                    showToast(`No schedules found for ${selectedDate}!`, "info");
                    return;
                }
                const saved = await sendSchedulesToBackend(schedules);
                if (saved) {
                    await fetchSchedules(selectedDate);
                    showToast(`Schedules for ${selectedDate} saved successfully!`, "success");
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    if (addManualBtn) {
        addManualBtn.onclick = () => {
            resetManualForm();
            if (modal) modal.style.display = "block";
        };
    }
    
    if (closeModalBtn) {
        closeModalBtn.onclick = () => {
            if (modal) modal.style.display = "none";
            resetManualForm();
        };
    }
    
    window.onclick = e => {
        if (e.target === modal) {
            if (modal) modal.style.display = "none";
            resetManualForm();
        }
        if (e.target === statusPhotoModal) closeStatusPhotoModalHandler();
        if (e.target === scheduleHistoryModal && scheduleHistoryModal) scheduleHistoryModal.style.display = "none";
    };

    if (closeStatusPhotoModal) closeStatusPhotoModal.onclick = closeStatusPhotoModalHandler;
    if (closeHistoryModal) closeHistoryModal.onclick = () => { if (scheduleHistoryModal) scheduleHistoryModal.style.display = "none"; };
    if (closeHistoryBtn) closeHistoryBtn.onclick = () => { if (scheduleHistoryModal) scheduleHistoryModal.style.display = "none"; };

    if (manualForm) {
        manualForm.onsubmit = async e => {
            e.preventDefault();
            const f = new FormData(manualForm);
            const note = f.get("note") || "";
            const data = {
                date: f.get("date"), time: f.get("time"), clientName: f.get("clientName"),
                contactNumber: f.get("contactNumber"), pickup: f.get("pickup"), dropOff: f.get("dropOff"),
                pax: f.get("pax"), flightNumber: f.get("flightNumber"), note: note,
                unitType: f.get("unitType"), amount: f.get("amount"), driverRate: f.get("driverRate"),
                company: f.get("company"), bookingType: f.get("bookingType"), transportUnit: f.get("transportUnit"),
                color: f.get("color"), plateNumber: f.get("plateNumber"), luggage: f.get("luggage"),
                tripType: f.get("tripType"), current: { driverName: driverInput?.value || "", cellPhone: cellPhoneInput?.value || "" }
            };
            const url = editingTransactionID ? `/api/schedules/${editingTransactionID}` : `/api/schedules`;
            if (!editingTransactionID) {
                data.transactionID = generateTransactionID();
                data.status = note.toLowerCase().includes("cancel") ? "Cancelled" : "Pending";
            } else if (note.toLowerCase().includes("cancel")) {
                data.status = "Cancelled";
            }
            try {
                const getCookie = (name) => {
                    const value = `; ${document.cookie}`;
                    const parts = value.split(`; ${name}=`);
                    if (parts.length === 2) return parts.pop().split(";").shift();
                    return "";
                };
                const res = await fetch(url, {
                    method: editingTransactionID ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("XSRF-TOKEN") },
                    credentials: "include",
                    body: JSON.stringify(data)
                });
                if (!res.ok) throw new Error(await res.text());
                if (modal) modal.style.display = "none";
                resetManualForm();
                scheduleManager.clearCache();
                await fetchSchedules(dateFilter?.value);
                showToast(editingTransactionID ? "Schedule updated successfully!" : "Schedule added successfully!");
            } catch (err) {
                console.error("Manual save failed:", err);
                showToast("Failed to save schedule.", "error");
            }
        };
    }

    document.getElementById("bulkDeleteBtn")?.addEventListener("click", async () => {
        const result = await Swal.fire({
            title: `Delete ${selectedScheduleIDs.size} selected schedules?`,
            text: "This action cannot be undone. Please type 'Confirm Delete' below to proceed.",
            input: "text", inputPlaceholder: "Type 'Confirm Delete' here", icon: "warning",
            showCancelButton: true, confirmButtonText: "Delete", cancelButtonText: "Cancel", confirmButtonColor: "#d33",
            preConfirm: (input) => { if (input !== "Confirm Delete") { Swal.showValidationMessage("You must type exactly 'Confirm Delete'"); return false; } return input; }
        });
        if (result.isConfirmed && result.value === "Confirm Delete") {
            for (const id of selectedScheduleIDs) await deleteScheduleFromBackend(id);
            selectedScheduleIDs.clear();
            await fetchSchedules(dateFilter?.value);
            showToast("Selected schedules deleted.", "success");
        }
    });

    document.getElementById("deleteAllBtn")?.addEventListener("click", async () => {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        const selectedDriver = driverFilter?.value;
        const targets = allSchedules.filter(s => { if (s.date !== selectedDate) return false; if (selectedDriver && s.current?.driverName !== selectedDriver) return false; return true; });
        if (!targets.length) { showToast("No schedules to delete.", "info"); return; }
        const result = await Swal.fire({
            title: `Delete ALL ${targets.length} filtered schedules?`,
            text: "This action cannot be undone. Please type 'Confirm Delete' below to proceed.",
            input: "text", inputPlaceholder: "Type 'Confirm Delete' here", icon: "warning",
            showCancelButton: true, confirmButtonText: "Delete", cancelButtonText: "Cancel", confirmButtonColor: "#d33",
            preConfirm: (input) => { if (input !== "Confirm Delete") { Swal.showValidationMessage("You must type exactly 'Confirm Delete'"); return false; } return input; }
        });
        if (result.isConfirmed && result.value === "Confirm Delete") {
            for (const s of targets) await deleteScheduleFromBackend(s.transactionID);
            await fetchSchedules(selectedDate);
            showToast("All filtered schedules deleted.", "success");
        }
    });

    // =======================
    // UNIVERSAL DOWNLOAD FOR DATE
    // =======================

    async function downloadAllImagesForDate(date) {
        if (!date) {
            date = dateFilter?.value || getPHLocalISODate();
        }
        
        const schedulesForDate = allSchedules.filter(s => s.date === date);
        
        if (schedulesForDate.length === 0) {
            showToast(`No schedules found for ${date}`, "info");
            return;
        }
        
        // Collect all images
        const images = [];
        for (const schedule of schedulesForDate) {
            const flightScreenshot = schedule.PhotoUrl?.flightAwareUrl || schedule.flightScreenshot;
            const pendingPhoto = schedule.PhotoUrl?.pendingPhotoUrl;
            const confirmedPhoto = schedule.PhotoUrl?.confirmedPhotoUrl;
            const arrivedPhoto = schedule.PhotoUrl?.arrivedPhotoUrl;
            const onRoutePhoto = schedule.PhotoUrl?.OnRoutePhotoUrl;
            
            if (flightScreenshot) images.push({ url: flightScreenshot, schedule: schedule, type: 'flight' });
            if (pendingPhoto) images.push({ url: pendingPhoto, schedule: schedule, type: 'pending' });
            if (confirmedPhoto) images.push({ url: confirmedPhoto, schedule: schedule, type: 'confirmed' });
            if (arrivedPhoto) images.push({ url: arrivedPhoto, schedule: schedule, type: 'arrived' });
            if (onRoutePhoto) images.push({ url: onRoutePhoto, schedule: schedule, type: 'onroute' });
        }
        
        if (images.length === 0) {
            showToast(`No images found for ${date}`, "info");
            return;
        }
        
        // Show progress
        Swal.fire({
            title: 'Creating ZIP File',
            text: `Preparing ${images.length} images for download...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        try {
            const response = await fetch('/api/schedules/download-all-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    date: date,
                    images: images
                })
            });
            
            if (!response.ok) {
                throw new Error('Download failed');
            }
            
            // Download the ZIP file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${date}_schedules_images.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Swal.close();
            
            // Show success message with instructions
            await Swal.fire({
                title: '✅ Download Complete!',
                html: `<div style="text-align: left;">
                    <p>Downloaded <strong>${images.length}</strong> images as a ZIP file.</p>
                    <p><strong>To extract:</strong></p>
                    <ul>
                        <li><strong>Windows:</strong> Right-click → Extract All</li>
                        <li><strong>Mac:</strong> Double-click to unzip</li>
                    </ul>
                    <p>The ZIP contains the folder structure:<br>
                    <code>${date}/HHMM/image_type_ID.jpg</code></p>
                </div>`,
                icon: 'success',
                confirmButtonText: 'OK'
            });
            
        } catch (error) {
            Swal.close();
            console.error('ZIP download failed:', error);
            showToast(`Failed to create ZIP: ${error.message}`, "error");
        }
    }

    // Add event listener for the universal download button
    document.getElementById("downloadAllImagesBtn")?.addEventListener("click", async () => {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        await downloadAllImagesForDate(selectedDate);
    });

    document.getElementById("getSchedulesBtn")?.addEventListener("click", async () => {
        const selectedDate = dateFilter?.value || getPHLocalISODate();
        const selectedDriver = driverFilter?.value || "";
        let filteredSchedules = allSchedules.filter(s => s.date === selectedDate);
        if (selectedDriver) filteredSchedules = filteredSchedules.filter(s => s.current?.driverName === selectedDriver);
        if (filteredSchedules.length === 0) { showToast("No schedules found for the selected filters.", "info"); return; }
        const sortedSchedules = sortSchedulesByDateTime(filteredSchedules);
        const formattedDate = new Date(selectedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let formattedText = '';
        sortedSchedules.forEach((schedule, index) => {
            const driverName = schedule.current?.driverName || "Unassigned";
            if (index === 0) { formattedText += `Date: ${formattedDate}\nDriver: ${driverName}\n_________________________________________\n`; }
            formattedText += `${index + 1})\nTRANSPOR UNIT:  ${schedule.transportUnit || "N/A"}\nPLATE NO:  ${schedule.plateNumber || "N/A"}\nSAHOD: ${schedule.driverRate || "0"}\n\nCOMPANY NAME: ${schedule.company || "N/A"}\nTYPE OF SERVICE:  ${formattedDate}\n\nDate: ${formattedDate}\nPickup Time: ${schedule.time || "N/A"}\nClients Name: ${schedule.clientName || "N/A"}\nContact No: ${schedule.contactNumber || "N/A"}\nNumber of Pax: ${schedule.pax || "0"}\nFlight ${schedule.flightNumber || "0"}\n\nPickup Area:\n${schedule.pickup || "N/A"}\n\nDrop Off:\n${schedule.dropOff || "N/A"}\n`;
            if (index < sortedSchedules.length - 1) formattedText += `__________________________\n`;
        });
        formattedText += `\nRate: 1750`;
        copyText(formattedText, `✅ Copied ${sortedSchedules.length} schedule(s) to clipboard!`);
    });

    // Visibility API
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (isPageVisible) {
            const selectedDate = dateFilter?.value || getPHLocalISODate();
            fetchSchedules(selectedDate);
        }
    });

    // =======================
    // INITIALIZATION
    // =======================
    fetchUsers();
    fetchTransportUnits();
    fetchSchedules();
    startAutoRefresh();

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        if (searchTimeout) clearTimeout(searchTimeout);
    });
});