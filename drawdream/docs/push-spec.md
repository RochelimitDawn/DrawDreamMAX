# DrawDream 推送与发布规范

## 当前发布线

- 产品版本：`2.0.0-alpha.1`
- 安卓 tag 格式：`v2.0.0-alpha.1-mobile.N`
- 默认分支：仅 **`main`**
- CI：推送匹配 `v*` 的 tag 触发 [`.github/workflows/release-apk.yml`](../../.github/workflows/release-apk.yml)
- 远程策略：只保留**最新** `v2.0.0-alpha.1-mobile.*` Release/tag

## mobile.83 变更摘要

1. **思考计时器暂停修复**
   - 根因：`session-store.ts` 收到正文首 token 时只追加 `text`，时间线里 think 步骤保持 `streaming: true`，`ThinkingBlock` 的计时器持续走（思考已完成但计时未停）
   - 修复：正文首 token（`hadText` 由空变非空）时，把 timeline 里 think 步骤标记 `streaming: false`；`ThinkingBlock` 计时器支持冻结显示——结束时保留并展示思考耗时，不再消失
   - 断言：正文流式开始后 think 步骤非流式、计时器冻结

2. **本机工具开关（backendControl）热更新即时生效**
   - 根因：`noTools: "builtin"` 仅在创建 session 时生效；配置热更新（`PUT /api/config` → `session.reload`）用 `getActiveToolNames()` 保留旧工具集，不重建初始工具 → 关闭「本机工具（bash/文件）」后 AI 仍能调用 read/bash/edit/write
   - 修复：rest-host 新增 `applyBackendToolPolicy()`——reload 后依据 `backendControl` 动态收敛本机工具集（关则剔除 read/bash/edit/write，开则补回）；`user-host` 的 `handlePrompt` 改为基于当前 active 工具过滤 smart_search（移除模块级 `storyToolNames` 缓存，避免 prompt 时误清空工具）
   - 新增测试：`backend-tool-policy.test.ts` 覆盖关→剔、开→补全链路

3. **文档解析（MinerU）**
   - 设置 → 高级新增「文档解析」配置区：`enabled` / `apiKey`（精准解析 Token）/ `modelVersion` / `maxChars`
   - 上传 PDF/Word/PPT/Excel 等文档时后台自动结构化解析为 Markdown：配置 Token 走精准 API（`/api/v4/file-urls/batch` → PUT → 轮询 → 下载 zip → 提取 full.md，node:zlib inflateRaw 免第三方依赖）；留空走免 Token 轻量 API（`/api/v1/agent/parse/file` → PUT → 轮询 → 下载 markdown_url）
   - 注入：`roleplay.ts` 的 `buildUploadIndex` 在每轮末端注入上传区速览与已解析文档的 Markdown 摘要（截断到 maxChars），全文落 `.drawdream-uploads/<名>.md` 供 read 按需读取
   - 配置 schema：`RpConfig.documentParse`（agent/src/types.ts + 前端 rest.ts）；`applyConfigPatch` 规范化（未传 apiKey 保留磁盘密钥）
   - 新增测试：`document-parse.test.ts`（可解析判定 / zip deflate 与 STORE 提取 / 截断）；端到端实测 `PUT /api/config` 保存 documentParse 成功

4. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.83` 触发 APK workflow

## mobile.82 变更摘要

1. **思考档切换彻底修复（切换显示「已更新」但实际 Off）**
   - 根因：覆盖安装/重启后命中磁盘缓存时，`selectModel` 的 `if (!cached && !probingSet.has(...))` 直接跳过 `runThinkingProbe`，**能力从未写回**（`reasoning` 仍 false）；内核 `getSupportedThinkingLevels` 依据模型 `reasoning` 只返回 `["off"]`，用户切换任意档位都被 clamp 回退 → toast「已更新思考档」但按钮/实际档位仍是 Off
   - 修复：`selectModel` 缓存命中时同步 `applyProbeCapability` + `applyLowestThinkingLevel`；`setThinkingLevel` 切换前兜底检查当前模型能力，未写回且有缓存时先写回再设置档位
   - 新增断言：`rest-host-clamp.test.ts` 覆盖「selectModel 命中缓存后切换档位生效」「setThinkingLevel 兜底写回」两个场景

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.82` 触发 APK workflow

## mobile.81 变更摘要

