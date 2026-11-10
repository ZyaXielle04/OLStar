const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = readFileSync(join(__dirname, "../static/js/inspection_video.js"), "utf8");

function setup({ unsupported = false, playbackFails = false } = {}) {
    const cleaned = [];
    const track = { stop: () => cleaned.push("track") };
    const stream = { getTracks: () => [track], addTrack() {} };
    const video = {
        duration: 60, videoWidth: 1920, videoHeight: 1080, currentTime: 0, style: {},
        setAttribute() {}, removeAttribute() {}, load() {}, pause() {},
        set src(value) { queueMicrotask(() => this.onloadeddata()); },
        play() {
            if (playbackFails) return Promise.reject(new Error("blocked"));
            queueMicrotask(() => this.onended());
            return Promise.resolve();
        },
        remove() { cleaned.push("video"); }
    };
    const canvas = { captureStream: () => stream, getContext: () => ({ drawImage() {} }) };
    class Recorder {
        static isTypeSupported() { return !unsupported; }
        constructor(_stream, options) { this.options = options; this.state = "inactive"; }
        start() { this.state = "recording"; }
        stop() {
            this.state = "inactive";
            this.ondataavailable({ data: new Blob(["encoded video"]) });
            this.onstop();
        }
    }
    class Audio {
        async resume() {}
        createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track] } }; }
        createMediaElementSource() { return { connect() {} }; }
        async close() { cleaned.push("audio"); }
    }
    const context = vm.createContext({
        window: { AudioContext: Audio }, MediaRecorder: Recorder,
        HTMLCanvasElement: { prototype: canvas },
        document: { body: { append() {} }, createElement: type => type === "video" ? video : canvas },
        URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => cleaned.push("url") },
        navigator: {}, Blob, File, Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval
    });
    vm.runInContext(source, context);
    return { prepare: context.window.prepareInspectionVideo, cleaned };
}

test("small files are returned unchanged without requiring browser compression support", async () => {
    const { prepare } = setup({ unsupported: true });
    const file = new File(["original"], "small.mp4");
    assert.equal(await prepare(file, () => {}), file);
});

test("large files are encoded to an uploadable video and resources are released", async () => {
    const { prepare, cleaned } = setup();
    const messages = [];
    const output = await prepare({ size: 150000000 }, message => messages.push(message));
    assert.equal(output.type, "video/webm");
    assert.ok(output.size > 0 && output.size < 95000000);
    assert.ok(messages.some(message => message.includes("Starting upload")));
    assert.deepEqual(cleaned.sort(), ["audio", "track", "url", "video"]);
});

test("unsupported encoders fail before loading a large video", async () => {
    const { prepare, cleaned } = setup({ unsupported: true });
    await assert.rejects(prepare({ size: 150000000 }, () => {}), /current Chrome/);
    assert.deepEqual(cleaned, []);
});

test("blocked playback cannot yield a partial upload and still cleans up", async () => {
    const { prepare, cleaned } = setup({ playbackFails: true });
    await assert.rejects(prepare({ size: 150000000 }, () => {}), /blocked video preparation/);
    assert.deepEqual(cleaned.sort(), ["audio", "track", "url", "video"]);
});
