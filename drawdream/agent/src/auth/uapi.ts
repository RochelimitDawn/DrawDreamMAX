/**
 * UAPI 配置（uapis.cn）。
 * IP 归属由**浏览器端**调用 /network/myip，避免服务端出口 IP 不准。
 */

import { getMeta, setMeta } from "./db.ts";

export type UapiConfig = {
	enabled: boolean;
	/** 如 https://uapis.cn/api/v1 */
	baseUrl: string;
	apiKey: string;
	source: "standard" | "commercial";
};

const DEFAULT_BASE = "https://uapis.cn/api/v1";

export function getUapiConfig(): UapiConfig {
	const meta = (getMeta("uapi") as Partial<UapiConfig> | null) ?? {};
	const envKey = process.env.DD_UAPI_KEY?.trim() || "";
	const envBase = process.env.DD_UAPI_BASE?.trim() || "";
	const enabled =
		typeof meta.enabled === "boolean" ? meta.enabled : Boolean(meta.apiKey || envKey);
	return {
		enabled,
		baseUrl: (meta.baseUrl || envBase || DEFAULT_BASE).replace(/\/+$/, ""),
		apiKey: typeof meta.apiKey === "string" ? meta.apiKey : envKey,
		source: meta.source === "commercial" ? "commercial" : "standard",
	};
}

export function setUapiConfig(patch: Partial<UapiConfig> & { clearApiKey?: boolean }): UapiConfig {
	const cur = getUapiConfig();
	let apiKey = cur.apiKey;
	if (patch.clearApiKey) apiKey = "";
	else if (typeof patch.apiKey === "string" && patch.apiKey !== "********") apiKey = patch.apiKey;

	const next: UapiConfig = {
		enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
		baseUrl:
			typeof patch.baseUrl === "string" && patch.baseUrl.trim()
				? patch.baseUrl.trim().replace(/\/+$/, "")
				: cur.baseUrl,
		apiKey,
		source: patch.source === "commercial" || patch.source === "standard" ? patch.source : cur.source,
	};
	setMeta("uapi", next);
	return next;
}

/** 给前端：含一次性可用的 apiKey（仅已登录用户拉取，用于浏览器直连 UAPI） */
export function clientUapiBundle(): {
	enabled: boolean;
	baseUrl: string;
	source: "standard" | "commercial";
	hasApiKey: boolean;
	/** 浏览器调 myip 时使用；无 key 则走访客额度 */
	apiKey?: string;
	myipPath: string;
} {
	const c = getUapiConfig();
	const q = c.source === "commercial" ? "?source=commercial" : "";
	return {
		enabled: c.enabled,
		baseUrl: c.baseUrl,
		source: c.source,
		hasApiKey: Boolean(c.apiKey),
		apiKey: c.enabled && c.apiKey ? c.apiKey : undefined,
		myipPath: `/network/myip${q}`,
	};
}

export function adminPublicUapi(): {
	enabled: boolean;
	baseUrl: string;
	source: "standard" | "commercial";
	hasApiKey: boolean;
} {
	const c = getUapiConfig();
	return {
		enabled: c.enabled,
		baseUrl: c.baseUrl,
		source: c.source,
		hasApiKey: Boolean(c.apiKey),
	};
}