1. **修复「未知接口：POST /api/presets/preview」**
   - 根因：路由分发 `isStCompatPath` 把 `presets` 段判为 SillyTavern 兼容路径（`ST_COMPAT_SEGMENTS` 含 `"presets"`），`/api/presets/*` 全部被兼容层劫持；兼容层只处理 `save/delete/restore`，其余（preview/import/select/saveas/rename/export）落到 404「未知接口」
   - 修复：`isStCompatPath` 对 `/api/presets/*` 仅当命中 `ST_PRESET_METHODS`（save/delete/restore）时判为 ST，其余归 DrawDream `presets` 域路由
   - 新增断言：`compatibility-route.test.ts` 验证 presets 各方法分流正确；端到端实测 `POST /api/presets/preview` 返回 200

2. **设置页对话 tab 移除思考切换区块**
   - 设置 → 对话的思考强度卡片（`settings-intensity-card` + `ThinkingIntensityWheel`）移除，思考强度统一通过对话输入框思考按钮切换

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.81` 触发 APK workflow

## mobile.80 变更摘要

1. **Logo 资源全量生效（修复空白显示）**
   - 根因：`public/brand/logo-mark.svg`、`public/favicon.svg`、`logo-wordmark.svg` 用 SVG `<image href="xxx.png">` 外部引用 PNG；部分 WebView/浏览器对 SVG 内嵌外部资源加载失败，导致 logo/favicon 显示为空白
   - 修复：三个 SVG 改为**内嵌 base64 PNG**（`data:image/png;base64,...`），不再依赖外部文件加载，任何环境可靠渲染

2. **思考档切换修复（缓存命中后档位被 clamp 回退）**
   - 根因：`runThinkingProbe` 命中磁盘缓存（`reason:"cache"`）时直接返回，**不写回模型能力**（`reasoning`/`thinkingLevelMap`）；而内核 `session.setThinkingLevel` 的 clamp 依据模型 `reasoning` + `thinkingLevelMap`，未标记的自定义渠道会把档位 clamp 回退 → 前端「已保存」但实际未生效
   - 修复：抽取 `applyProbeCapability()`，探测成功**与缓存命中**都写回模型能力；新增测试断言缓存命中后切换档位生效
   - 新增断言：`rest-host-clamp.test.ts` 验证缓存命中后 `reasoning`/`thinkingLevelMap` 写回、`setThinkingLevel("medium")` 不被回退

3. **对话页移除思考档 Select**
   - 对话页顶部工具栏的思考档下拉移除（与思考按钮/设置页思考强度存在重复入口，且曾与切换冲突）；思考强度统一通过输入框思考按钮（ChatComposer）切换

4. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.80` 触发 APK workflow

## mobile.79 变更摘要

1. **渠道编辑卡片就近弹出**
   - 原：点击渠道卡片后，编辑表单（`api-edit-block`）在页面底部渲染（向量模型区块之后），窄屏/移动端易不可见
   - 改：编辑表单移至渠道卡片网格（`provider-grid`）正下方就近展开，符合直觉

2. **MCP 连接方式定制下拉**
   - 添加/编辑 MCP 服务时，「连接方式」（stdio/http/sse）由原生 `<select>` 改为项目定制 `Select` 组件，与全站下拉交互一致

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.79` 触发 APK workflow

## mobile.78 变更摘要

1. **修复覆盖安装后滚动更新失效**
   - 根因：覆盖安装保留 `getExternalFilesDir` 旧 runtime 数据；旧版（tree-shaking 漏 typebox 等）的 `single.mjs` 不携带 `__DD_SINGLE_FILE_BUNDLE` 标志，但 `isReady` 只校验 marker/mobile-entry.mjs，误判其可用。若 activeVersion 与新 APK runtimeId 恰被命中旧缓存，新 runtime 无法切换到 active 位置，旧损坏 runtime 持续运行（表现为覆盖安装升级后仍卡/异常，卸载重装才正常）
   - 修复：`isReady` 增加 `agent/single.mjs` 单文件 bundle 标志校验——缺失则视为未就绪，`ensureReady` 走解压分支，用 APK 内的新 runtime 覆盖
   - 用户验证：卸载重装后 mobile.77 正常（typebox 修复有效）；本次加固让覆盖安装路径同样可靠

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.78` 触发 APK workflow

## mobile.77 变更摘要

1. **修复真机运行时卡死（关键）**
   - 根因：mobile 用 esbuild 把 agent 打包为单文件 `single.mjs`（裁剪树无 node_modules）。扩展加载器在 Node 模式下用 `jiti + alias` 走 `require.resolve("typebox")`，但裁剪树没有 node_modules/typebox → 加载 `roleplay.ts` 时抛 `Cannot find module 'typebox'`，服务 listening 后会话创建卡死/崩溃
   - 修复：`bundle-agent.mjs` 打包时注入 `globalThis.__DD_SINGLE_FILE_BUNDLE=true`（esbuild banner）；`loader.ts` 检测该标志后走 `virtualModules`（typebox 等已由 loader.ts 静态 import 内联进 bundle），不再依赖文件系统解析
   - 本地冒烟验证：single.mjs 启动 → 登录 → 会话创建成功，无 typebox 错误

