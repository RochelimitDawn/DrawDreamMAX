/**
 * DrawDream REST：面板与资产 CRUD 走 /api/*；流式内容走 WS。
 * 实现拆分：
 * - rest/types.ts  宿主接口
 * - rest/http.ts   HTTP 工具
 * - rest/config.ts 配置/预设/世界书领域读写
 * - rest/routes.ts /api/* 调度
 * - rest/routes/{misc,codex,skills,mcp,sessions,cards,personas,presets,lore,agent,forge}.ts 域路由
 */

export type {
	AuthProviderInfo,
	CurrentModelInfo,
	ModelInfo,
	ProviderRuntimeSnapshot,
	RestHost,
	SessionInfoLite,
	SessionSearchHit,
} from "./rest/types.ts";

export {
	applyConfigPatch,
	configPath,
	loadConfig,
	loadDiskPreset,
	loadEffectivePreset,
	loadMergedLore,
	mergePresetPatches,
	presetOverridePath,
	writeJsonWithBackup,
	type LoreSource,
} from "./rest/config.ts";

export { handleApiRequest } from "./rest/routes.ts";
