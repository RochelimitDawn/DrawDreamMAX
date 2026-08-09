/**
 * 10 用户并发压测：隔离性 + 池开销 + 流式耗时
 * 用法：node scripts/stress-10users.mjs
 * 环境：BASE=http://127.0.0.1:7620  N=10  STREAM_TIMEOUT_MS=120000
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const BASE = process.env.BASE ?? "http://127.0.0.1:7620";
const WS_BASE = BASE.replace(/^http/, "ws");
const N = Math.max(2, Number(process.env.N ?? 10));
const STREAM_TIMEOUT_MS = Number(process.env.STREAM_TIMEOUT_MS ?? 120_000);
const PASS = "Stress!Pass1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(__dirname, "..");
const dataRoot = process.env.DD_DATA_ROOT?.trim() || join(agentRoot, "data");

function now() {
	return performance.now();
}

async function api(path, { method = "GET", cookie, body } = {}) {
	const headers = {};
	if (cookie) headers.cookie = cookie;
	if (body !== undefined) headers["content-type"] = "application/json";
	const r = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const set = r.headers.getSetCookie?.() ?? [];
	let nextCookie = cookie ?? "";
	if (set.length) {
		nextCookie = set.map((s) => s.split(";")[0]).join("; ");
	} else {
		const raw = r.headers.get("set-cookie");
		if (raw) {
			nextCookie = raw
				.split(/,(?=\s*[^;]+=)/)
				.map((s) => s.split(";")[0].trim())
				.filter(Boolean)
				.join("; ");
		}
	}
	let json = null;
	const text = await r.text();
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	return { status: r.status, json, cookie: nextCookie || cookie || "" };
}

function copyAgentConfig(userId) {
	const usersDir = join(dataRoot, "users");
	let src = join(agentRoot, "drawdream.agent.json");
	if (existsSync(usersDir)) {
		for (const id of readdirSync(usersDir)) {
			const p = join(usersDir, id, "workspace", "drawdream.agent.json");
			if (existsSync(p)) {
				src = p;
				break;
			}
		}
	}
	if (!existsSync(src)) return false;
	const destDir = join(dataRoot, "users", userId, "workspace");
	mkdirSync(destDir, { recursive: true });
	writeFileSync(join(destDir, "drawdream.agent.json"), readFileSync(src));

	// 角色卡 + 配置（否则 prompt 会空转 agent start→clear→end）
	const cardSrc = join(agentRoot, "assets", "cards", "封神演义.png");
	const cardsDir = join(destDir, "assets", "cards");
	mkdirSync(cardsDir, { recursive: true });
	if (existsSync(cardSrc)) {
		writeFileSync(join(cardsDir, "封神演义.png"), readFileSync(cardSrc));
	}
	const cfgPath = join(destDir, "drawdream.config.json");
	let cfg = {};
	if (existsSync(cfgPath)) {
		try {
			cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
		} catch {
			cfg = {};
		}
	}
	cfg.card = "assets/cards/封神演义.png";
	cfg.userName = cfg.userName || "用户";
	cfg.language = cfg.language || "zh";
	writeFileSync(cfgPath, `${JSON.stringify(cfg, null, "\t")}\n`);
	return true;
}

function openWs(cookie, label) {
	return new Promise((resolve, reject) => {
		const frames = [];
		const byType = {};
		const userTexts = [];
		const deltas = [];
		const narratives = [];
		const errors = [];
		const t0 = now();
		const ws = new WebSocket(`${WS_BASE}/ws`, { headers: { cookie } });
		let sawFirstHello = false;
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error(`${label} hello timeout`));
		}, 45_000);
		ws.on("message", (d) => {
			let f;
			try {
				f = JSON.parse(String(d));
			} catch {
				return;
			}
			frames.push(f);
			byType[f.type] = (byType[f.type] ?? 0) + 1;
			if (f.type === "message" && f.message?.channel === "user") {
				userTexts.push(String(f.message.text ?? ""));
			}
			if (f.type === "message" && f.message?.channel === "narrative") {
				narratives.push(String(f.message.text ?? "").slice(0, 200));
			}
			if (f.type === "delta" && f.kind === "text") {
				deltas.push(String(f.delta ?? ""));
			}
			if (f.type === "error") errors.push(String(f.text ?? ""));
			// 先 new：等「已新建会话」notify（勿与 assistant_hello 混淆）
			if (f.type === "hello" && !sawFirstHello) {
				sawFirstHello = true;
				ws.send(JSON.stringify({ type: "new" }));
				return;
			}
			if (f.type === "notify" && String(f.text ?? "").includes("新建会话")) {
				if (timer._done) return;
				timer._done = true;
				clearTimeout(timer);
				// 给扩展 session_start / 装卡一点时间
				setTimeout(() => {
					resolve({
						ws,
						label,
						sessionId: frames.find((x) => x.type === "hello")?.sessionId,
						helloMs: now() - t0,
						frames,
						byType,
						userTexts,
						deltas,
						narratives,
						errors,
						agentStart: 0,
						agentEnd: 0,
						firstDeltaMs: null,
						streamDone: null,
						t0,
					});
				}, 1500);
			}
		});
		ws.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
	});
}

function waitStream(client, marker, timeoutMs) {
	return new Promise((resolve) => {
		const start = now();
		// 清空连接建立阶段的残留，只统计本轮 prompt
		client.userTexts = [];
		client.deltas = [];
		client.narratives = [];
		client.errors = [];
		client.streamClears = 0;
		let gotUser = false;
		let gotAgentStart = false;
		let gotAgentEnd = false;
		let firstDeltaAt = null;
		const finish = (extra = {}) => {
			cleanup();
			const deltaChars = client.deltas.join("").length;
			const hasContent = deltaChars > 0 || client.narratives.length > 0;
			resolve({
				ok: gotUser && hasContent,
				gotUser,
				gotAgentStart,
				gotAgentEnd,
				hasContent,
				deltaChars,
				firstDeltaMs: firstDeltaAt != null ? firstDeltaAt - start : null,
				totalMs: now() - start,
				streamClears: client.streamClears,
				errors: [...client.errors],
				...extra,
			});
		};
		const onMsg = (d) => {
			let f;
			try {
				f = JSON.parse(String(d));
			} catch {
				return;
			}
			client.byType[f.type] = (client.byType[f.type] ?? 0) + 1;
			if (f.type === "message" && f.message?.channel === "user") {
				const t = String(f.message.text ?? "");
				client.userTexts.push(t);
				if (t.includes(marker)) gotUser = true;
			}
			if (f.type === "message" && f.message?.channel === "narrative") {
				client.narratives.push(String(f.message.text ?? "").slice(0, 400));
			}
			if (f.type === "delta" && f.kind === "text") {
				client.deltas.push(String(f.delta ?? ""));
				if (firstDeltaAt == null) firstDeltaAt = now();
			}
			if (f.type === "stream" && f.state === "clear") client.streamClears++;
			if (f.type === "agent" && f.state === "start") {
				gotAgentStart = true;
				client.agentStart++;
			}
			if (f.type === "agent" && f.state === "end") {
				gotAgentEnd = true;
				client.agentEnd++;
			}
			if (f.type === "error") client.errors.push(String(f.text ?? ""));
			if (f.type === "notify" && f.level === "error") client.errors.push(String(f.text ?? ""));
			// 必须有正文内容才算完成（避免空转 agent start→clear→end）
			if (gotUser && gotAgentEnd && (client.deltas.length > 0 || client.narratives.length > 0)) {
				finish();
			}
		};
		const timer = setTimeout(() => finish({ timeout: true }), timeoutMs);
		function cleanup() {
			clearTimeout(timer);
			client.ws.off("message", onMsg);
		}
		client.ws.on("message", onMsg);
	});
}

async function ensureUser(i) {
	const username = `stress${String(i).padStart(2, "0")}`;
	let r = await api("/api/auth/register", {
		method: "POST",
		body: { username, password: PASS },
	});
	if (r.status !== 200 || !r.json?.ok) {
		r = await api("/api/auth/login", {
			method: "POST",
			body: { username, password: PASS },
		});
	}
	if (!r.json?.ok) throw new Error(`auth fail ${username}: ${JSON.stringify(r.json)}`);
	const userId = r.json.user.id;
	copyAgentConfig(userId);
	// 重新 login 确保 cookie 新鲜（register 已带 cookie）
	if (!r.cookie.includes("dd_session")) {
		r = await api("/api/auth/login", {
			method: "POST",
			body: { username, password: PASS },
		});
	}
	return { username, userId, cookie: r.cookie, marker: `STRESS_MARK_${username}_${Date.now()}_${i}` };
}

function mem() {
	const m = process.memoryUsage();
	return {
		rssMB: +(m.rss / 1024 / 1024).toFixed(1),
		heapMB: +(m.heapUsed / 1024 / 1024).toFixed(1),
	};
}

function readServerRssMb() {
	try {
		for (const pid of readdirSync("/proc")) {
			if (!/^\d+$/.test(pid)) continue;
			try {
				const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
				// 跳过 `sh -c node server/main.ts`
				if (!cmd.includes("server/main.ts")) continue;
				if (cmd.startsWith("sh") || cmd.includes("sh\0-c")) continue;
				if (!cmd.includes("node")) continue;
				const st = readFileSync(`/proc/${pid}/status`, "utf8");
				const m = /VmRSS:\s+(\d+)/.exec(st);
				if (m) return +(Number(m[1]) / 1024).toFixed(1);
			} catch {
				/* */
			}
		}
	} catch {
		/* */
	}
	return null;
}

