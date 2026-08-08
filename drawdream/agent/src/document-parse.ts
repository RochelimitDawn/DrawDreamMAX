/**
 * 文档解析 — MinerU
 * https://mineru.net/apiManage/docs
 *
 * 两种模式：
 * - 精准解析 API（需 Token）：POST /api/v4/file-urls/batch → PUT 上传 → 轮询
 *   /api/v4/extract-results/batch/{batch_id} → 下载 zip → 提取 full.md
 * - Agent 轻量解析 API（免 Token）：POST /api/v1/agent/parse/file → PUT 上传 →
 *   轮询 /api/v1/agent/parse/{task_id} → 下载 markdown_url
 *
 * 配置：drawdream.config.json → documentParse（enabled/apiKey/modelVersion/maxChars）
 * 解析结果：落 .drawdream-uploads/<原文件名>.md，供注入与按需读取。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { uploadsDir } from "./uploads.ts";
import { UPLOAD_PREFIX } from "./paths.ts";

export type DocumentParseConfig = {
	enabled?: boolean;
	apiKey?: string;
	modelVersion?: string;
	maxChars?: number;
};

const LIGHT_BASE = "https://mineru.net/api/v1/agent";
const PRECISE_BASE = "https://mineru.net/api/v4";

/** 可解析的文档扩展名（不含图片，图片走 read 工具即可） */
const PARSEABLE_EXT = new Set([
	".pdf",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".xls",
	".xlsx",
	".html",
]);

/** 是否是需要结构化解析的文档（非纯文本/图片） */
export function isParseableDocument(name: string): boolean {
	const ext = extname(name).toLowerCase();
	return PARSEABLE_EXT.has(ext);
}

export function defaultMaxChars(): number {
	return 8000;
}

export type ParseResult =
	| { ok: true; markdown: string; mode: "light" | "precise"; file: string }
	| { ok: false; error: string };

