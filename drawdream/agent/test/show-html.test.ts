import assert from "node:assert/strict";
import test from "node:test";
import { toWireMsg } from "../server/wire.ts";
import { looksLikeHtmlDocument, splitHtmlParts } from "../../src/utils/htmlEmbed.ts";

const names = { charName: "角色", userName: "用户" };

test("show_html toolResult -> html channel", () => {
	const w = toWireMsg(
		{
			role: "toolResult",
			toolName: "show_html",
			content: [{ type: "text", text: "ok" }],
			details: {
				rpHtml: {
					html: '<div class="phone">hi</div>',
					title: "微信",
					scripts: true,
				},
			},
		},
		names,
	);
	assert.ok(w);
	assert.equal(w!.channel, "html");
	assert.equal(w!.html, '<div class="phone">hi</div>');
	assert.equal(w!.text, "微信");
	assert.equal(w!.scripts, true);
});

test("show_html error / empty skip", () => {
	assert.equal(
		toWireMsg(
			{ role: "toolResult", toolName: "show_html", isError: true, details: { rpHtml: { html: "x" } } },
			names,
		),
		null,
	);
	assert.equal(
		toWireMsg({ role: "toolResult", toolName: "show_html", details: { rpHtml: { html: "  " } } }, names),
		null,
	);
});

test("fenced html splits", () => {
	const parts = splitHtmlParts("旁白\n```html\n<div>短信</div>\n```\n继续");
	assert.equal(parts.filter((p) => p.kind === "html").length, 1);
	const h = parts.find((p) => p.kind === "html");
	assert.ok(h && h.kind === "html" && h.html.includes("短信"));
});

test("scripts fence", () => {
	const parts = splitHtmlParts("```html scripts\n<button id=b>x</button>\n```");
	assert.equal(parts[0].kind, "html");
	if (parts[0].kind === "html") assert.equal(parts[0].scripts, true);
});

test("full document", () => {
	assert.equal(looksLikeHtmlDocument("<!DOCTYPE html><html></html>"), true);
	const parts = splitHtmlParts("<!DOCTYPE html><html><body>开场</body></html>");
	assert.equal(parts.length, 1);
	assert.equal(parts[0].kind, "html");
});

test("show_html details shape (wire contract)", () => {
	// 与 roleplay show_html 工具返回的 details 对齐
	const details = {
		rpHtml: {
			html: '<button onclick="DrawDream.send(\'ok\')">选</button>',
			title: "表单",
			scripts: true,
		},
	};
	const w = toWireMsg(
		{
			role: "toolResult",
			toolName: "show_html",
			content: [{ type: "text", text: "已嵌入界面：表单" }],
			details,
		},
		names,
	);
	assert.ok(w);
	assert.equal(w!.channel, "html");
	assert.equal(w!.scripts, true);
	assert.ok(w!.html?.includes("DrawDream.send"));
});
