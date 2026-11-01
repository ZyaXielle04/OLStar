document.addEventListener("DOMContentLoaded", () => {
    const inspectionApi = document.querySelector(".inspection-page").dataset.inspectionApi;
    const inspectorPortal = inspectionApi.startsWith("/api/inspector/");
    const inspectorLocked = record => inspectorPortal && record?.approved === true;
    const dateInput = document.getElementById("inspectionDate");
    const unitFilter = document.getElementById("unitFilter");
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
        const title = `${label(side)} · Photo ${slot.replace(/^photo/, "")}`;
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
        gallery.querySelectorAll("video").forEach(video => video.pause());
        gallery.replaceChildren();
        const pairs = Array.isArray(record.photoPairs) ? record.photoPairs : [];
        Object.entries({ front: 2, back: 2, right: 4, left: 4, inside: 2 }).forEach(([side, count]) => {
            const section = element("section", "inspection-comparison-side");
            section.append(element("h4", "", label(side)));
            const labels = element("div", "inspection-comparison-labels");
            labels.append(element("span", "", "Driver pictures"), element("span", "", "Admin pictures"));
            section.append(labels);
            Array.from({ length: count }, (_, index) => `photo${index + 1}`).forEach(slot => {
                const pair = pairs.find(item => item.side === side && item.slot === slot);
                const row = element("div", "inspection-photo-pair");
                row.append(photoCard(pair?.driverPhoto, side, slot, "Driver"), photoCard(pair?.adminPhoto, side, slot, "Admin"));
                section.append(row);
            });
            gallery.append(section);
        });
        const videoSection = element("section", "inspection-comparison-side inspection-video-section");
        videoSection.append(element("h4", "", "Overall inspection video"));
        const videoGrid = element("div", "inspection-video-grid");
        [["Driver video", record.video], ["Admin video", record.adminVideo]].forEach(([owner, media]) => {
            const card = element("div", "inspection-video-card");
            card.append(element("h5", "", owner));
            const videoEntry = photoEntries(media)[0];
            if (videoEntry) {
                const video = element("video");
                video.src = videoEntry.url;
                video.controls = true;
                video.playsInline = true;
                video.preload = "metadata";
                video.setAttribute("aria-label", owner);
                card.append(video);
                const original = element("a", "inspection-video-link", "Open original video");
                original.href = videoEntry.url;
                original.target = "_blank";
                original.rel = "noopener noreferrer";
                card.append(original);
                const timestampValue = media.capturedAt ?? media.uploadedAt;
                if (timestampValue) card.append(element("p", "inspection-secondary", `${media.capturedAt ? "Captured" : "Uploaded"} ${dateTime(timestampValue)}`));
            } else {
                card.append(element("p", "inspection-no-photos", `No ${owner.toLowerCase()} submitted`));
            }
            videoGrid.append(card);
        });
        videoSection.append(videoGrid);
        gallery.append(videoSection);
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

    function updateUploadSelection() {
        if (!adminForm) return;
        let selected = 0;
        let videos = 0;
        adminForm.querySelectorAll('input[type="file"]').forEach(input => {
            const hasPreview = !document.getElementById(input.dataset.preview).hidden;
            input.closest(".inspection-upload-slot").dataset.selected = String(hasPreview);
            if (input.files.length) {
                if (input.dataset.media === "video") videos++;
                else selected++;
            }
        });
        const count = document.getElementById("adminPhotoCount");
        count.textContent = `${selected} of 14 pictures · ${videos} of 1 video`;
        count.dataset.selected = String(selected + videos > 0);
    }

    function resetAdminForm() {
        if (!adminForm) return;
        adminForm.reset();
        adminForm.hidden = true;
        adminMessage.hidden = true;
        adminForm.querySelectorAll("video").forEach(video => video.pause());
        previewUrls.forEach(url => URL.revokeObjectURL(url));
        previewUrls.clear();
        adminForm.querySelectorAll(".inspection-upload-preview").forEach(image => {
            image.removeAttribute("src");
            if (image.tagName === "VIDEO") image.load();
            image.hidden = true;
        });
        updateUploadSelection();
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
        if (openAdminForm) openAdminForm.disabled = inspectorLocked(record);
        const sealState = document.getElementById("inspectionSealState");
        sealState.hidden = record.approved !== true;
        sealState.textContent = `Approved by ${text(record.approvedByName)} · ${dateTime(record.approvedAt)}. Sealed for inspector uploads.`;
        resetAdminForm();
        adminMessage.hidden = true;
        document.getElementById("inspectionDetailTitle").textContent = text(record.plateNumber);
        const details = document.getElementById("inspectionDetails");
        details.replaceChildren();
        const fields = [
            ["Unit name", vehicleName(record)],
            ["Driver name", record.driverName],
            ["Date and time (PHT)", dateTime(record.submittedAt)],
            ["Period", record.period]
        ];
        fields.forEach(([name, value]) => {
            const item = element("div");
            item.append(element("dt", "", name), element("dd", "", text(value)));
            details.append(item);
        });
        renderComparison(record);
        document.getElementById("inspectionPhotoData").textContent = text({ driverPhotos: record.photos, driverVideo: record.video, adminPhotos: record.adminPhotos, adminVideo: record.adminVideo });
        document.getElementById("inspectionPhotoMetadata").open = false;
        if (!dialog.open) dialog.showModal();
        if (upload) showUploadForm();
    }

    async function uploadInspectionVideo(file, recordUrl) {
        const header = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        const textAt = (start, end) => String.fromCharCode(...header.slice(start, end));
        let format;
        if (header.length >= 12 && textAt(4, 8) === "ftyp") {
            format = textAt(8, 12) === "qt  " ? "MOV" : "MP4";
        } else if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3 && textAt(0, header.length).includes("webm")) {
            format = "WEBM";
        } else {
            throw new Error("Use an MP4, MOV, or WebM inspection video.");
        }
        const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
        async function send(url, options) {
            const response = await fetch(url, options);
            if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Your session may have expired. Please sign in again.");
            const data = await response.json();
            if (!response.ok) {
                const error = new Error(data.error || "Unable to upload the inspection video.");
                error.status = response.status;
                throw error;
            }
            return data;
        }
        showUploadMessage("Uploading inspection video… 0%. Keep this page open.");
        const started = await send(`${recordUrl}/video-upload`, {
            method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRFToken": csrfToken },
            body: JSON.stringify({ size: file.size, format })
        });
        let token = started.token;
        const chunkSize = started.chunkSize;
        if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("Unable to start video upload. Refresh and try again.");
        for (let offset = 0; offset < file.size; offset += chunkSize) {
            const end = Math.min(offset + chunkSize, file.size);
            const chunk = file.slice(offset, end);
            let result;
            for (let attempt = 0; attempt < 3; attempt++) {
                const payload = new FormData();
                payload.append("token", token);
                payload.append("chunk", chunk, file.name);
                try {
                    result = await send(`${recordUrl}/video-upload/chunk`, {
                        method: "POST", headers: { Accept: "application/json", "X-CSRFToken": csrfToken }, body: payload
                    });
                    break;
                } catch (error) {
                    if (attempt === 2 || (error.status && error.status < 500)) throw error;
                    showUploadMessage(`Retrying video upload… ${Math.floor(offset / file.size * 100)}%. Keep this page open.`);
                    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
                }
            }
            showUploadMessage(`Uploading inspection video… ${Math.floor(end / file.size * 100)}%. Keep this page open.`);
            if (end === file.size) {
                if (!result.done || !result.videoToken) throw new Error("The video upload was incomplete. Please try again.");
                return result.videoToken;
            }
            if (result.done || !result.token) throw new Error("The video upload was interrupted. Please try again.");
            token = result.token;
        }
    }

    async function submitAdminPictures(event) {
        event.preventDefault();
        if (uploading || !activeRecord || inspectorLocked(activeRecord)) return;
        const payload = new FormData();
        if (!adminForm.reportValidity()) return;
        let videoFile;
        for (const input of adminForm.querySelectorAll('input[type="file"]')) {
            const file = input.files[0];
            if (!file) {
                showUploadMessage("All 14 pictures and the overall inspection video are required.", true);
                input.focus();
                return;
            }
            const isVideo = input.dataset.media === "video";
            const limit = isVideo ? 1024 * 1024 * 1024 : 10 * 1024 * 1024;
            if (!file.size || file.size > limit) {
                showUploadMessage(isVideo ? "The inspection video must be between 1 byte and 1 GB." : "Each picture must be between 1 byte and 10 MB.", true);
                return;
            }
            if (isVideo) videoFile = file;
            else payload.append(input.name, file);
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
        saveAdminButton.textContent = "Uploading files…";
        try {
            const recordUrl = `${inspectionApi}/${parts.map(encodeURIComponent).join("/")}`;
            if (videoFile) payload.append("overall_video_token", await uploadInspectionVideo(videoFile, recordUrl));
            showUploadMessage("Saving inspection files…");
            const response = await fetch(`${recordUrl}/admin-photos`, {
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
            showUploadMessage("Inspection files saved. View pictures and the overall inspection video below.");
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
        const filtered = inspections.filter(record =>
            (!unitFilter.value || record.vehicleKey === unitFilter.value)
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
                element("span", "inspection-secondary", `Admin: ${photoEntries(record.adminPhotos).length}`),
                element("span", "inspection-secondary", `Video: ${photoEntries(record.adminVideo).length ? 1 : 0}`));
            const action = element("td");
            const button = element("button", "inspection-view", "View details");
            button.type = "button";
            button.setAttribute("aria-label", `View inspection for ${text(record.plateNumber)}, ${record.period}, ${text(record.driverName)}`);
            button.addEventListener("click", () => showDetails(record));
            const actions = element("div", "inspection-row-actions");
            actions.append(button);
            if (inspectorPortal) {
                const uploadButton = element("button", "inspection-view", "Submit Admin Pictures");
                uploadButton.type = "button";
                uploadButton.disabled = inspectorLocked(record);
                uploadButton.addEventListener("click", () => showDetails(record, true));
                actions.append(uploadButton);
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
            const previousUnit = unitFilter.value;
            unitFilter.replaceChildren(new Option("All units", ""));
            const units = new Map(inspections.map(record => [record.vehicleKey, `${text(record.plateNumber)} · ${vehicleName(record)}`]));
            [...units.entries()].sort((a, b) => a[1].localeCompare(b[1]))
                .forEach(([key, name]) => unitFilter.add(new Option(name, key)));
            unitFilter.value = units.has(previousUnit) ? previousUnit : "";
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
    unitFilter.addEventListener("change", render);
    closeDialogButton.addEventListener("click", () => { if (!uploading) dialog.close(); });
    openAdminForm?.addEventListener("click", showUploadForm);
    document.getElementById("cancelAdminPhotos")?.addEventListener("click", resetAdminForm);
    adminForm?.addEventListener("submit", submitAdminPictures);
    adminForm?.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener("change", () => {
            adminMessage.hidden = true;
            const preview = document.getElementById(input.dataset.preview);
            if (preview.tagName === "VIDEO") preview.pause();
            if (previewUrls.has(input.name)) URL.revokeObjectURL(previewUrls.get(input.name));
            previewUrls.delete(input.name);
            const image = document.getElementById(input.dataset.preview);
            image.hidden = true;
            image.removeAttribute("src");
            if (image.tagName === "VIDEO") image.load();
            const file = input.files[0];
            const limit = input.dataset.media === "video" ? 1024 * 1024 * 1024 : 10 * 1024 * 1024;
            if (file && file.size > 0 && file.size <= limit) {
                const url = URL.createObjectURL(file);
                previewUrls.set(input.name, url);
                image.src = url;
                image.hidden = false;
            }
            updateUploadSelection();
        });
    });
    dialog.addEventListener("close", () => {
        resetAdminForm();
        document.querySelectorAll("#inspectionPhotos video").forEach(video => video.pause());
    });
    dialog.addEventListener("cancel", event => { if (uploading || Swal.isVisible()) event.preventDefault(); });
    dialog.addEventListener("click", event => {
        const bounds = dialog.getBoundingClientRect();
        if (!uploading && event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    loadInspections();
});