async function jsonOrThrow(res: Response): Promise<Record<string, unknown>> {
	let data: unknown;
	try {
		data = await res.json();
	} catch {
		data = undefined;
	}
	if (!res.ok) {
		const msg =
			data && typeof data === "object" && typeof (data as Record<string, unknown>).msg === "string"
				? String((data as Record<string, unknown>).msg)
				: `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return (data as Record<string, unknown>) ?? {};
}

function traceMsg(body: Record<string, unknown>): string {
	const msg = typeof body.msg === "string" && body.msg ? body.msg : "";
	const trace = typeof body.trace_id === "string" ? ` (${body.trace_id})` : "";
	return msg + trace;
}

/** 拉取远程 markdown（轻量 API 结果） */
async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!res.ok) throw new Error(`下载解析结果失败 HTTP ${res.status}`);
	return res.text();
}

/**
 * 从 MinerU zip 包中提取 full.md。
 * zip 为经典 PKZIP 格式：用中央目录定位 <book>.md（full.md），
 * 对 STORE/UTF-8/entry 做 deflate 解压（node:zlib 无需第三方库）。
 */
export function extractMarkdownFromZip(zipBuf: Buffer): string {
	const dv = new DataView(zipBuf.buffer, zipBuf.byteOffset, zipBuf.byteLength);
	// EOCD：签名(4)+盘号(2+2)+本盘目录数(2)+目录总数(2)+目录大小(4)+目录偏移(4)+注释长(2)
	// 从文件尾往前扫签名（zip 可带尾注释），无注释时 EOCD 固定 22 字节。
	let eocd = -1;
	for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) throw new Error("zip 缺少 EOCD");
	const fileCount = dv.getUint16(eocd + 10, true);
	const cdOffset = dv.getUint32(eocd + 16, true);
	if (fileCount === 0) throw new Error("zip 无条目");
	let offset = cdOffset;
	const fileOffsets: Array<{ name: string; local: number; compSize: number; method: number }> = [];
	for (let i = 0; i < fileCount; i++) {
		const sig = dv.getUint32(offset, true);
		if (sig !== 0x02014b50) throw new Error(`zip 中央目录签名错误 @${offset}`);
		const method = dv.getUint16(offset + 10, true);
		const compSize = dv.getUint32(offset + 20, true);
		const nameLen = dv.getUint16(offset + 28, true);
		const extraLen = dv.getUint16(offset + 30, true);
		const commentLen = dv.getUint16(offset + 32, true);
		const localOffset = dv.getUint32(offset + 42, true);
		const name = zipBuf.toString("utf8", offset + 46, offset + 46 + nameLen);
		fileOffsets.push({ name, local: localOffset, compSize, method });
		offset += 46 + nameLen + extraLen + commentLen;
	}
	const md = fileOffsets.find((f) => f.name.endsWith(".md") && f.name !== "full.json") ??
		fileOffsets.find((f) => f.name.endsWith(".md"));
	if (!md) throw new Error("zip 中未找到 Markdown 结果");
	// 本地文件头：签名(4)+版本(2)+标志(2)+方法(2)+时间(2)+日期(2)+CRC(4)+压缩大小(4)+大小(4)+名长(2)+扩展长(2)
	const lh = md.local;
	const dataStart = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
	const comp = zipBuf.subarray(dataStart, dataStart + md.compSize);
	if (md.method === 0) return comp.toString("utf8");
	if (md.method === 8) return inflateRawSync(comp).toString("utf8");
	throw new Error(`不支持的 zip 压缩方法 ${md.method}`);
}

/** 轻量 API：提交文件上传解析 → 轮询 → 下载 markdown */
async function parseLight(cwd: string, relPath: string, absPath: string): Promise<ParseResult> {
	const name = basename(absPath);
	const res = await fetch(`${LIGHT_BASE}/parse/file`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ file_name: name }),
		signal: AbortSignal.timeout(30_000),
	});
	const body = await jsonOrThrow(res);
	if (body.code !== 0) {
		return { ok: false, error: `轻量解析提交失败：${traceMsg(body)}` };
	}
	const data = body.data as { task_id?: string; file_url?: string };
	if (!data?.task_id || !data.file_url) return { ok: false, error: "轻量解析未返回上传地址" };
	// 上传原始字节（不设 Content-Type，按文档要求）
	const up = await fetch(data.file_url, {
		method: "PUT",
		body: readFileSync(absPath),
		signal: AbortSignal.timeout(120_000),
	});
	if (!up.ok && up.status !== 201) {
		return { ok: false, error: `文件上传失败 HTTP ${up.status}` };
	}
	// 轮询结果
	const deadline = Date.now() + 180_000;
	for (;;) {
		if (Date.now() > deadline) return { ok: false, error: "轻量解析超时" };
		await new Promise((r) => setTimeout(r, 3000));
		const q = await fetch(`${LIGHT_BASE}/parse/${data.task_id}`, {
			signal: AbortSignal.timeout(20_000),
		});
		const qb = await jsonOrThrow(q);
		if (qb.code !== 0) return { ok: false, error: `轻量解析查询失败：${traceMsg(qb)}` };
		const qd = qb.data as { state?: string; markdown_url?: string; err_msg?: string };
		if (qd.state === "done" && qd.markdown_url) {
			const markdown = await fetchText(qd.markdown_url);
			return saveParsed(cwd, relPath, markdown, "light");
		}
		if (qd.state === "failed") return { ok: false, error: `轻量解析失败：${qd.err_msg ?? "未知原因"}` };
	}
}

/** 精准 API：批量申请上传 URL → PUT → 轮询 → 下载 zip → 提取 markdown */
async function parsePrecise(cwd: string, relPath: string, absPath: string, cfg: DocumentParseConfig): Promise<ParseResult> {
	const token = cfg.apiKey?.trim() ?? "";
	const name = basename(absPath);
	const auth = { Authorization: `Bearer ${token}` };
	const modelVersion = cfg.modelVersion?.trim() || "vlm";
	const res = await fetch(`${PRECISE_BASE}/file-urls/batch`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...auth },
		body: JSON.stringify({ files: [{ name, data_id: name }], model_version: modelVersion }),
		signal: AbortSignal.timeout(30_000),
	});
	const body = await jsonOrThrow(res);
	if (body.code !== 0) return { ok: false, error: `精准解析提交失败：${traceMsg(body)}` };
	const data = body.data as { batch_id?: string; file_urls?: string[] };
	if (!data?.batch_id || !data.file_urls?.length) return { ok: false, error: "精准解析未返回上传地址" };
	const up = await fetch(data.file_urls[0], {
		method: "PUT",
		body: readFileSync(absPath),
		signal: AbortSignal.timeout(180_000),
	});
	if (!up.ok && up.status !== 201) {
		return { ok: false, error: `文件上传失败 HTTP ${up.status}` };
	}
	const deadline = Date.now() + 300_000;
	for (;;) {
		if (Date.now() > deadline) return { ok: false, error: "精准解析超时" };
		await new Promise((r) => setTimeout(r, 4000));
		const q = await fetch(`${PRECISE_BASE}/extract-results/batch/${data.batch_id}`, {
			headers: auth,
			signal: AbortSignal.timeout(20_000),
		});
		const qb = await jsonOrThrow(q);
		if (qb.code !== 0) return { ok: false, error: `精准解析查询失败：${traceMsg(qb)}` };
		const list = (qb.data as { extract_result?: unknown[] }).extract_result ?? [];
		const item = list.find((x) => (x as { file_name?: string }).file_name === name) as
			| { state?: string; full_zip_url?: string; err_msg?: string }
			| undefined;
		if (!item) continue;
		if (item.state === "done" && item.full_zip_url) {
			const zipRes = await fetch(item.full_zip_url, { signal: AbortSignal.timeout(120_000) });
			if (!zipRes.ok) return { ok: false, error: `下载解析结果失败 HTTP ${zipRes.status}` };
			const zipBuf = Buffer.from(await zipRes.arrayBuffer());
			const markdown = extractMarkdownFromZip(zipBuf);
			return saveParsed(cwd, relPath, markdown, "precise");
		}
		if (item.state === "failed") return { ok: false, error: `精准解析失败：${item.err_msg ?? "未知原因"}` };
	}
}

/** 解析结果落盘：.drawdream-uploads/<原名>.md，返回相对路径 */
function saveParsed(cwd: string, relPath: string, markdown: string, mode: "light" | "precise"): ParseResult {
	const mdName = `${basename(relPath)}.md`;
	const dir = uploadsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const mdPath = join(dir, mdName);
	writeFileSync(mdPath, markdown, "utf8");
	return { ok: true, markdown, mode, file: `${UPLOAD_PREFIX}${mdName}` };
}

/**
 * 解析单个上传的文档；配置未开启或非文档类型返回 null（不做）。
 * 有 apiKey 走精准，否则走轻量。
 */
export async function parseUploadedDocument(
	cwd: string,
	relPath: string,
	absPath: string,
	cfg: DocumentParseConfig | undefined,
): Promise<ParseResult | null> {
	if (!cfg?.enabled) return null;
	if (!isParseableDocument(relPath)) return null;
	const apiKey = cfg.apiKey?.trim();
	return apiKey ? parsePrecise(cwd, relPath, absPath, cfg) : parseLight(cwd, relPath, absPath);
}

/** 取已解析的 markdown 文件路径（若无则 null）。返回相对 cwd 路径。 */
export function parsedMarkdownFor(relPath: string): string | null {
	if (!isParseableDocument(relPath)) return null;
	return `${UPLOAD_PREFIX}${basename(relPath)}.md`;
}

/** 截断到注入上限（maxChars 默认 8000），尾部标注全文位置 */
export function truncateForInjection(markdown: string, maxChars?: number): string {
	const limit = maxChars && maxChars > 0 ? maxChars : defaultMaxChars();
	if (markdown.length <= limit) return markdown;
	return `${markdown.slice(0, limit)}\n\n…（已截断，全文已存 .drawdream-uploads/，可用 read 读取）`;
}
