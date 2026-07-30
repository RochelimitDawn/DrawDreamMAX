import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeRemoteJsonUrl } from "../src/remote-json.ts";

test("normalizeRemoteJsonUrl: GitHub blob → raw", () => {
	const u = normalizeRemoteJsonUrl(
		"https://github.com/owner/repo/blob/main/presets/foo.json",
	);
	assert.equal(u, "https://raw.githubusercontent.com/owner/repo/main/presets/foo.json");
});

test("normalizeRemoteJsonUrl: GitLab blob → raw", () => {
	const u = normalizeRemoteJsonUrl(
		"https://gitlab.com/novi028/demo/-/blob/main/assets/preset.json",
	);
	assert.equal(u, "https://gitlab.com/novi028/demo/-/raw/main/assets/preset.json");
});

test("normalizeRemoteJsonUrl: already raw stays", () => {
	const raw = "https://raw.githubusercontent.com/a/b/main/x.json";
	assert.equal(normalizeRemoteJsonUrl(raw), raw);
});

test("normalizeRemoteJsonUrl: rejects empty / bad scheme", () => {
	assert.throws(() => normalizeRemoteJsonUrl(""), /空/);
	assert.throws(() => normalizeRemoteJsonUrl("ftp://x/y.json"), /http/);
	assert.throws(() => normalizeRemoteJsonUrl("not a url"), /无效/);
});