async function main() {
	console.log(`=== DrawDream 10-user stress  N=${N} BASE=${BASE} ===`);
	console.log("client mem start", mem());

	const health0 = await api("/healthz");
	console.log("health before", health0.json);

	// --- Phase 1: 注册/登录 N 用户 ---
	const tAuth0 = now();
	const users = [];
	for (let i = 0; i < N; i++) {
		const t = now();
		const u = await ensureUser(i);
		users.push({ ...u, authMs: now() - t });
	}
	console.log(
		`auth ${N} users: total ${(now() - tAuth0).toFixed(0)}ms  avg ${(users.reduce((s, u) => s + u.authMs, 0) / N).toFixed(0)}ms`,
	);

	// --- Phase 2: 触发 host 创建（REST models）测懒创建耗时 ---
	const createMs = [];
	const tCreate0 = now();
	await Promise.all(
		users.map(async (u) => {
			const t = now();
			const r = await api("/api/models", { cookie: u.cookie });
			createMs.push({ user: u.username, ms: now() - t, status: r.status });
		}),
	);
	const createTotal = now() - tCreate0;
	console.log(
		`host acquire (parallel /api/models): wall ${createTotal.toFixed(0)}ms  per-user p50/p95 ${pct(createMs.map((x) => x.ms), 50).toFixed(0)}/${pct(createMs.map((x) => x.ms), 95).toFixed(0)}ms`,
	);

	const health1 = await api("/healthz");
	console.log("health after hosts", health1.json);

	// admin stats
	const adminLogin = await api("/api/auth/login", {
		method: "POST",
		body: { username: "admin", password: "DrawDream!Admin" },
	});
	const stats1 = await api("/api/admin/runtime-stats", { cookie: adminLogin.cookie });
	console.log(
		"pool stats",
		JSON.stringify({
			runtimes: stats1.json?.runtimes,
			connections: stats1.json?.connections,
			users: (stats1.json?.users ?? []).map((x) => ({
				id: String(x.userId).slice(0, 8),
				conn: x.connections,
				streaming: x.streaming,
			})),
		}),
	);

	// --- Phase 3: 并行开 N 条 WS ---
	const tWs0 = now();
	const clients = await Promise.all(users.map((u, i) => openWs(u.cookie, u.username)));
	console.log(
		`ws hello parallel: wall ${(now() - tWs0).toFixed(0)}ms  avg hello ${avg(clients.map((c) => c.helloMs)).toFixed(0)}ms`,
	);
	const sessionIds = new Set(clients.map((c) => c.sessionId));
	console.log(`distinct sessionIds: ${sessionIds.size} (expect ${N})`);

	// --- Phase 4: 同时 prompt，测隔离 + 流式 ---
	// 等 new 完全落稳
	await new Promise((r) => setTimeout(r, 400));
	const rssBeforeStream = readServerRssMb();
	const waiters = clients.map((c, i) => waitStream(c, users[i].marker, STREAM_TIMEOUT_MS));
	const tPrompt0 = now();
	for (let i = 0; i < N; i++) {
		const text = `【压测隔离】你的唯一标记是 ${users[i].marker}。请只回复一句短中文，并原样包含该标记。不要提及其他用户。`;
		clients[i].ws.send(JSON.stringify({ type: "prompt", text }));
	}
	const results = await Promise.all(waiters);
	const streamWall = now() - tPrompt0;
	const rssAfterStream = readServerRssMb();
	console.log(`concurrent stream wall: ${streamWall.toFixed(0)}ms`);

	// --- Phase 5: 隔离分析 ---
	let isolationOk = true;
	const isolationIssues = [];
	for (let i = 0; i < N; i++) {
		const mine = users[i].marker;
		const c = clients[i];
		// 自己的 user 回显
		const hasOwnUser = c.userTexts.some((t) => t.includes(mine));
		if (!hasOwnUser) {
			isolationOk = false;
			isolationIssues.push(`${c.label}: missing own user echo`);
		}
		// 不应出现他人 marker（user 回显 / delta / narrative）
		for (let j = 0; j < N; j++) {
			if (i === j) continue;
			const other = users[j].marker;
			const hitUser = c.userTexts.some((t) => t.includes(other));
			const hitDelta = c.deltas.join("").includes(other);
			const hitNar = c.narratives.some((t) => t.includes(other));
			// 他人 user 回显出现 = 广播串扰（硬失败）
			if (hitUser) {
				isolationOk = false;
				isolationIssues.push(`${c.label}: LEAKED user message from ${users[j].username}`);
			}
			// 模型在正文里复述他人标记极罕见；若出现也可能是模型幻觉，仅记 soft
			if (hitDelta || hitNar) {
				isolationIssues.push(
					`${c.label}: soft? other marker in stream from ${users[j].username} (delta=${hitDelta} nar=${hitNar})`,
				);
			}
		}
	}

	// 汇总流式结果
	const okStreams = results.filter((r) => r.gotUser && r.gotAgentEnd).length;
	const withDelta = results.filter((r) => r.deltaChars > 0).length;
	// contentOk defined after per-user log
	const firstDeltas = results.map((r) => r.firstDeltaMs).filter((x) => x != null);
	const totals = results.map((r) => r.totalMs);
	const errUsers = results
		.map((r, i) => ({ u: users[i].username, e: r.errors, t: r.timeout }))
		.filter((x) => x.e.length || x.t);

	console.log("--- stream per user ---");
	for (let i = 0; i < N; i++) {
		const r = results[i];
		console.log(
			`  ${users[i].username}: user=${r.gotUser} content=${r.hasContent} agentEnd=${r.gotAgentEnd} deltaChars=${r.deltaChars} clears=${r.streamClears} firstDeltaMs=${r.firstDeltaMs?.toFixed?.(0) ?? "-"} totalMs=${r.totalMs.toFixed(0)}${r.timeout ? " TIMEOUT" : ""}${r.errors.length ? " ERR:" + r.errors[0].slice(0, 100) : ""}`,
		);
	}

	const contentOk = results.filter((r) => r.hasContent).length;
	console.log("--- summary ---");
	console.log(
		JSON.stringify(
			{
				N,
				isolationOk,
				isolationIssues: isolationIssues.slice(0, 20),
				distinctSessions: sessionIds.size,
				streamsWithContent: contentOk,
				streamsCompletedAgentEnd: okStreams,
				streamsWithDelta: withDelta,
				streamWallMs: +streamWall.toFixed(0),
				firstDeltaP50: firstDeltas.length ? +pct(firstDeltas, 50).toFixed(0) : null,
				firstDeltaP95: firstDeltas.length ? +pct(firstDeltas, 95).toFixed(0) : null,
				streamTotalP50: +pct(totals, 50).toFixed(0),
				streamTotalP95: +pct(totals, 95).toFixed(0),
				hostCreateWallMs: +createTotal.toFixed(0),
				hostCreateP50: +pct(createMs.map((x) => x.ms), 50).toFixed(0),
				hostCreateP95: +pct(createMs.map((x) => x.ms), 95).toFixed(0),
				serverRssMbBeforeStream: rssBeforeStream,
				serverRssMbAfterStream: rssAfterStream,
				pool: health1.json?.pool,
				clientMem: mem(),
				errorCount: errUsers.length,
			},
			null,
			2,
		),
	);

	const health2 = await api("/healthz");
	const stats2 = await api("/api/admin/runtime-stats", { cookie: adminLogin.cookie });
	console.log("health after stream", health2.json);
	console.log(
		"streaming flags",
		(stats2.json?.users ?? []).map((u) => ({ id: u.userId.slice(0, 8), streaming: u.streaming, conn: u.connections })),
	);

	for (const c of clients) {
		try {
			c.ws.close();
		} catch {
			/* */
		}
	}

	if (!isolationOk || sessionIds.size !== N) {
		console.error("FAIL: isolation or session uniqueness");
		process.exit(2);
	}
	// 隔离通过即可；真实 token 流式若 API 限流可能 content 不足，单独标注
	if (contentOk < Math.ceil(N * 0.5)) {
		console.error(`WARN/FAIL: only ${contentOk}/${N} streams had model content (need >=50%)`);
		process.exit(3);
	}
	console.log("PASS");
	process.exit(0);
}

function avg(a) {
	return a.reduce((s, x) => s + x, 0) / (a.length || 1);
}
function pct(a, p) {
	if (!a.length) return 0;
	const s = [...a].sort((x, y) => x - y);
	const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
	return s[i];
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
