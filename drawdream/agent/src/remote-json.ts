/**
 * 远程 JSON 拉取（预设链接导入等）。
 * - 仅 http(s)
 * - 拒绝内网 / 元数据地址（SSRF 防护）
 * - 规范化 GitHub / GitLab 仓库页与 blob 链到 raw 内容
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const BLOCKED_HOSTS = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata",
	"kubernetes.default",
	"kubernetes.default.svc",
]);

function isPrivateOrSpecialIp(ip: string): boolean {
	const v = ip.toLowerCase();
	if (v === "::1" || v === "0.0.0.0") return true;
	if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
	// IPv4-mapped IPv6 :ffff:a.b.c.d
	const mapped = v.match(/^:ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	const ipv4 = mapped ? mapped[1] : v.includes(":") ? null : v;
	if (!ipv4) return v === "::" || v.startsWith("::ffff:127.");
	const parts = ipv4.split(".").map((x) => Number(x));
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
	const [a, b] = parts;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	if (a >= 224) return true; // multicast / reserved
	return false;
}

/** 将常见「仓库浏览页」转成可直接下载的 raw URL */
export function normalizeRemoteJsonUrl(input: string): string {
	const raw = input.trim();
	if (!raw) throw new Error("链接为空");
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new Error("链接格式无效");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new Error("仅支持 http(s) 链接");
	}

	const host = u.hostname.toLowerCase();

	// github.com/owner/repo/blob/ref/path → raw.githubusercontent.com/owner/repo/ref/path
	if (host === "github.com" || host === "www.github.com") {
		const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
		if (m) {
			const [, owner, repo, ref, path] = m;
			return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
		}
	}

	// gist.github.com/user/id 或 gist.github.com/id → gist raw（保留原链，fetch 时 Accept 优先 json）
	// gitlab.com/group/proj/-/blob/ref/path → -/raw/ref/path
	if (host === "gitlab.com" || host.endsWith(".gitlab.com") || host.includes("gitlab")) {
		if (u.pathname.includes("/-/blob/")) {
			u.pathname = u.pathname.replace("/-/blob/", "/-/raw/");
			return u.toString();
		}
		// gitlab.com/group/proj/blob/ref/path（旧式）
		const m = u.pathname.match(/^\/(.+)\/blob\/([^/]+)\/(.+)$/);
		if (m && !u.pathname.includes("/-/")) {
			const [, project, ref, path] = m;
			u.pathname = `/${project}/-/raw/${ref}/${path}`;
			return u.toString();
		}
	}

	return u.toString();
}

export async function assertUrlSafeForFetch(urlStr: string): Promise<URL> {
	const u = new URL(urlStr);
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new Error("仅支持 http(s) 链接");
	}
	if (u.username || u.password) throw new Error("链接不能包含用户名或密码");
	const host = u.hostname.toLowerCase();
	if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
		throw new Error("不允许访问该主机");
	}
	if (host === "0.0.0.0" || host === "[::1]") throw new Error("不允许访问该主机");

	const ipVersion = isIP(host);
	if (ipVersion) {
		if (isPrivateOrSpecialIp(host)) throw new Error("不允许访问内网或特殊地址");
		return u;
	}

	let records: { address: string; family: number }[];
	try {
		records = await lookup(host, { all: true, verbatim: true });
	} catch {
		throw new Error(`无法解析主机：${host}`);
	}
	if (!records.length) throw new Error(`无法解析主机：${host}`);
	for (const r of records) {
		if (isPrivateOrSpecialIp(r.address)) {
			throw new Error("不允许访问解析到内网的主机");
		}
	}
	return u;
}

function guessNameFromUrl(urlStr: string): string {
	try {
		const u = new URL(urlStr);
		const base = u.pathname.split("/").filter(Boolean).pop() || "imported-preset";
		return decodeURIComponent(base).replace(/\.json$/i, "") || "imported-preset";
	} catch {
		return "imported-preset";
	}
}

export interface FetchRemoteJsonResult {
	json: Record<string, unknown>;
	/** 最终请求的 URL（规范化 / 重定向后） */
	finalUrl: string;
	/** 从路径猜测的名称 */
	suggestedName: string;
	bytes: number;
}

/**
 * 拉取远程 JSON 对象。自动规范化 GitHub/GitLab blob 链接。
 */
export async function fetchRemoteJsonObject(inputUrl: string): Promise<FetchRemoteJsonResult> {
	let current = normalizeRemoteJsonUrl(inputUrl);
	let redirected = 0;

	while (redirected <= MAX_REDIRECTS) {
		const safe = await assertUrlSafeForFetch(current);
		const res = await fetch(safe.toString(), {
			method: "GET",
			redirect: "manual",
			headers: {
				Accept: "application/json, text/plain, */*",
				"User-Agent": "DrawDreamMAX-PresetImport/1.0",
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get("location");
			if (!loc) throw new Error(`远程重定向缺少 Location（HTTP ${res.status}）`);
			const next = new URL(loc, current).toString();
			await assertUrlSafeForFetch(next);
			current = next;
			redirected += 1;
			continue;
		}

		if (!res.ok) {
			const hint = (await res.text().catch(() => "")).slice(0, 160);
			throw new Error(
				`拉取失败 HTTP ${res.status}${hint ? `：${hint.replace(/\s+/g, " ")}` : ""}`,
			);
		}

		const len = Number(res.headers.get("content-length") || 0);
		if (len > MAX_BYTES) throw new Error(`文件过大（>${MAX_BYTES} 字节）`);

		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length > MAX_BYTES) throw new Error(`文件过大（>${MAX_BYTES} 字节）`);
		const text = buf.toString("utf8").replace(/^\uFEFF/, "").trim();
		if (!text) throw new Error("远程内容为空");

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error("远程内容不是合法 JSON（请使用 raw / 直链，而非仓库首页）");
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("远程 JSON 须为对象（预设根节点）");
		}

		return {
			json: parsed as Record<string, unknown>,
			finalUrl: current,
			suggestedName: guessNameFromUrl(current),
			bytes: buf.length,
		};
	}

	throw new Error("重定向次数过多");
}
