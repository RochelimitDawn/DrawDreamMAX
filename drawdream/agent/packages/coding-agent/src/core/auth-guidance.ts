import { join } from "node:path";
import { getDocsPath } from "../config.ts";

const UNKNOWN_PROVIDER = "unknown";

export function getProviderLoginHelp(): string {
	return [
		"请到「设置 → API」配置渠道与 API Key，并选择可用模型。",
		"CLI 也可使用 /login 登录 OAuth。文档：",
		`  ${join(getDocsPath(), "providers.md")}`,
		`  ${join(getDocsPath(), "models.md")}`,
	].join("\n");
}

export function formatNoModelsAvailableMessage(): string {
	return `当前没有可用模型。${getProviderLoginHelp()}`;
}

export function formatNoModelSelectedMessage(): string {
	return `尚未选择模型。\n\n${getProviderLoginHelp()}`;
}

export function formatNoApiKeyFoundMessage(provider: string): string {
	const providerDisplay = provider === UNKNOWN_PROVIDER ? "当前模型" : provider;
	return `未找到 ${providerDisplay} 的 API Key。\n\n${getProviderLoginHelp()}`;
}