2. **bootstrap 看护（防无限卡「准备/解压」）**
   - `AgentRuntimeService` 新增 watchdog：bootstrap 线程启动 90s 内未进入 ready/error 则强制标记 error 并输出 `runtimeInfo` 诊断，避免异常导致无限卡在 splash 且 UI 无反馈

3. **解压健壮性**
   - 解压前先 `pruneOldReleases` 释放历史运行时占用空间，并校验可用空间（<64MB 明确报错，而非反复解压失败）
   - `renameTo` 失败（跨存储/个别 ROM）时回退为逐文件复制安装，避免"解压成功但安装失败反复重试"

4. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.77` 触发 APK workflow

## mobile.76 变更摘要

1. **切后台后入场恢复兜底**
   - 根因：`MainActivity.onDestroy` 会 `removeCallbacks(poll)`；切后台若 Activity 重建，poll 曾丢失，且 `ACTION_READY` 广播可能在 receiver 注册前发出，导致一直停在「正在准备运行时」而无法进入 WebView
   - 修复：`onResume` 增加兜底——未加载时若 `lastStatus=="ready"` 直接 `openUi()`，否则重启 poll 继续轮询；跨实例静态 `lastStatus` 保证进程重建后可恢复
   - 诊断：bootstrap 失败时写 `RuntimeBootstrap.runtimeInfo()`（active/previous/releases 列表）到日志，便于定位 runtime 缓存/清理问题

2. **Logo 抠除背景（透明底）**
   - 根因：新 Logo 设计图整体不透明（米黄底 `#FAF6F0`），直接导出导致图标、favicon、Android 启动图标都带米黄底
   - 修复：基于背景色 flood-fill 抠图（只透明化从边界可达的背景，保留主体内部浅色），批量重生成 `public/brand/logo-icon-{32,64,180,192,512}.png`、`logo-icon.png/.webp`、`favicon-{32,64}.png`，以及 Android `logo_mark.png` / `logo_mark_launcher.png`
   - 四角 alpha=0，主体完整；Android 启动图标透明底 + 圆角

3. **入场背景精致化**
   - 调低暖金饱和度：浅色顶部高光 `#F6EBD8→#FBF7F0`（极淡金色，克制不艳），深色顶部微光 `#4A3824→#241D15`
   - 网格线改淡：浅色暖金 `#D2A46C` alpha 72，深色 `#C6A05C` alpha 95（若有若无的纹理感）

4. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.76` 触发 APK workflow

## mobile.75 变更摘要

1. **思考实时计时**
   - 思考开始时在思考条旁展示已持续秒数（精确到小数点后一位，如 `12.4s`），思考结束即停止
   - 计时器为独立 `ThinkTimer` 子组件：直接写 DOM 文本（rAF 更新，不触发父组件重渲染），卸载即停止；弹入动画 + 呼吸点 + tabular-nums 等宽数字
   - 主对话与侧栏助手思考块共用

2. **安卓入场动画主题化（暖金 + 网格）**
   - 入场 splash 背景由固定 slate 灰蓝改为暖金色系，跟随设置里的浅色/深色主题
   - 浅色：暖羊皮纸底 `#FAF6F0` + 顶部暖金光晕，网格线暖棕 `#C47A3A`
   - 深色：暖棕底 `#161210` + 顶部暖金微光，网格线暖金 `#E0B06A`
   - 新增资源：`splash_bg_{light,dark}.xml`、`grid_overlay_{light,dark}.xml`、`grid_fade_mask_{light,dark}.xml`、`grid_tile_{light,dark}.png`
   - `MainActivity` 新增 `setTheme` JS 桥：前端 `applyTheme` 通知壳保存主题（SharedPreferences），启动时读取并切换 splash 背景/网格/标题/进度条配色；`system` 模式跟随系统 `uiMode`
   - 网格设计保留（斜纹十字网格），仅换暖金配色

3. **清理过期历史运行时**
   - 根因：`ensureReady` 每次升级把新 runtime 落盘 `runtime/releases/$version`，只记录 `activeVersion`/`previousVersion`，从不删除旧版本，历史运行时永久累积
   - 修复：`RuntimeBootstrap.pruneOldReleases(ctx)` 列出 `releases/`，保留 active 与 previous 两个版本（回退用），删除更早版本；在新版本激活后与每次启动快路径命中时调用
   - 兼容：`scheduleRuntimeUpdate` 失败回退依赖 previous 版本，prune 保留它，回退不受影响

