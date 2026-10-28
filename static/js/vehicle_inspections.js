document.addEventListener("DOMContentLoaded", () => {
    const dateInput = document.getElementById("inspectionDate");
    const periodFilter = document.getElementById("periodFilter");
    const statusFilter = document.getElementById("statusFilter");
    const searchInput = document.getElementById("inspectionSearch");
    const refreshButton = document.getElementById("refreshInspections");
    const rows = document.getElementById("inspectionRows");
    const tableWrap = document.getElementById("inspectionTableWrap");
    const state = document.getElementById("inspectionState");
    const errorBox = document.getElementById("inspectionError");
    const results = document.getElementById("inspectionResults");
    const dialog = document.getElementById("inspectionDialog");
    let inspections = [];
    let controller;
    let loading = false;
    let loadFailed = false;

    const dateFormatter = new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
    });

    function text(value) {
        if (value === null || value === undefined || value === "") return "Not provided";
        return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    }

    function label(value) {
        return text(value).replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
    }

    function timestamp(value) {
        if (value === null || value === undefined || value === "") return NaN;
        if (typeof value === "object") {
            const seconds = value.seconds ?? value._seconds;
            return Number.isFinite(Number(seconds)) ? Number(seconds) * 1000 : NaN;
        }
        if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
            const number = Number(value);
            return Math.abs(number) < 1e11 ? number * 1000 : number;
        }
        let date = String(value).trim();
        // Timestamp strings without an offset are interpreted in Philippine time.
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(date)) {
            date = date.replace(" ", "T") + "+08:00";
        }
        return Date.parse(date);
    }

    function dateTime(value) {
        const milliseconds = timestamp(value);
        return Number.isFinite(milliseconds) ? dateFormatter.format(milliseconds) : text(value);
    }

    function vehicleName(record) {
        const unit = record.transportUnit;
        return typeof unit === "object" && unit !== null
            ? text(unit.name || unit.transportUnit || unit.model || unit)
            : text(unit);
    }

    function photoEntries(photos) {
        const entries = [];
        const seen = new Set();

        function add(value, name = "", depth = 0) {
            if (!value || depth > 5) return;

            if (typeof value === "string") {
                try {
                    const url = new URL(value);

                    if (!["https:", "http:"].includes(url.protocol)) return;

                    if (!seen.has(url.href)) {
                        seen.add(url.href);
                        entries.push({
                            url: url.href,
                            name: label(name || "Photo")
                        });
                    }
                } catch {
                    // Ignore non-URL metadata
                }

            } else if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    add(item, `${name} Photo ${index + 1}`.trim(), depth + 1);
                });

            } else if (typeof value === "object") {
                const url =
                    value.url ||
                    value.downloadUrl ||
                    value.downloadURL ||
                    value.photoUrl ||
                    value.imageUrl ||
                    value.secure_url;

                if (typeof url === "string") {
                    add(url, name || value.label || value.name || "Photo", depth + 1);
                } else {
                    Object.entries(value).forEach(([key, item]) => {
                        const nextName = name && name !== "Photo"
                            ? `${name} ${key}`
                            : key;

                        add(item, nextName, depth + 1);
                    });
                }
            }
        }

        add(photos);

        return entries;
    }

    function element(tag, className, value) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    }

    function statusBadge(status) {
        const badge = element("span", "inspection-badge", label(status));
        const key = String(status || "").toLowerCase();
        if (["submitted", "completed", "complete", "passed", "approved", "on_time", "on-time"].includes(key)) badge.dataset.tone = "success";
        if (["pending", "late", "incomplete"].includes(key)) badge.dataset.tone = "warning";
        if (["failed", "rejected", "overdue", "missed"].includes(key)) badge.dataset.tone = "danger";
        return badge;
    }

    function showDetails(record) {
        document.getElementById("inspectionDetailTitle").textContent = text(record.plateNumber);
        const details = document.getElementById("inspectionDetails");
        details.replaceChildren();
        const fields = [
            ["Date", record.date], ["Period", record.period], ["Status", label(record.status)],
            ["Plate number", record.plateNumber], ["Transport unit", record.transportUnit],
            ["Vehicle key", record.vehicleKey], ["Driver name", record.driverName],
            ["Driver phone", record.driverPhone], ["Driver ID", record.driverId],
            ["Submitted at (PHT)", dateTime(record.submittedAt)],
            ["Window start (PHT)", dateTime(record.windowStart)],
            ["Window end (PHT)", dateTime(record.windowEnd)],
            ["Trip ID", record.tripId], ["Source", record.source]
        ];
        fields.forEach(([name, value]) => {
            const item = element("div");
            item.append(element("dt", "", name), element("dd", "", text(value)));
            details.append(item);
        });
        const gallery = document.getElementById("inspectionPhotos");
        gallery.replaceChildren();
        const photos = photoEntries(record.photos);
        if (!photos.length) gallery.append(element("p", "inspection-no-photos", "No viewable photos in this submission."));
        photos.forEach(photo => {
            const figure = element("figure", "inspection-photo");
            const link = element("a");
            link.href = photo.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            const image = element("img");
            image.src = photo.url;
            image.alt = photo.name;
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => {
                image.hidden = true;
                link.prepend(element("span", "inspection-photo-error", "Preview unavailable. Open original photo."));
            }, { once: true });
            link.append(image, element("figcaption", "", photo.name));
            figure.append(link);
            gallery.append(figure);
        });
        document.getElementById("inspectionPhotoData").textContent = text(record.photos);
        document.getElementById("inspectionPhotoMetadata").open = false;
        dialog.showModal();
    }

    function render() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = inspections.filter(record =>
            (!periodFilter.value || record.period === periodFilter.value) &&
            (!statusFilter.value || String(record.status || "") === statusFilter.value) &&
            (!query || [record.plateNumber, vehicleName(record), record.vehicleKey,
                record.driverName, record.driverPhone, record.driverId, record.tripId]
                .some(value => text(value).toLowerCase().includes(query)))
        );
        rows.replaceChildren();
        const summary = {
            submissionCount: filtered.length,
            vehicleCount: new Set(filtered.map(record => record.vehicleKey)).size,
            amCount: filtered.filter(record => record.period === "AM").length,
            pmCount: filtered.filter(record => record.period === "PM").length
        };
        Object.entries(summary).forEach(([id, count]) => {
            document.getElementById(id).textContent = loading || loadFailed ? "—" : count;
        });
        tableWrap.hidden = loading || loadFailed || !filtered.length;
        state.hidden = !loading && !loadFailed && filtered.length > 0;
        if (loading) {
            state.textContent = "Loading inspections…";
            results.textContent = "Loading submissions…";
            return;
        }
        if (loadFailed) {
            state.textContent = "Submissions could not be loaded. Use Refresh submissions to try again.";
            results.textContent = "Unable to load";
            return;
        }
        results.textContent = `${filtered.length} of ${inspections.length} submissions`;
        state.textContent = inspections.length
            ? "No submissions match these filters. Try another period, status, or search."
            : "No inspections were submitted for this date. Select another date to view previous submissions.";
        const fragment = document.createDocumentFragment();
        filtered.forEach(record => {
            const row = element("tr");
            const vehicle = element("td");
            vehicle.append(element("span", "inspection-primary", text(record.plateNumber)), element("span", "inspection-secondary", vehicleName(record)));
            const driver = element("td");
            driver.append(element("span", "inspection-primary", text(record.driverName)), element("span", "inspection-secondary", text(record.driverPhone)));
            const period = element("td");
            period.append(element("span", "inspection-badge", record.period));
            const status = element("td");
            status.append(statusBadge(record.status));
            const submitted = element("td", "", dateTime(record.submittedAt));
            const photos = element("td", "", String(photoEntries(record.photos).length));
            const action = element("td");
            const button = element("button", "inspection-view", "View details");
            button.type = "button";
            button.setAttribute("aria-label", `View inspection for ${text(record.plateNumber)}, ${record.period}, ${text(record.driverName)}`);
            button.addEventListener("click", () => showDetails(record));
            action.append(button);
            row.append(vehicle, driver, period, status, submitted, photos, action);
            fragment.append(row);
        });
        rows.append(fragment);
    }

    async function loadInspections() {
        if (!dateInput.value || !dateInput.checkValidity()) return;
        if (controller) controller.abort();
        const requestController = new AbortController();
        controller = requestController;
        loading = true;
        loadFailed = false;
        inspections = [];
        errorBox.hidden = true;
        refreshButton.disabled = true;
        render();
        try {
            const response = await fetch(`/api/admin/vehicle-inspections?${new URLSearchParams({ date: dateInput.value })}`, {
                signal: requestController.signal, headers: { Accept: "application/json" }, cache: "no-store"
            });
            if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
                throw new Error("Your session may have expired. Please sign in again.");
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to load inspections.");
            if (!Array.isArray(data.inspections)) throw new Error("The inspection response could not be read.");
            if (controller !== requestController) return;
            inspections = data.inspections.sort((a, b) => (timestamp(b.submittedAt) || 0) - (timestamp(a.submittedAt) || 0));
            const previousStatus = statusFilter.value;
            statusFilter.replaceChildren(new Option("All statuses", ""));
            [...new Set(inspections.map(record => String(record.status || "")).filter(Boolean))].sort()
                .forEach(status => statusFilter.add(new Option(label(status), status)));
            statusFilter.value = [...statusFilter.options].some(option => option.value === previousStatus) ? previousStatus : "";
        } catch (error) {
            if (error.name === "AbortError" || controller !== requestController) return;
            loadFailed = true;
            errorBox.textContent = error.message || "Unable to load inspections. Please try again.";
            errorBox.hidden = false;
        } finally {
            if (controller === requestController) {
                loading = false;
                refreshButton.disabled = false;
                render();
            }
        }
    }

    const todayParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const part = type => todayParts.find(item => item.type === type).value;
    dateInput.value = `${part("year")}-${part("month")}-${part("day")}`;
    dateInput.addEventListener("change", loadInspections);
    refreshButton.addEventListener("click", loadInspections);
    periodFilter.addEventListener("change", render);
    statusFilter.addEventListener("change", render);
    searchInput.addEventListener("input", render);
    document.getElementById("closeInspectionDialog").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    loadInspections();
});
