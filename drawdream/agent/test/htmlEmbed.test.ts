import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeHtmlDocument, splitHtmlParts } from "../../src/utils/htmlEmbed.ts";

test("splitHtmlParts: plain text", () => {
	const p = splitHtmlParts("hello\n\nworld");
	assert.equal(p.length, 1);
	assert.equal(p[0]!.kind, "text");
});

test("splitHtmlParts: fenced html", () => {
	const p = splitHtmlParts('前\n```html\n<div class="phone">hi</div>\n```\n后');
	assert.equal(p.length, 3);
	assert.equal(p[0]!.kind, "text");
	assert.equal(p[1]!.kind, "html");
	if (p[1]!.kind === "html") {
		assert.ok(p[1].html.includes("phone"));
	}
	assert.equal(p[2]!.kind, "text");
});

test("splitHtmlParts: styled div block", () => {
	const html =
		'<div style="padding:8px;background:#111;color:#fff">HP 80/100<br/>MP 40</div>\n她抬起头。';
	const p = splitHtmlParts(html);
	assert.equal(p.length, 2);
	assert.equal(p[0]!.kind, "html");
	assert.equal(p[1]!.kind, "text");
	if (p[1]!.kind === "text") assert.ok(p[1].text.includes("抬起头"));
});

test("looksLikeHtmlDocument", () => {
	assert.equal(looksLikeHtmlDocument("<!DOCTYPE html><html></html>"), true);
	assert.equal(looksLikeHtmlDocument("not html"), false);
});
