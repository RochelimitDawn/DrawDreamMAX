import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadTtsConfig, saveAudioBuffer, ttsConfigHint } from "../src/tts.ts";

test("loadTtsConfig: no key returns null", () => {
	assert.equal(loadTtsConfig({}), null);
	assert.ok(ttsConfigHint().includes("DRAWDREAM_TTS"));
});

test("loadTtsConfig: OPENAI_API_KEY works", () => {
	const c = loadTtsConfig({ OPENAI_API_KEY: "sk-test" });
	assert.ok(c);
	assert.equal(c!.apiKey, "sk-test");
	assert.ok(c!.baseUrl.includes("openai.com") || c!.baseUrl.endsWith("/v1"));
});

test("saveAudioBuffer: writes under .drawdream-audio and returns /audio/ path", () => {
	const dir = mkdtempSync(join(tmpdir(), "dd-tts-"));
	try {
		const out = saveAudioBuffer(dir, Buffer.from("fake-audio"), "mp3");
		assert.equal(typeof out.fileName, "string");
		assert.match(out.src, /^\/audio\/.+\.mp3$/);
		assert.equal(out.bytes, 10);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
