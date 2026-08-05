/**
 * 子拓展（子 agent）并行编排宿主。
 *
 * 参考 pi-interactive-subagents 的异步子 agent 模型，但不依赖终端 multiplexer pane：
 * 每个子 agent 是进程内独立的 AgentSession（SessionManager.inMemory 不落盘），
 * 与主助手会话互不共享状态（Agent 的 activeRun 串行约束天然保证单回合运行）。
 *
 * - spawn 立即返回（异步），子 agent 在后台并行执行
 * - 信号量控制并发上限（默认 2）
 * - watchdog 定期检查 updatedAt 停滞 → stalled
 * - 完成/失败通过 onResult 回调回传主助手会话
 */

import { createAgentSession, SessionManager, type AuthStorage, type ModelRegistry, type ResourceLoader, type SettingsManager, type ToolDefinition } from "@drawdream/agent-runtime/web";
import type { Model } from "@drawdream/ai";
import type { AgentSession, AgentSessionEvent } from "@drawdream/agent-runtime/web";

export type SubagentStatus = "starting" | "active" | "waiting" | "stalled" | "running" | "done" | "error";

export interface SubagentInfo {
	id: string;
	name: string;
	task: string;
	status: SubagentStatus;
	startedAt: number;
	updatedAt: number;
	result?: string;
	error?: string;
}

export interface SubagentHostOptions {
	cwd: string;
	agentDir: string;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	/** 子 agent 专用资源加载器工厂（每次 spawn 独立实例，不吃 roleplay 剧情扩展） */
	createResourceLoader: () => ResourceLoader;
	/** 子 agent 工具工厂：每次 spawn 调用生成独立实例（含独立 todo 闭包） */
	tools: () => ToolDefinition[];
	/** 与主助手一致的本机工具策略（backendControl=false → "builtin" 禁用本机工具） */
	noTools?: "builtin" | "all";
	/** 主助手当前模型（子 agent 跟随）；null 时交给模型注册表兜底 */
	getModel: () => { provider: string; id: string } | null;
	/** 并发上限 */
	maxConcurrent: number;
	/** 状态变化广播（透传 wire 层 assistant_subagents 帧） */
	onUpdate: (subagents: SubagentInfo[]) => void;
	/** 完成/失败回传（注入主助手上下文） */
	onResult: (subagent: SubagentInfo) => void;
	/** 无进度判定阈值（默认 120s） */
	stallTimeoutMs?: number;
	/** watchdog 轮询间隔（默认 15s） */
	watchdogIntervalMs?: number;
	/** 子会话工厂（测试注入；默认 createAgentSession + bindExtensions + subscribe） */
	createSession?: (ctx: {
		model?: Model<any>;
		loader: ResourceLoader;
		tools: ToolDefinition[];
		onEvent: (ev: AgentSessionEvent) => void;
	}) => Promise<AgentSession>;
}

interface SubagentRun {
	info: SubagentInfo;
	abort: AbortController;
	session: AgentSession | null;
	background: Promise<void>;
}

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["done", "error"]);

/** 提取最终 assistant 文本（从 agent_end 事件携带的消息流末尾取） */
function extractAssistantText(messages: { role: string; content: unknown }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const c = m.content;
		if (typeof c === "string") {
			if (c.trim()) return c;
			continue;
		}
		if (Array.isArray(c)) {
			const parts: string[] = [];
			for (const block of c) {
				if (block && typeof block === "object" && "type" in block && block.type === "text") {
					const t = (block as { text?: unknown }).text;
					if (typeof t === "string" && t.trim()) parts.push(t);
				}
			}
			if (parts.length) return parts.join("\n");
		}
	}
	return "";
}

export class SubagentHost {
	private readonly opts: SubagentHostOptions;
	private readonly runs = new Map<string, SubagentRun>();
	private seq = 0;
	private watchdog: ReturnType<typeof setInterval> | null = null;

	constructor(opts: SubagentHostOptions) {
		this.opts = opts;
	}

	get runningCount(): number {
		let n = 0;
		for (const r of this.runs.values()) {
			if (!TERMINAL.has(r.info.status)) n++;
		}
		return n;
	}

	snapshot(): SubagentInfo[] {
		return [...this.runs.values()].map((r) => ({ ...r.info }));
	}

