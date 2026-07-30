# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息

## 条目

[Liyuan 内嵌 + 仅 7620]
- Date: 2026-07-16
- Context: 用户要求全面绑定 7620，清理 5173/代理遗留
- Category: 构建方法
- Instructions:
  - 唯一入口端口 **7620**（`PORT` 可改）；无 Vite dev 代理、无 5173
  - `npm run dev` = `build` + Agent 托管 `dist`+API+WS；`dev:watch` 额外 vite build --watch
  - `npm run start` = 已有 dist 时只起 Agent
  - 静态目录：`LIYUAN_UI_DIST` → `../dist` → `web/dist`
  - UI 只写同源 `/api` `/ws`；密钥 `agent/liyuan.agent.json`
  - 首次：`npm run agent:install`

[Phase A3 REST 页面]
- Date: 2026-07-16
- Context: Agent 在执行 A3 配置与资产对接时发现
- Category: 构建方法
- Instructions:
  - Settings/Cards/WorldInfo/Persona/Presets 走 `src/agent/rest.ts` 同源 `/api/*`
  - 换卡 body 字段为 `{ card }`（非 path）
  - 角色卡路由 id 为 `encodeURIComponent(assets/cards/...)`
  - 世界书条目用 fingerprint 读写 `PUT /api/lorebook/entry`

[Phase A4 Chat 特色壳]
- Date: 2026-07-16
- Context: Agent 在执行 A4 时发现
- Category: 构建方法
- Instructions:
  - 决策/状态/助手/面板状态在 `session-store`；Chat 右栏 `rightTab`
  - 助手帧 `assistant_*` 与剧情分轨；连接后 `assistantSync`
  - 斜杠命令清单 `GET /api/commands`

[Phase A 验收]
- Date: 2026-07-16
- Context: Agent 在执行 A5 验收时发现
- Category: 测试方法
- Instructions:
  - 验收记录：`drawdream/.monkeycode/specs/2026-07-16-liyuan-agent-reuse/acceptance.md`
  - 冒烟：`npm run build` + `npm run start` 后 curl `/api/models` 等应 200
  - 真实多轮对话需用户自备 Key 写入 `agent/liyuan.agent.json`

[Agent packages 构建]
- Date: 2026-07-17
- Context: Agent 在本地启动时发现 `@liyuan/*` 无 dist、且缺 `tsconfig.base.json`
- Category: 构建方法
- Instructions:
  - `agent/packages/*` 的 `dist` 不入库；`npm run agent:install` 只装依赖，不自动 build 包
  - 需全局 `tsgo`（`@typescript/native-preview`）与根级 `agent/tsconfig.base.json`（上游 pi base，target ES2024）
  - 构建顺序：`tui` → `ai` → `agent` → `coding-agent`（各 `npm --prefix packages/<name> run build`）
  - 之后在 `drawdream/` 执行 `npm run start`（已有 UI dist）或 `npm run dev`（先 build UI）

[叙事流水线 pipeline.mode]
- Date: 2026-07-17
- Context: Agent 实现 narrative-agent 思想内嵌（merged MVP）时发现
- Category: 环境配置
- Instructions:
  - 默认 `pipeline.mode=merged`：场记单次旁侧调用同时写 WorldState patch + 跨轮 `summary_entry`
  - 摘要落盘 `.liyuan-summaries/{sessionId}.jsonl`，每轮注入【故事进度】（`buildTurnInjection`）
  - `pipeline.mode=off` 恢复仅 patch 的旧场记；`full` 配置已预留，规划编排未接线
  - 配置：`liyuan.config.json` 的 `pipeline`，REST 白名单含 `pipeline`
  - 规格：`.monkeycode/specs/2026-07-17-narrative-pipeline/`

[多用户鉴权与数据根]
- Date: 2026-07-19
- Context: Agent 在实现 multi-user-server-persist 时发现
- Category: 运维部署
- Instructions:
  - 默认管理员 `admin` / `DrawDream!Admin`（`DD_ADMIN_USER` / `DD_ADMIN_PASSWORD` 可覆盖）
  - 数据根 `DD_DATA_ROOT` 默认 `agent/data`：SQLite + `users/<id>/workspace`
  - Cookie `dd_session`；业务 `/api/*` 与 `/ws` 需登录；`/api/auth/*` 与静态 UI 公开
  - 记忆宫按 sessionId（`sessionWing`）隔离，新对话不继承旧记忆
  - 文档：`drawdream/agent/MULTI_USER.md`；规格：`drawdream/.monkeycode/specs/2026-07-19-multi-user-server-persist/`
  - 启动：`npm run build && npm run start`（7620）；UI 路径用 `processCwd` 解析，勿绑用户 workspace

