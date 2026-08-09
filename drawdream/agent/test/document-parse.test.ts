/**
 * document-parse 验证：
 * - isParseableDocument 判定
 * - extractMarkdownFromZip 从 MinerU zip 包提取 full.md（deflate 与 STORE）
 * - parsedMarkdownFor / truncateForInjection
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	extractMarkdownFromZip,
	isParseableDocument,
	parsedMarkdownFor,
	truncateForInjection,
} from "../src/document-parse.ts";

test("isParseableDocument 判定常见文档类型", () => {
	for (const n of ["a.pdf", "b.DOCX", "c.pptx", "d.xls", "e.html", "f.doc", "g.ppt"]) {
		assert.ok(isParseableDocument(n), `${n} 应判为可解析文档`);
	}
	for (const n of ["a.png", "b.jpg", "c.txt", "d.md", "e.json", "f.psd", "noext"]) {
		assert.ok(!isParseableDocument(n), `${n} 不应判为可解析文档`);
	}
});

test("extractMarkdownFromZip 从 deflate 压缩 zip 提取 full.md", () => {
	const dir = join(tmpdir(), `dd-docparse-zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	try {
		// 模拟 MinerU zip：full.md（deflate 压缩）
		const mdContent = "# 示例文档\n\n这是解析后的 Markdown 内容，用于验证 zip 提取逻辑。";
		const mdFile = join(dir, "example.md");
		writeFileSync(mdFile, mdContent, "utf8");
		execFileSync("zip", ["-q", join(dir, "out.zip"), "example.md"], { cwd: dir });
		const zipBuf = readFileSync(join(dir, "out.zip"));
		const extracted = extractMarkdownFromZip(zipBuf);
		assert.equal(extracted, mdContent);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("extractMarkdownFromZip 支持 STORE（未压缩）条目", () => {
	const dir = join(tmpdir(), `dd-docparse-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	try {
		const mdContent = "# STORE 测试\n\n短内容走 STORE。";
		const mdFile = join(dir, "example.md");
		writeFileSync(mdFile, mdContent, "utf8");
		execFileSync("zip", ["-q", "-0", join(dir, "out.zip"), "example.md"], { cwd: dir });
		const zipBuf = readFileSync(join(dir, "out.zip"));
		const extracted = extractMarkdownFromZip(zipBuf);
		assert.equal(extracted, mdContent);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("parsedMarkdownFor / truncateForInjection", () => {
	assert.equal(parsedMarkdownFor(".drawdream-uploads/2026-08-08-demo.pdf"), ".drawdream-uploads/2026-08-08-demo.pdf.md");
	assert.equal(parsedMarkdownFor(".drawdream-uploads/photo.png"), null);
	const md = "x".repeat(100);
	const short = truncateForInjection(md, 50);
	assert.ok(short.length < md.length);
	assert.ok(short.includes("已截断"));
	const kept = truncateForInjection(md, 200);
	assert.equal(kept, md);
});
