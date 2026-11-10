/* Prepare large inspection videos locally, before Cloudinary receives any bytes. */
window.prepareInspectionVideo = async function (file, report) {
    const limit = 95 * 1000 * 1000;
    if (file.size <= limit) return file;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const mime = typeof MediaRecorder !== "undefined" && [
        'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'
    ].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime || !HTMLCanvasElement.prototype.captureStream || !AudioContextClass) {
        throw new Error("Automatic video compression requires a current Chrome, Edge, or Safari browser. Open this page there and select the video again.");
    }
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.style.cssText = "position:fixed;bottom:0;right:0;width:2px;height:2px;pointer-events:none";
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    const url = URL.createObjectURL(file);
    let audio, stream, recorder, timer, wakeLock;
    const mediaError = () => new Error("This browser cannot decode the selected video. Export it as an H.264 MP4 and try again.");
    try {
        report("Preparing large video… Keep this tab visible. This can take as long as the video.");
        audio = new AudioContextClass();
        await audio.resume();
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(mediaError()), 30000);
            video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
            video.onerror = () => { clearTimeout(timeout); reject(mediaError()); };
            video.src = url;
        });
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw mediaError();
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
        canvas.width = Math.max(2, Math.floor(video.videoWidth * scale / 2) * 2);
        canvas.height = Math.max(2, Math.floor(video.videoHeight * scale / 2) * 2);
        const context = canvas.getContext("2d", { alpha: false });
        stream = canvas.captureStream(25);
        const destination = audio.createMediaStreamDestination();
        audio.createMediaElementSource(video).connect(destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) { /* Optional. */ }
        // Leave room for container overhead and encoders that exceed the requested bitrate.
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt) {
                await new Promise(resolve => { video.onseeked = resolve; video.currentTime = 0; });
            }
            const totalBitrate = Math.floor((attempt ? 45 : 75) * 1000 * 1000 * 8 / video.duration);
            const audioBitrate = Math.min(64000, Math.floor(totalBitrate * 0.15));
            recorder = new MediaRecorder(stream, {
                mimeType: mime, videoBitsPerSecond: Math.max(10000, totalBitrate - audioBitrate),
                audioBitsPerSecond: Math.max(6000, audioBitrate)
            });
            const chunks = [];
            let bytes = 0;
            const output = await new Promise((resolve, reject) => {
                let failure;
                const fail = error => {
                    failure = error;
                    video.pause();
                    if (recorder.state !== "inactive") recorder.stop();
                    else reject(error);
                };
                recorder.ondataavailable = event => {
                    if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
                    if (bytes > limit) fail(new Error("The compressed video is still too large."));
                };
                recorder.onerror = () => fail(new Error("Video compression failed. Close other apps and try again."));
                recorder.onstop = () => {
                    clearInterval(timer);
                    if (failure) reject(failure);
                    else resolve(new Blob(chunks, { type: mime.split(";")[0] }));
                };
                video.onerror = () => fail(mediaError());
                video.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
                let lastTime = video.currentTime, lastProgress = Date.now();
                const draw = () => {
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastProgress = Date.now(); }
                    if (Date.now() - lastProgress > 60000) fail(new Error("Video preparation paused. Keep this tab visible and try again."));
                    report(`Preparing video${attempt ? " (smaller copy)" : ""}… ${Math.min(99, Math.floor(video.currentTime / video.duration * 100))}%. Keep this tab visible.`);
                };
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                recorder.start(1000);
                timer = setInterval(draw, 40);
                video.play().catch(() => fail(new Error("The browser blocked video preparation. Select the video and submit again.")));
            }).catch(error => {
                if (attempt === 0 && bytes > limit) return null;
                throw error;
            });
            if (output && output.size > 0 && output.size <= limit) {
                const extension = mime.startsWith("video/mp4") ? "mp4" : "webm";
                report(`Video prepared (${(output.size / 1000000).toFixed(1)} MB). Starting upload…`);
                return new File([output], `inspection.${extension}`, { type: output.type });
            }
        }
        throw new Error("Unable to reduce this video enough. Export a smaller or shorter MP4 and try again.");
    } finally {
        clearInterval(timer);
        video.pause();
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stream?.getTracks().forEach(track => track.stop());
        if (audio) await audio.close().catch(() => {});
        await wakeLock?.release().catch(() => {});
        video.removeAttribute("src");
        video.load();
        video.remove();
        URL.revokeObjectURL(url);
    }
};
