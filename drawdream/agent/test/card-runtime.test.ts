import assert from "node:assert/strict";
import test from "node:test";
import { buildTavernRuntimeManifest, mapCardPlaceholder } from "../src/card-runtime.ts";
import { normalizeCard } from "../src/card.ts";

test("Runtime Manifest exposes entrypoints, UI modules, CSP and mobile capabilities", () => {
	const card = normalizeCard({
		name: "runtime",
		first_mes: "<StatusPlaceHolderImpl/>",
		extensions: { html: "panel.html", css: "panel.css", script: "https://example.test/panel.js" },
	});
	const manifest = buildTavernRuntimeManifest(card);
	assert.deepEqual(manifest.entrypoints, { html: ["panel.html"], css: ["panel.css"], javascript: ["https://example.test/panel.js"] });
	assert.deepEqual(manifest.uiModules, [{ name: "StatusPlaceHolderImpl", placeholder: "StatusPlaceHolderImpl", surface: "state-panel" }]);
	assert.deepEqual(manifest.mobile, { supported: true, safeArea: true, responsiveHeight: true, touchEvents: true });
	assert.ok(manifest.csp.scriptSrc.includes("'self'"));
});

test("Runtime Manifest rejects insecure external module URLs", () => {
	const card = normalizeCard({ name: "runtime", first_mes: "hi", extensions: { script: "http://example.test/panel.js" } });
	const manifest = buildTavernRuntimeManifest(card);
	assert.deepEqual(manifest.externalModules, []);
	assert.ok(manifest.diagnostics.some((item) => item.code === "external-module-insecure"));
});

test("placeholder mapping routes status UI to the state panel", () => {
	assert.deepEqual(mapCardPlaceholder("StatusPlaceHolderImpl"), { name: "StatusPlaceHolderImpl", surface: "state-panel" });
	assert.deepEqual(mapCardPlaceholder("CustomPanel"), { name: "CustomPanel", surface: "card-ui" });
});
