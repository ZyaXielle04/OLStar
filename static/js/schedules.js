document.addEventListener("DOMContentLoaded", () => {

    // ---------------- DOM Elements ----------------
    const bookingsContainer = document.getElementById("bookingsContainer");
    const fileInput = document.getElementById("fileInput");
    const modal = document.getElementById("manualModal");
    const addManualBtn = document.getElementById("addManualBtn");
    const closeModalBtn = document.getElementById("closeModal");
    const manualForm = document.getElementById("manualForm");
    const dateFilter = document.getElementById("dateFilter");

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

    function isoToDisplayDate(isoDate) {
        if (!isoDate) return "";
        const d = new Date(isoDate);
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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

    async function fetchSchedules(selectedISO = null) {
        try {
            const res = await fetch("/api/schedules");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            allSchedules = data.schedules || [];

            const filterISO = selectedISO || dateFilter.value || new Date().toISOString().split("T")[0];
            dateFilter.value = filterISO; // ensure filter shows correct date
            const filtered = allSchedules.filter(s => s.date === filterISO);
            renderSchedules(filtered);
        } catch (err) {
            console.error("Failed to fetch schedules:", err);
            showToast("Failed to load schedules.", "error");
        }
    }

    if (dateFilter) {
        dateFilter.value = new Date().toISOString().split("T")[0];
        dateFilter.addEventListener("change", () => {
            const selectedISO = dateFilter.value;
            const filtered = allSchedules.filter(s => s.date === selectedISO);
            renderSchedules(filtered);
        });
    }

    // ---------------- Render Schedule Cards ----------------
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
                <span class="status ${statusClass}">${statusLabel}</span>
                <div class="event-date">${isoToDisplayDate(data.date)}</div>
            </div>

            <div class="event-info">
                <strong>${data.clientName || ""} | ${data.contactNumber || ""}</strong>
                (${data.driverName || ""} | ${data.cellPhone || ""})<br>
                ${data.pickup || ""} → ${data.dropOff || ""}

                <div class="event-actions">
                    <button class="btn-view-more">View More</button>
                    <button class="btn-edit">Edit</button>
                    <button class="btn-delete">Delete</button>
                </div>
            </div>

            <div class="event-details" style="display:none;">
                <p>Pax: ${data.pax || ""} | Flight: ${data.flightNumber || ""}</p>
                <p>Amount: ${data.amount || ""} | Driver Rate: ${data.driverRate || ""}</p>
                <p>Unit Type: ${data.unitType || ""} | Company: ${data.company || ""}</p>
                <p>Booking Type: ${data.bookingType || ""}</p>
                <p>Transport Unit: ${data.transportUnit || ""} | Color: ${data.color || ""} | Plate: ${data.plateNumber || ""}</p>
                <p>Luggage: ${data.luggage || ""}</p>
                <p>Note: ${data.note || ""}</p>
            </div>
        `;

        const btnView = event.querySelector(".btn-view-more");
        const details = event.querySelector(".event-details");
        btnView.addEventListener("click", () => {
            const isHidden = details.style.display === "none";
            details.style.display = isHidden ? "block" : "none";
            btnView.textContent = isHidden ? "View Less" : "View More";
        });

        // Edit schedule
        const btnEdit = event.querySelector(".btn-edit");
        btnEdit.addEventListener("click", () => {
            modal.style.display = "block";
            editingTransactionID = data.transactionID;
            for (let [key, value] of Object.entries(data)) {
                const input = manualForm.querySelector(`[name="${key}"]`);
                if (input) input.value = value;
            }
        });

        // Delete schedule
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

        const reader = new FileReader();
        reader.onload = async ev => {
            const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
            const sheetName = "BOOKING";
            if (!workbook.SheetNames.includes(sheetName)) {
                showToast("Sheet BOOKING not found", "error");
                return;
            }

            const sheet = workbook.Sheets[sheetName];
            const tomorrowISO = new Date();
            tomorrowISO.setDate(tomorrowISO.getDate() + 1);
            const tomorrowStr = tomorrowISO.toISOString().split("T")[0];
            const range = XLSX.utils.decode_range(sheet["!ref"]);
            const schedules = [];

            for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const dateValue = sheet[`A${row + 1}`]?.v;
                const dateISO = excelToISODate(dateValue);
                if (dateISO !== tomorrowStr) continue;

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
                    driverName: cleanDriverName(sheet[`J${row + 1}`]?.v || ""),
                    unitType: sheet[`K${row + 1}`]?.v || "",
                    amount: sheet[`L${row + 1}`]?.v || "",
                    driverRate: sheet[`M${row + 1}`]?.v || "",
                    company: sheet[`N${row + 1}`]?.v || "",
                    bookingType: sheet[`O${row + 1}`]?.v || "",
                    cellPhone: (() => {
                        const raw = sheet[`P${row + 1}`]?.v || "";
                        const digits = raw.replace(/\D/g, "");
                        const match = digits.match(/09\d{9}/);
                        return match ? match[0] : "";
                    })(),
                    transportUnit: sheet[`Q${row + 1}`]?.v || "",
                    color: sheet[`R${row + 1}`]?.v || "",
                    plateNumber: sheet[`S${row + 1}`]?.v || "",
                    luggage: sheet[`T${row + 1}`]?.v || "",
                    status: "Pending"
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

    // ---------------- Manual Add / Edit ----------------
    addManualBtn.onclick = () => modal.style.display = "block";
    closeModalBtn.onclick = () => modal.style.display = "none";
    window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

    manualForm.onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(manualForm);
        const dateISO = f.get("date");

        const data = {
            clientName: f.get("clientName"),
            contactNumber: f.get("contactNumber"),
            driverName: f.get("driverName"),
            pickup: f.get("pickup"),
            dropOff: f.get("dropOff"),
            date: dateISO,
            time: f.get("time"),
            pax: f.get("pax"),
            flightNumber: f.get("flightNumber"),
            note: f.get("note"),
            unitType: f.get("unitType"),
            amount: f.get("amount"),
            driverRate: f.get("driverRate"),
            company: f.get("company"),
            bookingType: f.get("bookingType"),
            cellPhone: f.get("cellPhone"),
            transportUnit: f.get("transportUnit"),
            color: f.get("color"),
            plateNumber: f.get("plateNumber"),
            luggage: f.get("luggage"),
            status: "Pending"
        };

        const method = editingTransactionID ? "PUT" : "POST";

        if (await sendSchedulesToBackend(data, method, editingTransactionID)) {
            // Update the filter to new date if editing
            const filterDate = dateISO;
            dateFilter.value = filterDate;

            await fetchSchedules(filterDate);
            modal.style.display = "none";
            manualForm.reset();
            showToast(editingTransactionID ? "Schedule updated!" : "Schedule added!", "success");
            editingTransactionID = null;
        }
    };

    // ---------------- Initial Load ----------------
    fetchSchedules();
});