	/**
	 * 派发子 agent（异步）：立即返回派发结果，子 agent 后台并行执行。
	 * 并发达到上限时返回错误（不排队）。
	 */
	async spawn(params: { name?: string; task: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		const { maxConcurrent } = this.opts;
		if (maxConcurrent <= 0 || this.runningCount >= maxConcurrent) {
			return {
				ok: false,
				error: `并发子拓展已达上限（${maxConcurrent}），请等待现有子拓展完成或复用其结果。`,
			};
		}
		const id = `sa-${Date.now().toString(36)}-${++this.seq}`;
		const name = (params.name ?? "").trim() || "子拓展";
		const task = (params.task ?? "").trim();
		if (!task) return { ok: false, error: "子拓展任务（task）不能为空。" };
		const now = Date.now();
		const info: SubagentInfo = { id, name, task, status: "starting", startedAt: now, updatedAt: now };
		const run: SubagentRun = {
			info,
			abort: new AbortController(),
			session: null,
			background: Promise.resolve(),
		};
		this.runs.set(id, run);
		run.background = this._run(run).catch(() => {
			/* _run 内部已处理错误与状态 */
		});
		this._emit();
		this._ensureWatchdog();
		return { ok: true, id };
	}

	/** 取消指定子 agent 的当前回合（turn 级中断；会话保持终态） */
	async interrupt(idOrName: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const run = this._find(idOrName);
		if (!run) return { ok: false, error: "未找到该子拓展。" };
		if (TERMINAL.has(run.info.status)) return { ok: false, error: "该子拓展已结束。" };
		run.abort.abort();
		try {
			await run.session?.abort();
		} catch {
			/* 回合可能已结束 */
		}
		return { ok: true };
	}

	async dispose(): Promise<void> {
		if (this.watchdog) {
			clearInterval(this.watchdog);
			this.watchdog = null;
		}
		for (const run of this.runs.values()) {
			run.abort.abort();
			try {
				await run.session?.abort();
			} catch {
				/* 忽略 */
			}
			await Promise.race([run.background, new Promise((r) => setTimeout(r, 500))]).catch(() => {});
		}
		this.runs.clear();
	}

	// ---------------------------------------------------------------- 内部

	private _find(idOrName: string): SubagentRun | undefined {
		for (const r of this.runs.values()) {
			if (r.info.id === idOrName || r.info.name === idOrName) return r;
		}
		return undefined;
	}

	private _touch(info: SubagentInfo, status: SubagentStatus, patch?: Partial<SubagentInfo>): void {
		const now = Date.now();
		Object.assign(info, patch ?? {}, { status, updatedAt: now });
		this._emit();
	}

	private _emit(): void {
		try {
			this.opts.onUpdate(this.snapshot());
		} catch {
			/* 广播失败不影响执行 */
		}
	}

	private _ensureWatchdog(): void {
		if (this.watchdog) return;
		const interval = this.opts.watchdogIntervalMs ?? 15_000;
		const threshold = this.opts.stallTimeoutMs ?? 120_000;
		this.watchdog = setInterval(() => {
			const now = Date.now();
			for (const run of this.runs.values()) {
				const s = run.info.status;
				if (TERMINAL.has(s) || s === "stalled" || s === "starting") continue;
				// 回合进行中的 active 视为有进度（长工具调用不误判）；仅无任何更新时判 stalled
				if (now - run.info.updatedAt > threshold) {
					this._touch(run.info, "stalled");
					this.opts.onResult({ ...run.info });
				}
			}
		}, interval);
		this.watchdog.unref?.();
	}

	private async _run(run: SubagentRun): Promise<void> {
		const { opts } = this;
		const { info } = run;
		this._touch(info, "active");
		try {
			const model = this._resolveModel(opts.getModel());
			const loader = opts.createResourceLoader();
			await loader.reload();
			let endMessages: { role: string; content: unknown }[] = [];

			const create = opts.createSession ?? this._defaultCreateSession;
			const session = await create({
				model,
				loader,
				tools: opts.tools(),
				onEvent: (ev: AgentSessionEvent) => {
					if (ev.type === "message_delta" || ev.type === "message" || ev.type === "tool_start" || ev.type === "tool_end") {
						this._touch(info, "active");
					}
					if (ev.type === "agent_end" && Array.isArray(ev.messages)) {
						endMessages = ev.messages as { role: string; content: unknown }[];
					}
				},
			});
			run.session = session;

			await session.prompt(info.task);
			const result = extractAssistantText(endMessages);
			if (run.abort.signal.aborted) {
				this._touch(info, "error", { error: "子拓展已中断。" });
			} else {
				this._touch(info, "done", { result: result || "（子拓展未返回文本结果）" });
			}
		} catch (err) {
			if (run.abort.signal.aborted) {
				this._touch(info, "error", { error: "子拓展已中断。" });
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				this._touch(info, "error", { error: msg });
			}
		} finally {
			try {
				await run.session?.dispose?.();
			} catch {
				/* 忽略 */
			}
			this._emit();
			try {
				this.opts.onResult({ ...run.info });
			} catch {
				/* 忽略 */
			}
		}
	}

	private readonly _defaultCreateSession: NonNullable<SubagentHostOptions["createSession"]> = async ({
		model,
		loader,
		tools,
		onEvent,
	}) => {
		const { opts } = this;
		const { session } = await createAgentSession({
			cwd: opts.cwd,
			agentDir: opts.agentDir,
			authStorage: opts.authStorage,
			modelRegistry: opts.modelRegistry,
			settingsManager: opts.settingsManager,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(opts.cwd),
			customTools: tools,
			...(opts.noTools ? { noTools: opts.noTools } : {}),
			...(model ? { model } : {}),
		});
		await session.bindExtensions({
			mode: "rpc",
			onError: () => {
				/* 子 agent 错误已通过回合结果体现 */
			},
		} as never);
		session.subscribe(onEvent);
		return session;
	};

	private _resolveModel(cur: { provider: string; id: string } | null): Model<any> | undefined {
		if (cur?.provider && cur.id) {
			try {
				const m = this.opts.modelRegistry.find(cur.provider, cur.id);
				if (m) return m;
			} catch {
				/* 找不到时交给 createAgentSession 兜底 */
			}
		}
		return undefined;
	}
}
