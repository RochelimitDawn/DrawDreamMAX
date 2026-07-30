/**
 * Context Compiler：剧情 system prompt 与每轮末端注入的统一入口。
 * 实现仍在 director.ts；本模块提供命名与 memo 钩子，便于 roleplay 与后续扩展。
 */

export {
	buildGreeting,
	buildSystemPrompt,
	buildTurnInjection,
	countVisibleNarrativeChars,
	detectsLanguageMismatch,
	looksLikeOpeningMenu,
	narrativeLengthBounds,
	needsOpeningChoice,
	parseOpeningOptions,
	userSeeksDirection,
	userSeeksLongForm,
	userSeeksShortBeat,
	userSeeksWebSearch,
	type DirectorOptions,
	type TurnInjectionOptions,
} from "./director.ts";

/** 稳定 system 段会话级缓存（roleplay 也可自管字符串；此 helper 供测试/外部复用） */
export type SystemPromptCache = {
	key: string;
	value: string;
};

export function systemPromptCacheKey(parts: {
	cardPath?: string;
	cardName: string;
	userName: string;
	presetId?: string;
	skillsSig?: string;
	mcpSig?: string;
	constantLoreSig?: string;
}): string {
	return [
		parts.cardPath ?? "",
		parts.cardName,
		parts.userName,
		parts.presetId ?? "",
		parts.skillsSig ?? "",
		parts.mcpSig ?? "",
		parts.constantLoreSig ?? "",
	].join("\u0001");
}

/**
 * 会话内索引 memo：输入签名不变则复用上次字符串（panel/codex/upload 等）。
 */
export function createStringMemo(): {
	get: (key: string, build: () => string) => string;
	clear: () => void;
} {
	const map = new Map<string, string>();
	return {
		get(key, build) {
			const hit = map.get(key);
			if (hit !== undefined) return hit;
			const v = build();
			map.set(key, v);
			return v;
		},
		clear() {
			map.clear();
		},
	};
}