4. **切后台后入场恢复兜底**
   - 根因：`MainActivity.onDestroy` 会 `removeCallbacks(poll)`；切后台若 Activity 重建，poll 曾丢失，且 `ACTION_READY` 广播可能在 receiver 注册前发出，导致一直停在「正在准备运行时」而无法进入 WebView
   - 修复：`onResume` 增加兜底——未加载时若 `lastStatus=="ready"` 直接 `openUi()`，否则重启 poll 继续轮询；跨实例静态 `lastStatus` 保证进程重建后可恢复
   - 诊断：bootstrap 失败时写 `runtimeInfo`（active/previous/releases 列表）到日志，便于定位 runtime 缓存/清理问题

5. **Logo 抠除背景（透明底）**
   - 根因：新 Logo 设计图整体不透明（米黄底 `#FAF6F0`），直接导出导致图标、favicon、Android 启动图标都带米黄底
   - 修复：基于背景色 flood-fill 抠图（只透明化从边界可达的背景，保留主体内部浅色），批量重生成 `public/brand/logo-icon-{32,64,180,192,512}.png`、`logo-icon.png/.webp`、`favicon-{32,64}.png`，以及 Android `logo_mark.png` / `logo_mark_launcher.png`
   - 四角 alpha=0，主体完整；Android 启动图标透明底 + 圆角

6. **入场背景精致化**
   - 调低暖金饱和度：浅色顶部高光 `#F6EBD8→#FBF7F0`（极淡金色，克制不艳），深色顶部微光 `#4A3824→#241D15`
   - 网格线改淡：浅色暖金 `#D2A46C` alpha 72，深色 `#C6A05C` alpha 95（若有若无的纹理感）

7. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.75` 触发 APK workflow

## mobile.74 变更摘要

1. **全局品牌视觉换新（新 Logo）**
   - 以新版暖金棕渐变圆章 Logo（去除原图右下角水印）替换原蓝白「幕布负空间星形人形」视觉
   - 新增品牌资源：`public/brand/logo-icon-{32,64,180,192,512}.png`、`logo-icon.png/.webp`、`favicon-{32,64}.png` 全部替换为新 Logo；`favicon.svg`、`logo-mark.svg`、`logo-wordmark.svg` 改为引用新 Logo PNG
   - Web 引用点全部更新：侧边栏 Logo（`Sidebar.tsx`）、设置页关于区（`Settings.tsx`）、自定义/中转渠道图标（`ProviderIcon.tsx`）、浏览器 favicon 与 iOS apple-touch-icon（`index.html`）
   - Android 启动图标更新：`ic_launcher.xml`、`logo_mark_transparent.xml` 改为位图引用新 Logo（`logo_mark_launcher.png`/`logo_mark.png`），替换原矢量蓝白图标
   - README 顶图引用新 wordmark

2. **思考档位探测结果持久化缓存**
   - 根因：探测缓存 `thinkingProbeCache` 是内存 Map，仅会话期有效，App 重启后同一模型需重复探测
   - 修复：探测成功结果落盘 `.drawdream/thinking-probe-cache.json`，`createRestHost` 启动时预加载；命中磁盘缓存直接返回（reason `"cache"`），不再向端点重复探测；探测失败仍不缓存
   - 新增断言：`rest-host-clamp.test.ts` 验证探测成功后缓存文件落盘、重启（新 host 实例）命中缓存且探测请求数不变

3. **上传改为附件形式（待发送）**
   - 原行为：上传图片/文件后立即拼读取提示词并直接发送
   - 新行为：上传完成后挂到输入区作为附件 chip（可移除），用户可补文本后一起发送；有文本时文本在前、读取提示在后，无文本直接发送时用默认读取提示词（图片识图 / 文件解析）
   - 主对话与助手侧栏（`AssistantPanel`）均生效；`ChatComposer` 新增 `attachments` / `onRemoveAttachment` props 与附件 chip UI

4. **本机工具 / 角色扮演工具名统一四字**
   - `tool-labels.ts` 中文标签全部改为四字标准名：读文件→读取文件、写文件→写入文件、改文件→修改文件、搜内容→搜索内容、找文件→查找文件、列目录→查看目录
   - 角色扮演工具统一：读取世界书→读取世界、写入世界书→写入世界、浏览记忆厅→浏览记忆、创建/挂载/卸载/写入知识库→创建/挂载/卸载/写入知识、读配置→读取配置、写配置→写入配置、读预设→读取预设、查看任务清单→查看任务、配图→生成配图、音频→播放音频、视频→播放视频、配音→文字配音

5. **自定义工具完善（MCP + JSON，参考 MonkeyCode）**
   - 调研结论：MonkeyCode 自定义工具走标准 MCP 协议，工具用 JSON 定义 `{name, description, inputSchema}`，前端 `toolcalls/*.tsx` 渲染器为每个工具提供 `renderTitle`（工具名+参数）与 `renderDetail`（点击展开内容预览）
   - DrawDream 已具备 MCP 基础设施（`agent/src/mcp.ts` + `/api/mcp/*` 路由 + JSON 配置文件 `.drawdream-mcp.json`）与 ToolCallChip 展开预览；本次补齐前端管理 UI：
   - 新增 `McpPanel` 组件（挂到设置→环境页下方「自定义工具」区块）：MCP 服务列表（状态/启用开关/工具数）、按服务展开查看工具名与描述、添加/编辑/删除服务（stdio command / http+sse url）、一键 sync、会话启用开关
   - 新增 rest 客户端：`fetchMcpServers` / `mcpSync` / `mcpSetEnabled` / `mcpAddServer` / `mcpUpdateServer` / `mcpDeleteServer`
   - 工具条显示具体工具名（`mcp__{id}__{tool}` → `外设 · {tool}`），点击可展开内容预览

6. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.74` 触发 APK workflow

## mobile.73 变更摘要

1. **思考档位切换生效修复**
   - 根因：探测成功只写内存缓存，内核 `session.setThinkingLevel` 的档位 clamp 依据模型条目静态 `reasoning` 标志；未标记 reasoning 的自定义渠道（如 tokenrhythm）会把档位 clamp 回 off
   - 修复：`runThinkingProbe` 探测成功后把 `reasoning=true` 与 `thinkingLevelMap` 写回模型对象，clamp 依据真实端点结果
   - 新增测试 `rest-host-clamp.test.ts`：本地探测端点 → 探测成功 → 档位写回 → 切换档位保留

2. **更新弹窗下载中可取消**
   - `ConfirmDialog` 新增 `closeWhileBusy`（busy 时右上角关闭仍可点）
   - `UpdateChecker` 关闭时调用 JS 桥 `cancelUpdate()`；`AppUpdater.cancelUpdate()` 置位，下载循环检查后中止并清理残留 APK；`MainActivity` 暴露桥

3. **环境页卡片布局**：`env-grid` 固定 2 列（桌面两行各两个），≤560px 单列

4. **思考档位图标**：对话区思考按钮 Brain → Gauge

5. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.73` 触发 APK workflow

## mobile.72 变更摘要

1. **更新弹窗锁定关闭**
   - `ConfirmDialog` 新增 `closeOnMask` / `closeOnEscape` / `hideCancel` 可选 props（默认行为不变，不影响其他调用点）
   - `UpdateChecker` 更新弹窗启用锁定：只能通过右上角关闭按钮关闭，点击遮罩、Escape、取消按钮均不关闭，避免等待更新结果时误触关闭

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.72` 触发 APK workflow

## mobile.71 变更摘要

1. **思考探测适配真实端点**
   - `probeThinkingLevels` 单请求超时 8s → 30s、总预算 12s → 90s：适配响应较慢的推理端点（tokenrhythm 等单请求 7-15s），避免 slow 档位被误判为不支持
   - 探测按所选模型 id 原样请求，自定义渠道通过「拉取模型」取端点真实 id 列表，任意模型均可探测（已实测 deepseek/glm/kimi/minimax/qwen 对 `reasoning_effort` 的接受）
   - 429/5xx 视为临时繁忙，自动重试一次后再分类，避免瞬时限流（SERVICE_BUSY）误判

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.71` 触发 APK workflow

## mobile.70 变更摘要

1. **思考探测门控修复**
   - `RestHost.probeThinking` 移除 `m.reasoning` 前置判断：未标记 reasoning 的模型也会对真实端点发起探测，由端点档位接受情况决定是否支持思考，不再瞬间误报「不支持」
   - `selectModel` 静默探测同步放宽（去掉 reasoning 前置条件），选中模型即探测；命中缓存/无 Key 时保持零成本
   - 测试更新：未标记模型无 Key → `no-config`（原 `no-reasoning`）

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.70` 触发 APK workflow

## mobile.69 变更摘要

1. **更新日志 Markdown 渲染**
   - 升级确认对话框的 Release notes 由纯文本改为 Markdown 渲染（`RichMessage mdOnly`），支持标题/列表/加粗/代码块/引用等
   - `UpdateChecker.css` 新增 `.update-notes-md` 容器样式（标题层级、代码块、引用）

2. **更新下载进度条**
   - `AppUpdater.downloadAndInstall` 增加 `onProgress: (Float) -> Unit`（0..1）；`httpDownload` 按块读取并每变化 1% 报告一次
   - `MainActivity` JS 桥新增 `window.__ddUpdateProgress(pct)` 与 `window.__ddUpdateDownloadDone(ok, msg)` 回调，下载完成由前端统一 toast（移除 Kotlin 侧 toast 避免重复）
   - 前端 `UpdateChecker`：下载中弹框切换为暖金进度条 + 百分比 + 「正在下载更新」标题，确认/取消按钮锁定；完成自动关闭并提示，失败显示错误
   - i18n 新增 `updateDownloadingTitle`/`updateDownloading`/`updateReady`/`updateFail`（zh/en）

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.69` 触发 APK workflow

## mobile.68 变更摘要

1. **思考强度显式探测（模型设置页）**
   - 新增 `POST /api/models/probe-thinking`（`RestHost.probeThinking`）：显式探测默认模型（缺省）或指定模型的真实思考档位，同步等待探测完成
   - 成功即写入会话期缓存并自动应用最低可用档位（排除 off），返回 `reason` 供前端提示：`probe`/`cache`/`no-config`/`no-reasoning`/`probe-fail`
   - `selectModel` 静默探测重构复用 `runThinkingProbe` + `applyLowestThinkingLevel`
   - 设置页 API tab 新增「探测思考强度」面板：显示当前默认模型，按钮触发探测，成功/失败结果内联展示并同步思考控件与可用档位
   - `agent/test/rest-host-models.test.ts` 新增 3 用例（无默认模型抛错 / no-reasoning / no-config），5/5 通过

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.68` 触发 APK workflow

## mobile.67 变更摘要

1. **子 agent 结果聚合**
   - 主助手不再逐条接收子 agent 完成/失败消息（消除多段对话）：`server/assistant.ts` 改为聚合缓冲，全部子 agent 终态后一次性汇总注入主助手会话，由主助手整合进最终回复
   - 流式中自动排队（followUp），flush 期间新完成的结果继续补一次汇总

2. **设置页便当盒升级**
   - 所有便当盒卡片左上角新增主题小图标（`settings-item-icon`），链接卡（GitHub/Releases）追加跳转标记
   - 卡片尺寸收紧（min-height 112→84，main flex-basis 修复为 auto，Slider 卡不再被拉伸为 140px 方形）
   - 左下角改为向内折角异形卡片（`::after` 渐变折角 + 折痕斜线），其余角保持圆角
   - 向量模型配置改为可折叠卡片（`vector-card`，默认折叠，点击头部展开/收起，显示当前配置摘要）

3. **检查更新按钮 / 升级对话框**
   - 手机端（≤899px）检查更新按钮改 Uiverse「learn-more」圆钮展开风格，触屏常驻展开态；平板/桌面（≥900px）保持便当盒按钮外观
   - 升级确认对话框品牌化：暖金描边 + 顶部光晕，下载徽章 + 版本号 chip + Release notes 卡片化（`ConfirmDialog` 新增 `panelClassName`）

4. **交互细节**
   - 移除任务清单 / 子拓展折叠按钮右侧脉冲点
   - 子拓展结果改为 Markdown 渲染（RichMessage mdOnly）、终态时长固定

5. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.67` 触发 APK workflow

## mobile.66 变更摘要

1. **自动更新（GitHub Releases API）**
   - 原生 Kotlin `AppUpdater`：请求 `releases/latest` 解析 tag（`v2.0.0-alpha.1-mobile.N`）与 `app-release.apk` / `SHA256SUMS.txt` 资产，与当前 `versionName` 对比
   - 启动后延迟静默检查（仅新版本存在时提示）；设置页「关于」提供手动「检查更新」
   - 下载 APK 到应用缓存，对照 `SHA256SUMS.txt` 校验 SHA-256，通过后经 FileProvider 拉起系统安装器
   - 权限：`REQUEST_INSTALL_PACKAGES`；JS 桥 `checkUpdate` / `downloadUpdate`
   - 前端全局 `UpdateChecker`：检测到新版本弹确认对话框（版本号 + Release notes + 下载并安装），已最新/不支持环境 Toast

2. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.66` 触发 APK workflow

## mobile.65 变更摘要

1. **子拓展（Subagent）并行编排**
   - 助手可派发多个后台子 agent 并行执行独立子任务（进程内独立 AgentSession，`server/subagent-host.ts`）
   - 复用任务清单面板新增「子拓展」实时状态区：状态彩点/名称/任务/时长，完成可展开结果；状态经 `assistant_subagents` 帧实时推送
   - 子 agent 完成/失败结果自动回传主助手整合；并发上限配置 `subagents.maxConcurrent`（默认 2）
   - 参考：pi-interactive-subagents（异步子 agent 模型，不使用终端 pane）

2. **对话框玻璃态升级**
   - 主对话与助手对话框参考 LiveAgent composer-glass-card：半透明 + 背景模糊 + 饱和度提升 + 顶部 rim-light 高光 + 内 gloss 渐变 + 聚焦品牌光晕
   - 圆角由胶囊（22px/19px）收窄为方框微圆角（12px/10px），扩大可读空间；保留原有胶囊展开/聚焦/浮动面板动效
   - 工具按钮聚焦环 + 激活小圆点；textarea 不支持 backdrop-filter，毛玻璃置于父容器 `.dd-composer-field`

3. **向量模型与对话模型分开配置**
   - 设置页新增独立「向量模型」区块（选择渠道 + 该渠道向量模型，保存打 `kind=embedding`）；渠道编辑区仅保留对话模型
   - `GET /api/models` 对话模型列表自动排除 `kind=embedding` 向量模型

4. **思考档位自动应用**
   - 选中默认对话模型 / 聊天页切换模型时自动触发思考档位探测，成功后自动应用最低可用档位（排除 off）以降低 token 消耗
   - 探测完成有 Toast 提示（设置页与聊天页）；同一模型会话期内不重复探测，仅探测失败（报错）时重探

5. **修复**
   - 助手过程区 / 任务清单展开折叠按钮改用 lucide 图标（原 ▸/▾ 字符渲染为一点）
   - 工具调用条流式宽度对齐（`width: fit-content` → `100%` + 与 tool-call-list 一致的上限）

6. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.65` 触发 APK workflow

## mobile.64 变更摘要

1. **助手输入条贴底（flex 列布局）**
   - 助手面板由 CSS Grid 改为 flex 列：消息流 `flex: 1 1 0` 独占剩余空间并内部滚动，输入条/顶栏/任务清单 `flex-shrink: 0`
   - 横屏/竖屏短视口下输入条不再被挤出屏幕，也不再遮挡消息内容
   - 空对话时输入条始终贴底，不再悬浮于面板中部

2. **头像暖金配色**
   - 消息/历史/顶部助手头像渐变统一为暖金（accent-gold → brand → brand-deep），替换原近黑棕/深灰蓝
   - 助手生成中的 3D spinner SVG 填充改为暖金 `#d4a017`

3. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.64` 触发 APK workflow

## mobile.63 变更摘要

1. **思考强度自动探测**
   - 借鉴 frakiowork capability-probe：对渠道发最小 chat 请求，按 `reasoning_effort` 探测 off/low/medium/high，按 api 类型适配请求体
   - `availableLevels` 以探测结果优先，10 分钟 TTL 缓存 + 防重入；失败/未完成回退内置目录
   - 思考按钮点击后原地向上展开浮动面板，当前档位高亮，切换即关，外部/Esc 关闭

2. **思考/工具交错时间线**
   - `ProcessTimeline` 组件：`thinking` 段与工具调用按到达顺序交错展示，相邻重复工具折叠 ×n
   - 主对话与助手流式按到达顺序构建 `streamTimeline` 并落泡保存；历史消息回退旧分组

3. **助手与任务清单 UI**
   - 助手侧栏布局修复：高瘦屏下输入栏不再被挤出、顶栏不再被推出屏幕
   - `todo_write` 清单支持折叠为单行（标题/进度/进行中徽标）
   - 助手生成时卡片头像展示暖金双层 3D spinner（reduced-motion 回退静态）

4. **向量模型（Embedding）配置**
   - 设置页渠道编辑可指定向量模型（`kind='embedding'`），记忆/世界书启用向量召回，留空回退纯词法
   - `ChannelPublic.models` 增加 `kind` 字段

5. **环境页优化**
   - 参考 1Panel 增加运行时/端口/工具就绪/数据占用概览条与工具链状态圆点

6. **联网搜索单路/多路修复**
   - 工具描述改为「模式由用户设置决定」；`execute` 中 `mode` 强制取 `config.smartSearch.mode`，忽略模型自主选择

7. **发布验证**
   - tag `v2.0.0-alpha.1-mobile.63` 触发 APK workflow

## mobile.39 变更摘要

1. **酒馆兼容内核**
   - 完成 Tavern Context、事件、TavernHelper、MVU、消息快照、swipe 和分支状态恢复
   - 完成 Prompt Pipeline、宏、World Info、Regex、Depth Prompt、Author Note 和差分测试
   - 完成受控原卡 iframe DOM、资源解析、外部模块授权和 Agent 活动节点

2. **运行时稳定性**
   - Hybrid Coordinator 将 Agent、工具、搜索和来源作为独立 Prompt sections
   - Android WebView 仅保留 `127.0.0.1:7620` 和 `localhost:7620` 本地导航
   - 外部模块授权按角色卡 fingerprint 隔离并持久化

3. **发布验证**
   - `npm run release:gate`
   - 关键兼容测试、Agent 类型检查、生产构建和 `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.39` 触发 APK workflow

4. **UI 与流式稳定性**
   - `StatusPlaceHolderImpl` 在聊天消息中转换为状态面板
   - 工具中间轮不再清空当前流式气泡，最终消息按 stream ID 原子替换

## 历史发布摘要

### mobile.36

1. **酒馆兼容基础链路**
   - 角色卡读取 `extensions.regex_scripts`，仅执行受限的显示期替换
   - 聊天页支持直接导入 SillyTavern JSONL，并写入可继续对话的导入消息
   - 导入保留 `send_date`、`extra`、`variables`、`metadata`、swipes 和原始正文 sidecar
   - MVU 变量当前采用无损保留策略，变量命令和消息级回放快照列入后续阶段

2. **设置页与消息显示**
   - 桌面/平板设置页改为章节流与稳定 Bento 内部网格
   - 修复 Advanced 标题跨列、长区块半宽和控件挤压
   - 修复重复生成、RP 流式标签闪动与助手侧栏滚动

3. **联网搜索**
   - 本轮联网开关直接控制模型工具 schema
   - 世界时间使用 60 秒 TTL 缓存
   - 支持双语查询规划、单路排序、多路 RRF 融合、正文去重和来源平衡

4. **发布验证**
   - Agent 兼容层专项测试
   - 前端 `npm run build`
   - Agent `npx tsc --noEmit`
   - `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.36` 触发 APK workflow

### mobile.30

1. **卡皮肤依赖清理**
   - 删除酒馆卡前端美化皮肤逻辑、控件、配置字段、REST 路由和相关测试
   - 删除 `body.load` 外链美化、HTML proxy 和 SillyTavern 兼容依赖

2. **移动端与渠道体验**
   - 移动端上下文面板恢复可点击并居中显示
   - 自定义中转渠道始终使用 DrawDream Logo
   - Toggle 恢复黑白配色
   - 修复助手生成前后滚动层级与 flex 高度

3. **Android 与角色卡**
   - Android 桌面、通知和启动页统一使用关于页 DrawDream Logo
   - 角色卡删除增加文件存在性校验并清空卡元信息缓存

4. **消息显示**
   - 抉择选项标题和正文复用 Markdown 渲染，支持 `**加粗**`
   - 保留普通 `show_html` 安全 iframe 渲染

5. **继承能力**
   - 设置精简、接口地址预览、ChatComposer 和透明品牌资源
   - 静默档门禁、状态账本 `chapter`、粘性章节条

6. **发布验证**
   - 前端 `npm run build`
   - `git diff --check`
   - tag `v2.0.0-alpha.1-mobile.30` 触发 APK workflow

## 文档布局

| 路径 | 用途 |
| --- | --- |
| 根 `README.md` | 产品总览、APK 获取、联调 |
| `docs/MOBILE.md` | 移动端架构与打包 |
| `drawdream/README.md` | UI + Agent 子项目入口 |
| `drawdream/docs/push-spec.md` | 本文件：发布与本版变更 |
| `drawdream/docs/pi-intercom-dual-agent-design.md` | Ledger 双轨设计 |

## 打 tag 打包

```bash
git checkout main
git pull
git tag -a v2.0.0-alpha.1-mobile.N -m "Android release mobile.N"
git push origin v2.0.0-alpha.1-mobile.N
```

或 GitHub Actions → Release APK → Run workflow。

Secrets：`ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`。

## 本地联调

```bash
cd drawdream
cp agent/drawdream.agent.example.json agent/drawdream.agent.json
cp agent/drawdream.config.example.json agent/drawdream.config.json
npm install && npm run agent:install
npm run dev
```

默认 `http://127.0.0.1:7620`。勿提交带 Key 的 `drawdream.agent.json`。

## 验证清单

1. 明/暗主题对比度；对话正文刻本宋
2. 窄屏：设置下钻、对话托盘、历史/助手全屏感
3. 普通 `show_html` 内容保持安全 iframe 隔离
4. tag 推送后 Actions 产出 `app-release.apk`（有 keystore 时）