[跨用户并发 UserRuntime 池]
- Date: 2026-07-20
- Context: Agent 在实现 concurrent-user-runtime 二期时发现
- Category: 运维部署
- Instructions:
  - 每用户懒创建独立 host：`agent/server/user-host.ts` + `user-runtime-pool.ts`；`main.ts` 只做鉴权/路由/池
  - 环境变量：`DD_MAX_USER_RUNTIMES`（默认 20）、`DD_RUNTIME_IDLE_TTL_MS`（默认 20min）、`DD_RUNTIME_EVICT_INTERVAL_MS`
  - 池满 REST 503 `RUNTIME_POOL_FULL`；WS close 4413；`GET /healthz` 与 `GET /api/admin/runtime-stats` 可看池状态
  - 同用户多设备共享一份 runtime；跨用户流式互不抢占（已无跨用户 RUNTIME_BUSY）
  - 规格：`drawdream/.monkeycode/specs/2026-07-20-concurrent-user-runtime/`

[管理中心与删用户 purge]
- Date: 2026-07-20
- Context: 用户确认删用户默认 purge，管理中心独立 /admin
- Category: 运维部署
- Instructions:
  - 管理中心顶层路由 `/admin`（Settings 不再含 admin tab）；侧栏仅 admin 可见
  - 删用户默认 `purgeWorkspace=true`：`DELETE /api/admin/users/:id` + `confirmUsername`；`pool.release` 踢 runtime
  - 另有 `POST .../kick`、`POST /api/admin/users/batch`（enable/disable/kick/**delete**）
  - Loading 动画：`BanterLoader` 的 keyframes 必须绑在 `.banter-loader__box:before`；改后需 `npm run build` 更新 dist

[设置导入与智能搜索路径]
- Date: 2026-07-20
- Context: Agent 修复导入设置无反馈/不生效、智能搜索路径与助手 TokUI 时发现
- Category: 排错调试
- Instructions:
  - 导入设置：本地偏好立即生效；Agent 段走 `PUT /api/config`，流式中会 409「正在生成…」；需即时 toast + 部分失败 `importPartial`
  - `applyConfigPatch` 的 smartSearch：**未传 apiKey 时保留磁盘已有 Key**，避免导入/只改开关清掉密钥
  - 智能搜索配置路径统一为「设置 → 高级 → 智能搜索」；错误文案与 i18n hint 同步
  - 助手与侧栏状态面板**停用 TokUI/方括号组件 DSL**，用 Markdown；剧情主对话仍可用富文本组件

[智能搜索：无简报 + 工具条单行 + 先取时再搜]
- Date: 2026-07-20
- Context: 用户要求修工具条双行、永久关闭简报、联网搜索必须先 world_time 再 smart_search
- Category: 行为指令
- Instructions:
  - Tavily **简报/配图永久关闭**（`includeAnswer`/`includeImages` 恒 false，设置页不再提供相关项；配置字段废弃）
  - `smart_search` / `world_time` **不**再转成独立 info/助手气泡；过程只走 `activity` → `ToolCallChip`（可展开 detail）
  - 联网检索提示词强制顺序：先单独 `world_time` → 用返回年/日写 query → 再 `smart_search`（禁止同轮并行）

[工具条历史还原 + 助手草稿]
- Date: 2026-07-20
- Context: 用户反馈刷新后工具条消失；助手需浏览器草稿缓存；大版本升至 2.0.0-alpha.1
- Category: 行为指令
- Instructions:
  - 刷新后 ToolCallChip 必须从会话历史还原：`toAssistantHistory` / `toWireHistory` 将 toolCall+toolResult 配对为 `activities` 挂到最终回复
  - 主对话 live 落泡时把 `session.activities` 写入气泡；hello 历史同构
  - 助手 composer 草稿 key=`asst:<sessionId>`，与主对话共用 `dd-composer-drafts`
  - 产品版本 **2.0.0-alpha.1**（Alpha 2.0）

[DrawDream 去梨园化 R1–R3]
- Date: 2026-07-21
- Context: 用户要求 UI 行为不变，背后梨园标识改为 DrawDream 自有；R2/R3 拆 rest 与清理遗留
- Category: 环境配置
- Instructions:
  - npm 作用域 `@drawdream/*`（agent-runtime / agent-core / ai / tui）；根包 `drawdream-agent`
  - 配置仅：`drawdream.agent.json` / `drawdream.config.json` / `drawdream-profiles/`（无 liyuan 兼容）
  - 数据目录仅：`.drawdream-*`；无 `.liyuan-*` / `.rp-*` 迁移
  - 环境变量仅：`DRAWDREAM_UI_DIST` / `DRAWDREAM_TTS_*` / `DRAWDREAM_CODING_AGENT_DIR`
  - 访问 Cookie：`drawdream_access`
  - 产品扩展：`agent/.drawdream/extensions/roleplay.ts`
  - 启动：`npm run start` 单端口 7620；改 agent 后需重启
  - REST：`server/rest.ts` barrel；`rest/{types,http,config}.ts`；`rest/routes.ts` 按 `/api/<seg>` 前缀 O(1) 选域；域路由在 `rest/routes/{misc,codex,skills,mcp,sessions,cards,personas,presets,lore,agent,forge}.ts`
  - 会话文件：`session-files.ts`；选择卡：`choice-gate.ts`；REST 宿主：`rest-host.ts`
  - swipe：`session-swipe.ts`；剧情订阅：`story-subscribe.ts`；助手桥：`assistant-bridge.ts`；编排：`user-host.ts`（~954 行）
  - 性能：agent.json mtime 缓存；GET `/api/models` 必要时 rebind；Forge 进度钩子每 cwd 一次；媒体/上传流式发送
  - UI：`{{user}}/{{char}}` 展示替换 `utils/macro-display.ts`；工具条中英 `tool-labels.ts`；账本 Flags→里程碑；暗色 ProviderIcon 透明底；卡详情标签 `PUT /api/cards/fields`
  - R4：Web 用 `@drawdream/agent-runtime/web`（无 TUI/modes）；`ModelRegistry({ skipBuiltInModels: true })` + `DRAWDREAM_SKIP_BUILTIN_MODELS=1`；`src/context-compiler.ts` 统一 system/turn 装配入口；`compat` 延迟 `builtinModels()`
  - 旧 `agent/web` 已退役；产品 UI 仅上级 `drawdream/dist`
  - Docker/部署脚本主名 drawdream；历史 RELEASE 文档中 liyuan 仅作旧版说明

[DrawDream 手机版 本地 Node APK]
- Date: 2026-07-21
- Context: Agent 在落地 mobile Phase0/1 脚手架时发现
- Category: 构建方法
- Instructions:
  - 手机工程在 `drawdream/mobile/`：Kotlin 壳 + 内嵌 Node + Agent + UI
  - 命令：`npm run mobile:smoke` / `mobile:runtime` / `mobile:inject` / `mobile:prepare`
  - 壳默认 `HOST=127.0.0.1` `PORT=7620` `DRAWDREAM_SKIP_BUILTIN_MODELS=1`；`HOME`/`DD_DATA_ROOT` 指向 app filesDir
  - 真机 Node 需 bionic 兼容二进制：`ANDROID_NODE_URL=...` 覆盖官方 linux-arm64
  - Release：`.github/workflows/release-apk.yml` + Secrets `ANDROID_KEYSTORE_*`
- 方案文档：`.monkeycode/docs/mobile-local-node-apk-plan.md`；说明：`drawdream/mobile/README.md`
  - APK 覆盖安装后必须用 `VERSION.json.runtimeId` 比较代码包版本；发现变化时停止旧 Node 并启动新 runtime，`data/` 与 `home/` 保持独立。

[移动端唯一主线与远程仓库策略]
- Date: 2026-07-22
- Context: 用户要求抛弃网页产品主线、收敛远程历史与规范文档
- Category: 工作流协作
- Instructions:
  - 产品主交付为安卓 APK；`drawdream/src` + `drawdream/agent` 是本地 Node 上的 UI/运行时，禁止当「可删网页版」拆除
  - 远程默认仅 `main`；只保留最新 `v2.0.0-alpha.1-mobile.*` Release/tag，中间分支与旧 tag 删除
  - 许可证：仓库根与自有代码 **PolyForm Noncommercial 1.0.0**；文档需声明早期思路参考梨园、现行代码为自研重构
  - 规范文档：根 `README.md` + `docs/MOBILE.md`（`docs/DUAL_PLATFORM.md` 仅作迁移提示）
