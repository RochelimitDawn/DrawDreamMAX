/**
 * 剧情决策门禁：uiContext.select/input ↔ 前端选择卡。
 *
 * 扩展的 ask_director 调用 ctx.ui.select 停笔询问；本模块翻成 choice 帧广播，
 * 挂起等待应答。语义：
 *   - 应答（选项原文 / 自由输入）→ resolve 字符串，模型续写
 *   - 停止 → resolve undefined + 调用方 abort 本回合
 *   - 无限等待（RP 回合制，不设超时）
 *   - 断线重连：pendingFrames() 供 hello 补发；多端先答先得
 */

import type { ServerFrame } from "./wire.ts";

export type PendingChoice = {
	question: string;
	options: string[];
	placeholder?: string;
	/** value=字符串应答；undefined=停止本回合 */
	resolve: (value: string | undefined) => void;
	settled: boolean;
};

export type ChoiceGate = {
	/** 广播选择卡帧 */
	ask: (question: string, options: string[], placeholder: string | undefined, signal?: AbortSignal) => Promise<string | undefined>;
	/** 收敛一张未决卡 */
	settle: (id: string, outcome: { value?: string; stop?: boolean }) => void;
	/** 未决卡帧列表（hello 补发） */
	pendingFrames: () => ServerFrame[];
	/** 全部未决按停止收敛（dispose 时） */
	abortAll: () => void;
	/** headless uiContext 片段（select/input/notify + TUI no-op） */
	uiContext: Record<string, unknown>;
};

function normalizeChoiceOptions(options: string[]): string[] {
	return options
		.map((option) => String(option).trim())
		.map((option) => option.replace(/^(?:选项\s*)?(?:[A-Za-z]|[1-9]\d*)[.、．)\]]\s*/i, '').trim())
		.filter(Boolean);
}

export function createChoiceGate(broadcast: (frame: ServerFrame) => void): ChoiceGate {
	const pendingChoices = new Map<string, PendingChoice>();
	let choiceSeq = 0;

	const choiceFrame = (id: string, p: PendingChoice): ServerFrame => ({
		type: "choice",
		id,
		question: p.question,
		options: p.options,
		...(p.placeholder ? { placeholder: p.placeholder } : {}),
	});

	const settle = (id: string, outcome: { value?: string; stop?: boolean }) => {
		const p = pendingChoices.get(id);
		if (!p || p.settled) return;
		p.settled = true;
		pendingChoices.delete(id);
		broadcast({ type: "choice_resolved", id, ...(outcome.stop ? { stopped: true } : { answer: outcome.value }) });
		p.resolve(outcome.stop ? undefined : outcome.value);
	};

	const ask = (question: string, options: string[], placeholder: string | undefined, signal?: AbortSignal) =>
		new Promise<string | undefined>((resolve) => {
			const id = `c${Date.now().toString(36)}-${++choiceSeq}`;
			const pending: PendingChoice = { question, options: normalizeChoiceOptions(options), placeholder, resolve, settled: false };
			pendingChoices.set(id, pending);
			broadcast(choiceFrame(id, pending));
			signal?.addEventListener("abort", () => settle(id, { stop: true }), { once: true });
		});

	const noop = () => {};

	const uiContext: Record<string, unknown> = {
		notify(message: string, type?: "info" | "warning" | "error") {
			broadcast({ type: "notify", level: type ?? "info", text: message });
		},
		select: async (title: string, options: string[], opts?: { signal?: AbortSignal }) =>
			ask(title, Array.isArray(options) ? options : [], undefined, opts?.signal),
		confirm: async () => false,
		input: async (title: string, placeholder?: string, opts?: { signal?: AbortSignal }) =>
			ask(title, [], placeholder, opts?.signal),
		editor: async () => undefined,
		custom: async () => undefined,
		onTerminalInput: () => noop,
		setStatus: noop,
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setWidget: noop,
		setFooter: noop,
		setHeader: noop,
		setTitle: noop,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorComponent: () => undefined,
		get theme() {
			return undefined;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Web 模式不支持主题切换" }),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
	};

	return {
		ask,
		settle,
		pendingFrames: () => {
			const out: ServerFrame[] = [];
			for (const [id, p] of pendingChoices) {
				if (!p.settled) out.push(choiceFrame(id, p));
			}
			return out;
		},
		abortAll: () => {
			for (const [id, p] of pendingChoices) {
				if (!p.settled) {
					p.settled = true;
					try {
						p.resolve(undefined);
					} catch {
						/* */
					}
				}
				pendingChoices.delete(id);
			}
		},
		uiContext,
	};
}
