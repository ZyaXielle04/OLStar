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

    // ---------------- Fetch and Render Schedules ----------------
    async function fetchSchedules(selectedISO = null) {
        try {
            const res = await fetch("/api/schedules");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            allSchedules = data.schedules || [];

            const filterISO = selectedISO || dateFilter.value || getPHLocalISODate();
            dateFilter.value = filterISO;

            populateDriverFilter(filterISO); // populate driver filter

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

        event.innerHTML = `

            <div class="event-select">
                <input
                type="checkbox"
                class="schedule-checkbox"
                data-id="${data.transactionID}"
                />
            </div>

            <div class="event-header">
                <div class="event-time">${data.time || ""}</div>
                <div class="event-tripType">${getTripTypeLabel(data.tripType)}</div>
                <div class="event-id">${data.transactionID || ""}</div>
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
                        </div>

                        <div class="action-center">
                            <button class="btn-edit">Edit</button>
                            <button class="btn-delete">Delete</button>
                        </div>
                    </div>

                    <div class="driver-info">
                        <div class="driver-name">
                            ${data.current?.driverName || ""} | ${data.current?.cellPhone || ""}
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
            const currentIndex = statusKeys.indexOf(status);

            statusKeys.forEach((key, index) => {
                // Step container
                const step = document.createElement("div");
                step.classList.add("status-step");

                // Circle
                const circle = document.createElement("div");
                circle.classList.add("status-circle");
                circle.textContent = index + 1;

                if (cancelled) {
                    circle.style.backgroundColor = "red";
                } else if (index <= currentIndex) {
                    circle.style.backgroundColor = "blue";
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
                    // Only the 3rd circle gets the "Booking Cancelled" text
                    label.textContent = index === 2 ? "Booking Cancelled" : "";
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

                    if (cancelled) {
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

        btnFlightAware.addEventListener("click", () => {
            if (!data.flightNumber) {
                showToast("No flight number available", "info");
                return;
            }

            // Clean flight number (remove spaces)
            const flightNumber = data.flightNumber.replace(/\s+/g, "").toUpperCase();

            const url = `https://www.flightaware.com/live/flight/${flightNumber}`;
            window.open(url, "_blank");
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
            const confirm = await Swal.fire({
                title: "Are you sure?",
                text: "This will delete the schedule permanently.",
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Yes, delete it!",
                cancelButtonText: "Cancel"
            });

            if (confirm.isConfirmed) {
                if (await deleteScheduleFromBackend(data.transactionID)) {
                    event.remove();
                    showToast("Schedule deleted.", "success");
                }
            }
        });

        return event;
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
        const confirm = await Swal.fire({
            title: "Delete selected schedules?",
            text: `You are about to delete ${selectedScheduleIDs.size} schedules.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Yes, delete",
        });

        if (!confirm.isConfirmed) return;

        for (const id of selectedScheduleIDs) {
            await deleteScheduleFromBackend(id);
        }

        selectedScheduleIDs.clear();
        await fetchSchedules(dateFilter.value);
        showToast("Selected schedules deleted.");
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

        const confirm = await Swal.fire({
            title: "Delete ALL schedules?",
            html: `This will delete <b>${targets.length}</b> schedules.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Yes, delete all",
        });

        if (!confirm.isConfirmed) return;

        for (const s of targets) {
            await deleteScheduleFromBackend(s.transactionID);
        }

        await fetchSchedules(selectedDate);
        showToast("All filtered schedules deleted.");
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
                    status: "Pending"
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

        // Remember the currently selected driver
        const currentSelection = driverFilter.value;

        // Filter schedules by selected date
        allSchedules
            .filter(s => s.date === selectedDate)
            .forEach(s => {
                if (s.current?.driverName) drivers.add(s.current.driverName);
            });

        // Clear previous options
        driverFilter.innerHTML = `<option value="">— All Drivers —</option>`;

        // Add drivers
        Array.from(drivers)
            .sort((a, b) => a.localeCompare(b))
            .forEach(driver => {
                const opt = document.createElement("option");
                opt.value = driver;
                opt.textContent = driver;
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

        const data = {
            transactionID: editingTransactionID || generateTransactionID(),
            date: f.get("date"), // PH-safe
            time: f.get("time"),
            clientName: f.get("clientName"),
            contactNumber: f.get("contactNumber"),
            pickup: f.get("pickup"),
            dropOff: f.get("dropOff"),
            pax: f.get("pax"),
            flightNumber: f.get("flightNumber"),
            note: f.get("note"),
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
            status: "Pending",
            current: {
                driverName: driverInput.value,
                cellPhone: cellPhoneInput.value
            }
        };

        const url = editingTransactionID
            ? `/api/schedules/${editingTransactionID}`
            : `/api/schedules`;

        try {
            const res = await fetch(url, {
                method: editingTransactionID ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
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
        }

        renderSchedules(filtered);
    }
});
