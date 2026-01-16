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

    // Filter users as admin types and populate datalist
    driverInput.addEventListener("input", () => {
        const value = driverInput.value.trim().toLowerCase();
        driverDatalist.innerHTML = "";

        if (!value) return;

        const matches = usersList.filter(u => {
            const first = (u.firstName || "").toLowerCase();
            const middle = (u.middleName || "").toLowerCase();
            const last = (u.lastName || "").toLowerCase();

            return (
                first.includes(value) ||
                middle.includes(value) ||
                last.includes(value)
            );
        });

        matches.forEach(u => {
            const fullName = `${u.firstName} ${u.middleName} ${u.lastName}`
                .replace(/\s+/g, " ")
                .trim();

            const option = document.createElement("option");
            option.value = fullName;
            driverDatalist.appendChild(option);
        });
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
    function getLocalISODate(offsetHours = 8) {
        const now = new Date();
        const localTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
        const year = localTime.getFullYear();
        const month = String(localTime.getMonth() + 1).padStart(2, "0");
        const day = String(localTime.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getTomorrowLocalISO(offsetHours = 8) {
        const now = new Date();
        const localTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
        localTime.setDate(localTime.getDate() + 1);
        const year = localTime.getFullYear();
        const month = String(localTime.getMonth() + 1).padStart(2, "0");
        const day = String(localTime.getDate()).padStart(2, "0");
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

    // ---------------- Global Schedules ----------------
    let allSchedules = [];
    let editingTransactionID = null;
    let usersList = [];

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

            const filterISO = selectedISO || dateFilter.value || getLocalISODate();
            dateFilter.value = filterISO;
            const filtered = allSchedules.filter(s => s.date === filterISO);
            renderSchedules(filtered);
        } catch (err) {
            console.error("Failed to fetch schedules:", err);
            showToast("Failed to load schedules.", "error");
        }
    }

    if (dateFilter) {
        dateFilter.value = getLocalISODate();
        dateFilter.addEventListener("change", () => {
            const selectedISO = dateFilter.value;
            const filtered = allSchedules.filter(s => s.date === selectedISO);
            renderSchedules(filtered);
        });
    }

    function createCalendarEvent(data) {
        const event = document.createElement("div");
        event.classList.add("calendar-event");
        const statusMap = {
            "Pending": "#1 The Driver is to depart",
            "Confirmed": "#2 Driver has departed",
            "Arrived": "#3 Driver has arrived",
            "On Route": "#4 Service Start",
            "Completed": "#5 Service finished",
            "Cancelled": "Booking Cancelled"
        };
        const rawStatus = data.status || "Pending";
        const statusClass = rawStatus.toLowerCase().replace(/\s+/g, "-");
        const statusLabel = statusMap[rawStatus] || rawStatus;

        event.innerHTML = `
            <div class="event-header">
                <div class="event-time">${data.time || ""}</div>
                <div class="event-id">${data.transactionID || ""}</div>
                <span class="status ${statusClass}">${statusLabel}</span>
            </div>

            <div class="event-info">
                <strong>${data.clientName || ""} | ${data.contactNumber || ""}</strong>
                (${data.current?.driverName || ""} | ${data.current?.cellPhone || ""})<br>
                ${data.pickup || ""} → ${data.dropOff || ""}

                <div class="event-actions">
                    <button class="btn-view-more">View More</button>
                    <button class="btn-edit">Edit</button>
                    <button class="btn-delete">Delete</button>
                </div>
            </div>

            <div class="event-details" style="display:none;">
                <div class="details-grid">
                    <div class="detail"><span class="label">Pax</span><span class="value">${data.pax || "-"}</span></div>
                    <div class="detail"><span class="label">Flight</span><span class="value">${data.flightNumber || "-"}</span></div>
                    <div class="detail"><span class="label">Booking Type</span><span class="value">${data.bookingType || "-"}</span></div>
                    <div class="detail"><span class="label">Amount</span><span class="value">${data.amount || "-"}</span></div>
                    <div class="detail"><span class="label">Driver Rate</span><span class="value">${data.driverRate || "-"}</span></div>
                    <div class="detail"><span class="label">Vehicle</span><span class="value">${data.transportUnit || "-"}</span></div>
                    <div class="detail"><span class="label">Color</span><span class="value">${data.color || "-"}</span></div>
                    <div class="detail"><span class="label">Plate</span><span class="value">${data.plateNumber || "-"}</span></div>
                    <div class="detail"><span class="label">Luggage</span><span class="value">${data.luggage || "-"}</span></div>
                </div>
                <div class="detail-note"><span class="label">Note</span><p>${data.note || "—"}</p></div>
            </div>
        `;

        const btnView = event.querySelector(".btn-view-more");
        const details = event.querySelector(".event-details");
        btnView.addEventListener("click", () => {
            const isHidden = details.style.display === "none";
            details.style.display = isHidden ? "block" : "none";
            btnView.textContent = isHidden ? "View Less" : "View More";
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
    }

    // ---------------- XLSX Upload ----------------
    fileInput.addEventListener("change", async e => {
        const file = e.target.files[0];
        if (!file) return;

        const phoneMap = await fetchUsersPhoneMap();

        const reader = new FileReader();
        reader.onload = async ev => {
            const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
            const sheetName = "BOOKING";
            if (!workbook.SheetNames.includes(sheetName)) {
                showToast("Sheet BOOKING not found", "error");
                return;
            }

            const sheet = workbook.Sheets[sheetName];
            const tomorrowStr = getTomorrowLocalISO();
            const range = XLSX.utils.decode_range(sheet["!ref"]);
            const schedules = [];

            for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const dateValue = sheet[`A${row + 1}`]?.v;
                const dateISO = excelToISODate(dateValue);
                if (dateISO !== tomorrowStr) continue;

                const rawPhone = sheet[`P${row + 1}`]?.v || "";
                const digits = rawPhone.replace(/\D/g, "");
                const cellPhone = digits.match(/09\d{9}/)?.[0] || "";

                let driverName = cleanDriverName(sheet[`J${row + 1}`]?.v || "");
                if (cellPhone && phoneMap[cellPhone]) {
                    driverName = phoneMap[cellPhone];
                }

                schedules.push({
                    transactionID: generateTransactionID(),
                    date: dateISO,
                    time: sheet[`B${row + 1}`]?.v || "",
                    clientName: sheet[`C${row + 1}`]?.v || "",
                    contactNumber: sheet[`D${row + 1}`]?.v || "",
                    note: sheet[`E${row + 1}`]?.v || "",
                    pax: sheet[`F${row + 1}`]?.v || "",
                    flightNumber: sheet[`G${row + 1}`]?.v || "",
                    pickup: sheet[`H${row + 1}`]?.v || "",
                    dropOff: sheet[`I${row + 1}`]?.v || "",
                    unitType: sheet[`K${row + 1}`]?.v || "",
                    amount: sheet[`L${row + 1}`]?.v || "",
                    driverRate: sheet[`M${row + 1}`]?.v || "",
                    company: sheet[`N${row + 1}`]?.v || "",
                    bookingType: sheet[`O${row + 1}`]?.v || "",
                    transportUnit: sheet[`Q${row + 1}`]?.v || "",
                    color: sheet[`R${row + 1}`]?.v || "",
                    plateNumber: sheet[`S${row + 1}`]?.v || "",
                    luggage: sheet[`T${row + 1}`]?.v || "",
                    status: "Pending",
                    current: { driverName, cellPhone }
                });
            }

            if (!schedules.length) {
                showToast("No schedules found for tomorrow!", "info");
                return;
            }

            if (await sendSchedulesToBackend(schedules)) {
                await fetchSchedules();
                showToast("Tomorrow’s schedules saved successfully!", "success");
            }
        };

        reader.readAsArrayBuffer(file);
    });

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
        const dateISO = f.get("date");

        const newCurrent = {
            driverName: f.get("driverName"),
            cellPhone: f.get("cellPhone")
        };

        const existingSchedule = editingTransactionID
            ? allSchedules.find(s => s.transactionID === editingTransactionID)
            : null;

        let oldHistory = existingSchedule?.old || {};

        if (existingSchedule?.current) {
            const oldCurrent = existingSchedule.current;

            const driverChanged =
                oldCurrent.driverName !== newCurrent.driverName ||
                oldCurrent.cellPhone !== newCurrent.cellPhone;

            if (driverChanged) {
                const nextIndex = Object.keys(oldHistory).length;
                oldHistory[nextIndex] = {
                    driverName: oldCurrent.driverName,
                    cellPhone: oldCurrent.cellPhone
                };
            }
        }

        const data = {
            date: dateISO,
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
            status: "Pending",
            current: newCurrent,
            old: Object.keys(oldHistory).length ? oldHistory : undefined
        };

        const method = editingTransactionID ? "PUT" : "POST";

        if (await sendSchedulesToBackend(data, method, editingTransactionID)) {
            dateFilter.value = dateISO;
            await fetchSchedules(dateISO);
            modal.style.display = "none";
            resetManualForm();
            showToast(editingTransactionID ? "Schedule updated!" : "Schedule added!", "success");
        }
    };

    // ---------------- Initial Load ----------------
    fetchSchedules();
});
