/**
 * ST 式回复变体（swipe）与再生成。
 * 依赖会话树只读面 + navigate/branch/continue，由 user-host 注入。
 */

import {
	lastStoryUserEntryId,
	listReplyVariants,
	swipeMetaForUser,
	type SwipeEntry,
} from "../src/swipe.ts";
import { isBackstageText, type WireMsg } from "./wire.ts";
import type { ServerFrame } from "./wire.ts";

export type SwipeSession = {
	sessionManager: {
		getEntries: () => unknown[];
		getBranch: () => unknown[];
		getLeafId: () => string | null | undefined;
		getEntry: (id: string) => unknown;
		branch: (userId: string) => void;
		buildSessionContext: () => { messages: unknown[] };
	};
	agent: {
		state: { messages: unknown[] };
		continue: () => Promise<void>;
	};
	navigateTree: (
		targetId: string,
		options?: { summarize?: boolean },
	) => Promise<{ cancelled: boolean }>;
};

export type SwipeDeps = {
	getSession: () => SwipeSession;
	broadcast: (frame: ServerFrame) => void;
	resyncAll: () => void;
};

export type SessionSwipe = {
	swipeEntriesFromSession: () => SwipeEntry[];
	lastStoryUserId: () => string | null;
	annotateSwipes: (messages: WireMsg[]) => WireMsg[];
	regenerateSwipe: () => Promise<void>;
	handleSwipe: (dir: "prev" | "next" | "new") => Promise<void>;
};

const extractEntryText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
};

export function createSessionSwipe(deps: SwipeDeps): SessionSwipe {
	const swipeEntriesFromSession = (): SwipeEntry[] => {
		const raw = deps.getSession().sessionManager.getEntries() as Array<Record<string, unknown>>;
		return raw.map((e) => {
			const id = String(e.id);
			const parentId = (e.parentId as string | null) ?? null;
			const type = String(e.type);
			const timestamp = typeof e.timestamp === "string" ? e.timestamp : undefined;
			if (type === "message" && e.message && typeof e.message === "object") {
				const m = e.message as { role?: unknown; customType?: unknown };
				return {
					id,
					parentId,
					type: "message",
					role: typeof m.role === "string" ? m.role : undefined,
					customType: typeof m.customType === "string" ? m.customType : undefined,
					timestamp,
				};
			}
			return {
				id,
				parentId,
				type,
				customType: typeof e.customType === "string" ? e.customType : undefined,
				timestamp,
			};
		});
	};

	const lastStoryUserId = (): string | null => {
		const branch = deps.getSession().sessionManager.getBranch() as Array<Record<string, unknown>>;
		const lite = branch.map((e) => {
			const type = String(e.type);
			if (type === "message" && e.message && typeof e.message === "object") {
				const m = e.message as { role?: unknown; content?: unknown };
				return {
					id: String(e.id),
					type: "message",
					role: typeof m.role === "string" ? m.role : undefined,
					text: extractEntryText(m.content),
				};
			}
			return { id: String(e.id), type };
		});
		return lastStoryUserEntryId(lite, isBackstageText);
	};

	const annotateSwipes = (messages: WireMsg[]): WireMsg[] => {
		const session = deps.getSession();
		const userId = lastStoryUserId();
		if (!userId) return messages;
		const leafId = session.sessionManager.getLeafId();
		const meta = swipeMetaForUser(swipeEntriesFromSession(), userId, leafId);
		let lastNar = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].channel === "narrative") {
				lastNar = i;
				break;
			}
		}
		if (lastNar < 0) return messages;
		const total = Math.max(1, meta?.total ?? 1);
		const index = meta && meta.total > 0 ? meta.index : 0;
		return messages.map((m, i) => (i === lastNar ? { ...m, swipe: { index, total } } : m));
	};

	/**
	 * ST 式再生成：叶指针落在「最后一条剧情 user」上，再 agent.continue()。
	 * 新 assistant 作为该 user 的 sibling 子树；旧变体保留在旁支。
	 * 用 branch(userId) 固定挂在同一 user 下；不写 /store → 不产生世界线分叉。
	 */
	const regenerateSwipe = async (): Promise<void> => {
		const session = deps.getSession();
		const userId = lastStoryUserId();
		if (!userId) {
			deps.broadcast({
				type: "notify",
				level: "error",
				text: "没有可重新生成的剧情轮（需要先有一条用户输入）",
			});
			return;
		}
		const sm = session.sessionManager;
		const oldLeafId = sm.getLeafId();
		if (oldLeafId && oldLeafId !== userId) {
			const entry = sm.getEntry(oldLeafId) as { parentId?: string | null } | undefined;
			const r = await session.navigateTree(oldLeafId, { summarize: false });
			if (r.cancelled) return;
			void entry;
		}
		if (sm.getLeafId() !== userId) {
			sm.branch(userId);
			const ctx = sm.buildSessionContext();
			session.agent.state.messages = ctx.messages;
		}
		deps.resyncAll();
		try {
			await session.agent.continue();
		} catch (err) {
			deps.broadcast({
				type: "notify",
				level: "error",
				text: err instanceof Error ? err.message : String(err),
			});
		}
	};

	/**
	 * ST 式变体切换 / 再生成。
	 * - prev：上一条 sibling（到头则提示）
	 * - next：下一条；已在末条则再生成
	 * - new：强制再生成
	 */
	const handleSwipe = async (dir: "prev" | "next" | "new"): Promise<void> => {
		if (dir === "new") {
			await regenerateSwipe();
			return;
		}
		const session = deps.getSession();
		const userId = lastStoryUserId();
		if (!userId) {
			deps.broadcast({ type: "notify", level: "error", text: "没有可切换的回复变体" });
			return;
		}
		const entries = swipeEntriesFromSession();
		const leafId = session.sessionManager.getLeafId();
		const variants = listReplyVariants(entries, userId, leafId);
		if (variants.length === 0) {
			if (dir === "next") await regenerateSwipe();
			else deps.broadcast({ type: "notify", level: "info", text: "还没有角色回复可切换" });
			return;
		}
		const meta = swipeMetaForUser(entries, userId, leafId);
		const idx = meta?.index ?? 0;
		if (dir === "prev") {
			if (idx <= 0) {
				deps.broadcast({ type: "notify", level: "info", text: "已经是第一条变体" });
				return;
			}
			const target = variants[idx - 1].leafId;
			const result = await session.navigateTree(target, { summarize: false });
			if (!result.cancelled) deps.resyncAll();
			return;
		}
		if (idx >= variants.length - 1) {
			await regenerateSwipe();
			return;
		}
		const target = variants[idx + 1].leafId;
		const result = await session.navigateTree(target, { summarize: false });
		if (!result.cancelled) deps.resyncAll();
	};

	return {
		swipeEntriesFromSession,
		lastStoryUserId,
		annotateSwipes,
		regenerateSwipe,
		handleSwipe,
	};
}
