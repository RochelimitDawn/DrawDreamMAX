import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHybridPromptSections } from "../src/hybrid-coordinator.ts";
import { HeadlessExtensionHost } from "../src/extension-host.ts";

test("Hybrid Coordinator orders agent, tools, search and citations", () => {
	const sections = buildHybridPromptSections({ agent: "agent", toolResults: "tools", searchResults: "search", sources: ["https://a", " https://b "] });
	assert.deepEqual(sections.map((section) => section.id), ["drawdream-agent", "drawdream-tools", "drawdream-search", "source-citations"]);
	assert.match(sections.at(-1)?.text ?? "", /\[2\] https:\/\/b/);
});

test("Headless Extension Host enforces capabilities and unloads", async () => {
	const host = new HeadlessExtensionHost();
	let unloaded = false;
	await assert.rejects(() => host.register({ id: "unsafe", capabilities: ["variables.write"] }, ["context.read"]), /denied/);
	await host.register({ id: "safe", capabilities: ["context.read"], onUnload: () => { unloaded = true; } }, ["context.read"]);
	assert.equal(host.list()[0]?.id, "safe");
	assert.equal(await host.unregister("safe"), true);
	assert.equal(unloaded, true);
});
