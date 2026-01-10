document.addEventListener("DOMContentLoaded", () => {

    // ---------------- DOM Elements ----------------
    const bookingsContainer = document.getElementById("bookingsContainer");
    const fileInput = document.getElementById("fileInput");
    const modal = document.getElementById("manualModal");
    const addManualBtn = document.getElementById("addManualBtn");
    const closeModalBtn = document.getElementById("closeModal");
    const manualForm = document.getElementById("manualForm");

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

    function excelToDisplayDate(value) {
        if (!value) return null;
        let d;
        if (typeof value === "number") {
            const p = XLSX.SSF.parse_date_code(value);
            d = new Date(p.y, p.m - 1, p.d);
        } else {
            d = new Date(value);
            if (isNaN(d)) return null;
        }
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }

    function getTodayDisplayDate() {
        const d = new Date();
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }

    function getTomorrowDisplayDate() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }

    // ---------------- TIME PARSER (AM/PM SAFE) ----------------
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

    // ---------------- SORT SCHEDULES ----------------
    function sortSchedulesByDateTime(schedules) {
        return schedules.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
            return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
        });
    }

    // ---------------- Render as Google Calendar Style ----------------
    function createCalendarEvent(data) {
        const event = document.createElement("div");
        event.classList.add("calendar-event");
        event.innerHTML = `
            <div class="event-time">${data.time || ""}</div>
            <div class="event-info">
                <strong>${data.clientName || ""}</strong>
                <span class="driver-name">(${data.driverName || ""})</span><br>
                Pickup: ${data.pickup || ""} → Dropoff: ${data.dropOff || ""}<br>
                Pax: ${data.pax || ""} | Flight: ${data.flightNumber || ""}<br>
                Amount: ${data.amount || ""} | Driver Rate: ${data.driverRate || ""}<br>
                Note: ${data.note || ""}
            </div>
        `;
        return event;
    }

    function renderSchedules(schedules) {
        bookingsContainer.innerHTML = "";
        if (!schedules.length) {
            bookingsContainer.innerHTML = `<p style="text-align:center;color:#6b7280;font-style:italic;">No schedules for today.</p>`;
            return;
        }
        sortSchedulesByDateTime(schedules).forEach(s => bookingsContainer.appendChild(createCalendarEvent(s)));
    }

    // ---------------- CSRF ----------------
    function getCSRFToken() {
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        return match ? match[1] : "";
    }

    // ---------------- Backend Calls ----------------
    async function sendSchedulesToBackend(data) {
        try {
            const res = await fetch("/api/schedules", {
                method: "POST",
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

    async function fetchSchedules() {
        try {
            const res = await fetch("/api/schedules");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const today = getTodayDisplayDate();
            const todaysSchedules = (data.schedules || []).filter(s => s.date === today);
            renderSchedules(todaysSchedules);
        } catch (err) {
            console.error("Failed to fetch schedules:", err);
            showToast("Failed to load schedules.", "error");
        }
    }

    // ---------------- XLSX Upload ----------------
    fileInput.addEventListener("change", async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            const workbook = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
            const sheetName = "DECEMBER";
            if (!workbook.SheetNames.includes(sheetName)) {
                showToast("Sheet DECEMBER not found", "error");
                return;
            }
            const sheet = workbook.Sheets[sheetName];
            const tomorrowDisplay = getTomorrowDisplayDate();
            const range = XLSX.utils.decode_range(sheet["!ref"]);
            const schedules = [];

            for (let row = range.s.r + 1; row <= range.e.r; row++) {
                const dateValue = sheet[`A${row + 1}`]?.v;
                const dateDisplay = excelToDisplayDate(dateValue);
                if (dateDisplay !== tomorrowDisplay) continue;
                schedules.push({
                    transactionID: generateTransactionID(),
                    date: dateDisplay,
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
                    cellPhone: sheet[`P${row + 1}`]?.v || "",
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

    // ---------------- Manual Add ----------------
    addManualBtn.onclick = () => modal.style.display = "block";
    closeModalBtn.onclick = () => modal.style.display = "none";
    window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

    manualForm.onsubmit = async e => {
        e.preventDefault();
        const f = new FormData(manualForm);
        const data = [{
            transactionID: generateTransactionID(),
            clientName: f.get("clientName"),
            contactNumber: f.get("contactNumber"),
            driverName: f.get("driverName"),
            pickup: f.get("pickup"),
            dropOff: f.get("dropOff"),
            date: f.get("date"),
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
        }];
        if (await sendSchedulesToBackend(data)) {
            await fetchSchedules();
            modal.style.display = "none";
            manualForm.reset();
            showToast("Schedule added successfully!", "success");
        }
    };

    // ---------------- Initial Load ----------------
    fetchSchedules();
});
