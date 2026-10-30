document.addEventListener("DOMContentLoaded", () => {
    const inspectionApi = document.querySelector(".inspection-page").dataset.inspectionApi;
    const inspectorPortal = inspectionApi.startsWith("/api/inspector/");
    const approveButton = document.getElementById("approveInspection");
    const inspectorLocked = record => inspectorPortal && record?.approved === true;
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
    const adminForm = document.getElementById("adminPhotoForm");
    const adminMessage = document.getElementById("adminPhotoMessage");
    const openAdminForm = document.getElementById("openAdminPhotoForm");
    const saveAdminButton = document.getElementById("saveAdminPhotos");
    const closeDialogButton = document.getElementById("closeInspectionDialog");
    const previewUrls = new Map();
    let inspections = [];
    let controller;
    let loading = false;
    let loadFailed = false;
    let activeRecord = null;
    let uploading = false;
    const imageViewer = document.getElementById("inspectionImageViewer");
    const largeImage = document.getElementById("inspectionLargeImage");
    const imageStage = document.getElementById("inspectionImageStage");
    let imageZoom = 1;

    function resizeLargeImage() {
        if (!imageViewer.open || !largeImage.naturalWidth) return;
        const fit = Math.min((imageStage.clientWidth - 24) / largeImage.naturalWidth,
            (imageStage.clientHeight - 24) / largeImage.naturalHeight);
        largeImage.style.width = `${largeImage.naturalWidth * fit * imageZoom}px`;
        largeImage.style.height = `${largeImage.naturalHeight * fit * imageZoom}px`;
        document.getElementById("inspectionZoomLevel").textContent = `${Math.round(imageZoom * 100)}%`;
        document.getElementById("inspectionZoomOut").disabled = imageZoom <= 1;
        document.getElementById("inspectionZoomIn").disabled = imageZoom >= 4;
    }

    function openPicture(url, title) {
        imageZoom = 1;
        largeImage.hidden = true;
        largeImage.style.width = "";
        largeImage.style.height = "";
        largeImage.alt = title;
        document.getElementById("inspectionImageTitle").textContent = title;
        document.getElementById("inspectionImageError").hidden = true;
        document.getElementById("inspectionZoomLevel").textContent = "100%";
        imageViewer.showModal();
        largeImage.src = url;
        imageStage.scrollTo(0, 0);
    }

    largeImage.addEventListener("load", () => {
        largeImage.hidden = false;
        resizeLargeImage();
    });
    largeImage.addEventListener("error", () => {
        largeImage.hidden = true;
        document.getElementById("inspectionImageError").hidden = false;
    });
    document.getElementById("inspectionZoomIn").addEventListener("click", () => {
        imageZoom = Math.min(4, imageZoom + .5);
        resizeLargeImage();
    });
    document.getElementById("inspectionZoomOut").addEventListener("click", () => {
        imageZoom = Math.max(1, imageZoom - .5);
        resizeLargeImage();
    });
    document.getElementById("inspectionZoomReset").addEventListener("click", () => {
        imageZoom = 1;
        resizeLargeImage();
        imageStage.scrollTo(0, 0);
    });
    document.getElementById("closeInspectionImage").addEventListener("click", () => imageViewer.close());
    imageViewer.addEventListener("click", event => {
        const bounds = imageViewer.getBoundingClientRect();
        if (event.target === imageViewer && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) imageViewer.close();
    });
    imageViewer.addEventListener("close", () => {
        largeImage.removeAttribute("src");
        largeImage.hidden = true;
    });
    window.addEventListener("resize", resizeLargeImage);

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

    function photoCard(photo, side, slot, owner) {
        const figure = element("figure", "inspection-photo");
        const title = `${label(side)} · Photo ${slot === "photo2" ? "2" : "1"}`;
        const entry = photoEntries(photo)[0];
        if (entry) {
            const link = element("a");
            link.href = entry.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.setAttribute("aria-label", `Enlarge ${owner} — ${title}`);
            link.addEventListener("click", event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openPicture(entry.url, `${owner} — ${title}`);
            });
            const image = element("img");
            image.src = entry.url;
            image.alt = `${owner} — ${title}`;
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => {
                image.hidden = true;
                link.prepend(element("span", "inspection-photo-error", "Preview unavailable. Open original photo."));
            }, { once: true });
            link.append(image);
            figure.append(link);
        } else {
            figure.append(element("div", "inspection-photo-placeholder", `No ${owner.toLowerCase()} picture submitted`));
        }
        const caption = element("figcaption", "inspection-photo-caption", title);
        if (photo?.capturedAt !== undefined) caption.append(element("span", "", `Captured ${dateTime(photo.capturedAt)}`));
        if (photo?.uploadedAt !== undefined) caption.append(element("span", "", `Uploaded ${dateTime(photo.uploadedAt)}`));
        if (photo?.uploadedByName) caption.append(element("span", "", `By ${text(photo.uploadedByName)}`));
        figure.append(caption);
        return figure;
    }

    function renderComparison(record) {
        const gallery = document.getElementById("inspectionPhotos");
        gallery.replaceChildren();
        const pairs = Array.isArray(record.photoPairs) ? record.photoPairs : [];
        ["front", "back", "left", "right"].forEach(side => {
            const section = element("section", "inspection-comparison-side");
            section.append(element("h4", "", label(side)));
            const labels = element("div", "inspection-comparison-labels");
            labels.append(element("span", "", "Driver pictures"), element("span", "", "Admin pictures"));
            section.append(labels);
            ["photo1", "photo2"].forEach(slot => {
                const pair = pairs.find(item => item.side === side && item.slot === slot);
                const row = element("div", "inspection-photo-pair");
                row.append(photoCard(pair?.driverPhoto, side, slot, "Driver"), photoCard(pair?.adminPhoto, side, slot, "Admin"));
                section.append(row);
            });
            gallery.append(section);
        });
        // Preserve the display of older submissions with photos outside side/slot groups.
        const pairedUrls = new Set(pairs.flatMap(pair => [pair.driverPhoto, pair.adminPhoto])
            .flatMap(photo => photoEntries(photo).map(entry => entry.url)));
        const extras = photoEntries(record.photos).filter(photo => !pairedUrls.has(photo.url));
        if (extras.length) {
            gallery.append(element("h4", "", "Additional driver pictures"));
            const extraGallery = element("div", "inspection-photos");
            extras.forEach(photo => extraGallery.append(photoCard({ url: photo.url }, photo.name, "photo1", "Driver")));
            gallery.append(extraGallery);
        }
    }

    function resetAdminForm() {
        adminForm.reset();
        adminForm.hidden = true;
        adminMessage.hidden = true;
        previewUrls.forEach(url => URL.revokeObjectURL(url));
        previewUrls.clear();
        adminForm.querySelectorAll(".inspection-upload-preview").forEach(image => {
            image.removeAttribute("src");
            image.hidden = true;
        });
    }

    function showUploadForm() {
        if (uploading || inspectorLocked(activeRecord)) return;
        adminForm.hidden = false;
        adminMessage.hidden = true;
        adminForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function showUploadMessage(message, error = false) {
        adminMessage.textContent = message;
        adminMessage.dataset.error = String(error);
        adminMessage.hidden = false;
        if (error) adminMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function showDetails(record, upload = false) {
        if (uploading) return;
        activeRecord = record;
        openAdminForm.disabled = inspectorLocked(record);
        const sealState = document.getElementById("inspectionSealState");
        sealState.hidden = record.approved !== true;
        sealState.textContent = `Approved by ${text(record.approvedByName)} · ${dateTime(record.approvedAt)}. Sealed for inspector uploads.`;
        if (approveButton) {
            approveButton.disabled = record.approved === true;
            approveButton.textContent = record.approved === true ? "Approved" : "Approve";
        }
        resetAdminForm();
        adminMessage.hidden = true;
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
            ["Trip ID", record.tripId], ["Source", record.source],
            ["Admin submitted at (PHT)", dateTime(record.adminSubmittedAt)],
            ["Admin submitted by", record.adminSubmittedByName], ["Admin user ID", record.adminSubmittedBy]
        ];
        fields.forEach(([name, value]) => {
            const item = element("div");
            item.append(element("dt", "", name), element("dd", "", text(value)));
            details.append(item);
        });
        renderComparison(record);
        document.getElementById("inspectionPhotoData").textContent = text({ driverPhotos: record.photos, adminPhotos: record.adminPhotos });
        document.getElementById("inspectionPhotoMetadata").open = false;
        if (!dialog.open) dialog.showModal();
        if (upload) showUploadForm();
    }

    async function submitAdminPictures(event) {
        event.preventDefault();
        if (uploading || !activeRecord || inspectorLocked(activeRecord)) return;
        const payload = new FormData();
        let count = 0;
        for (const input of adminForm.querySelectorAll('input[type="file"]')) {
            const file = input.files[0];
            if (!file) continue;
            if (!file.size || file.size > 10 * 1024 * 1024) {
                showUploadMessage("Each picture must be between 1 byte and 10 MB.", true);
                return;
            }
            payload.append(input.name, file);
            count += 1;
        }
        if (!count) {
            showUploadMessage("Choose at least one admin picture before submitting.", true);
            return;
        }
        const parts = String(activeRecord.id).split("/");
        if (parts.length !== 4) {
            showUploadMessage("This inspection could not be identified. Refresh the page.", true);
            return;
        }
        uploading = true;
        adminMessage.hidden = true;
        adminForm.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
        closeDialogButton.disabled = true;
        openAdminForm.disabled = true;
        saveAdminButton.textContent = "Uploading pictures…";
        try {
            const response = await fetch(`${inspectionApi}/${parts.map(encodeURIComponent).join("/")}/admin-photos`, {
                method: "POST", body: payload,
                headers: { Accept: "application/json", "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content }
            });
            if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
                throw new Error("Your session may have expired. Please sign in again.");
            }
            const data = await response.json();
            if (data.code === "INSPECTION_SEALED") {
                activeRecord.approved = true;
                resetAdminForm();
                openAdminForm.disabled = true;
                render();
            }
            if (!response.ok) throw new Error(data.error || "Unable to save admin pictures.");
            if (!data.inspection || data.inspection.id !== activeRecord.id) throw new Error("Refresh the inspection to confirm the uploaded pictures.");
            Object.assign(activeRecord, data.inspection);
            uploading = false;
            render();
            showDetails(activeRecord);
            showUploadMessage("Admin pictures saved. Driver and admin pictures are ready to compare below.");
            document.querySelector(".inspection-comparison-heading").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
            showUploadMessage(error.message || "Unable to save admin pictures. Please try again.", true);
        } finally {
            uploading = false;
            adminForm.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
            closeDialogButton.disabled = false;
            openAdminForm.disabled = inspectorLocked(activeRecord);
            saveAdminButton.textContent = "Submit Admin Pictures";
        }
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
            if (record.approved === true) status.append(element("span", "inspection-secondary", "Approved · Sealed"));
            const submitted = element("td", "", dateTime(record.submittedAt));
            const photos = element("td");
            photos.append(element("span", "inspection-primary", `Driver: ${photoEntries(record.photos).length}`),
                element("span", "inspection-secondary", `Admin: ${photoEntries(record.adminPhotos).length}`));
            const action = element("td");
            const button = element("button", "inspection-view", "View details");
            button.type = "button";
            button.setAttribute("aria-label", `View inspection for ${text(record.plateNumber)}, ${record.period}, ${text(record.driverName)}`);
            button.addEventListener("click", () => showDetails(record));
            const actions = element("div", "inspection-row-actions");
            const uploadButton = element("button", "inspection-view", "Submit Admin Pictures");
            uploadButton.type = "button";
            uploadButton.disabled = inspectorLocked(record);
            uploadButton.addEventListener("click", () => showDetails(record, true));
            actions.append(button, uploadButton);
            if (approveButton) {
                const approve = element("button", "inspection-view", record.approved ? "Approved" : "Approve");
                approve.type = "button";
                approve.disabled = record.approved === true;
                approve.addEventListener("click", () => approveCase(record));
                actions.append(approve);
            }
            action.append(actions);
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
            const response = await fetch(`${inspectionApi}?${new URLSearchParams({ date: dateInput.value })}`, {
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
    closeDialogButton.addEventListener("click", () => { if (!uploading) dialog.close(); });
    openAdminForm.addEventListener("click", showUploadForm);
    async function approveCase(record) {
        if (uploading || record.approved) return;
        uploading = true;
        // Keep popups inside an open native dialog so they remain interactive.
        const popupOptions = () => ({ target: dialog.open ? dialog : document.body, heightAuto: false, confirmButtonColor: "#2f4156" });
        try {
            const confirmation = await Swal.fire({
                ...popupOptions(), icon: "question", title: "Approve inspection?",
                text: `Approve ${text(record.plateNumber)} for ${text(record.driverName)}? Inspectors will no longer be able to add or replace pictures for this case.`,
                showCancelButton: true, confirmButtonText: "Approve and seal", cancelButtonText: "Cancel",
                cancelButtonColor: "#64748b", focusCancel: true, reverseButtons: true
            });
            if (!confirmation.isConfirmed) return;
            const response = await fetch(`/api/admin/vehicle-inspections/${record.id.split("/").map(encodeURIComponent).join("/")}/approve`, {
                method: "POST", headers: { Accept: "application/json", "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content }
            });
            if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Please sign in again.");
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to approve inspection.");
            Object.assign(record, data.inspection);
            uploading = false;
            render();
            showDetails(record);
            await Swal.fire({ ...popupOptions(), icon: "success", title: "Inspection approved", text: "This case is now sealed for inspector photo submissions.", confirmButtonText: "Done" });
        } catch (error) {
            await Swal.fire({ ...popupOptions(), icon: "error", title: "Approval failed", text: error.message || "Unable to approve inspection.", confirmButtonText: "OK" });
        } finally {
            uploading = false;
        }
    }
    approveButton?.addEventListener("click", () => { if (activeRecord) approveCase(activeRecord); });
    document.getElementById("cancelAdminPhotos").addEventListener("click", resetAdminForm);
    adminForm.addEventListener("submit", submitAdminPictures);
    adminForm.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener("change", () => {
            adminMessage.hidden = true;
            if (previewUrls.has(input.name)) URL.revokeObjectURL(previewUrls.get(input.name));
            previewUrls.delete(input.name);
            const image = document.getElementById(input.dataset.preview);
            image.hidden = true;
            image.removeAttribute("src");
            const file = input.files[0];
            if (file && file.size <= 10 * 1024 * 1024) {
                const url = URL.createObjectURL(file);
                previewUrls.set(input.name, url);
                image.src = url;
                image.hidden = false;
            }
        });
    });
    dialog.addEventListener("close", resetAdminForm);
    dialog.addEventListener("cancel", event => { if (uploading || Swal.isVisible()) event.preventDefault(); });
    dialog.addEventListener("click", event => {
        const bounds = dialog.getBoundingClientRect();
        if (!uploading && event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    loadInspections();
});
