const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../static/js/vehicle_inspections.js"), "utf8");
const start = source.indexOf("    async function uploadInspectionVideo(");
const end = source.indexOf("    async function submitAdminPictures(", start);

function uploader(fetch, prepareInspectionVideo) {
    const messages = [];
    const context = vm.createContext({
        fetch, FormData, Uint8Array, setTimeout: callback => callback(),
        window: { prepareInspectionVideo },
        document: { querySelector: () => ({ content: "csrf-token" }) },
        showUploadMessage: message => messages.push(message)
    });
    vm.runInContext(source.slice(start, end), context);
    return { upload: context.uploadInspectionVideo, messages };
}

function video() {
    return new File([Uint8Array.from([0, 0, 0, 24]), "ftypisom", new Uint8Array(12)], "inspection.mp4", { type: "video/mp4" });
}

function response(data, status = 200) {
    return { ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => data };
}

test("large original is compressed before creating the upload session", async () => {
    const original = video();
    Object.defineProperty(original, "size", { value: 150000000 });
    const compressed = video();
    let prepared = false;
    const { upload } = uploader(async url => {
        assert.ok(prepared);
        return url.endsWith("/video-upload")
            ? response({ token: "first", chunkSize: 32 })
            : response({ done: true, videoToken: "completed" });
    }, async file => {
        assert.equal(file, original);
        prepared = true;
        return compressed;
    });
    assert.equal(await upload(original, "/inspection"), "completed");
});

test("video is split into chunks and completion token is returned", async () => {
    const chunks = [];
    const { upload, messages } = uploader(async (url, options) => {
        assert.equal(options.headers["X-CSRFToken"], "csrf-token");
        if (url.endsWith("/video-upload")) {
            assert.equal(JSON.parse(options.body).format, "MP4");
            return response({ token: "first", chunkSize: 16 });
        }
        chunks.push(options.body);
        if (chunks.length === 1) return response({ done: false, token: "second" });
        return response({ done: true, videoToken: "completed" });
    });
    assert.equal(await upload(video(), "/inspection"), "completed");
    assert.deepEqual(chunks.map(chunk => chunk.get("chunk").size), [16, 8]);
    assert.deepEqual(chunks.map(chunk => chunk.get("token")), ["first", "second"]);
    assert.ok(messages.some(message => message.includes("100%")));
});

test("transient chunk failure retries the same chunk and token", async () => {
    const attempts = [];
    const { upload } = uploader(async (url, options) => {
        if (url.endsWith("/video-upload")) return response({ token: "first", chunkSize: 32 });
        attempts.push(options.body);
        if (attempts.length === 1) return response({ error: "Temporary failure" }, 502);
        return response({ done: true, videoToken: "completed" });
    });
    assert.equal(await upload(video(), "/inspection"), "completed");
    assert.equal(attempts.length, 2);
    assert.deepEqual(await attempts[0].get("chunk").arrayBuffer(), await attempts[1].get("chunk").arrayBuffer());
    assert.equal(attempts[0].get("token"), attempts[1].get("token"));
});

test("permission failure stops upload without retrying", async () => {
    let attempts = 0;
    const { upload } = uploader(async url => {
        if (url.endsWith("/video-upload")) return response({ token: "first", chunkSize: 32 });
        attempts++;
        return response({ error: "This inspection is sealed." }, 409);
    });
    await assert.rejects(upload(video(), "/inspection"), /sealed/);
    assert.equal(attempts, 1);
});

test("incomplete final response cannot be saved", async () => {
    const { upload } = uploader(async url => url.endsWith("/video-upload")
        ? response({ token: "first", chunkSize: 32 })
        : response({ done: false, token: "unfinished" }));
    await assert.rejects(upload(video(), "/inspection"), /incomplete/);
});

test("invalid video fails before starting a network upload", async () => {
    const { upload } = uploader(() => { throw new Error("Unexpected network call"); });
    await assert.rejects(upload(new File(["not a video"], "fake.mp4"), "/inspection"), /MP4, MOV, or WebM/);
});


function submitter(adminForm) {
    const messages = [];
    const context = vm.createContext({
        uploading: false, activeRecord: { id: "inspection" }, inspectorLocked: () => false,
        adminForm, FormData, showUploadMessage: message => messages.push(message),
        fetch: () => { throw new Error("Incomplete submissions must not upload files"); }
    });
    const end = source.indexOf("    function render()", source.indexOf("    async function submitAdminPictures("));
    vm.runInContext(source.slice(source.indexOf("    async function submitAdminPictures("), end), context);
    return { submit: context.submitAdminPictures, messages };
}

test("native required-field validation blocks submission before uploading", async () => {
    let checked = false;
    const { submit } = submitter({ reportValidity: () => { checked = true; return false; } });
    await submit({ preventDefault() {} });
    assert.equal(checked, true);
});

test("missing file blocks submission even if native validation is bypassed", async () => {
    let focused = false;
    const { submit, messages } = submitter({
        reportValidity: () => true,
        querySelectorAll: () => [{ files: [], focus: () => { focused = true; } }]
    });
    await submit({ preventDefault() {} });
    assert.equal(focused, true);
    assert.match(messages[0], /All 14 pictures and the overall inspection video are required/);
});
