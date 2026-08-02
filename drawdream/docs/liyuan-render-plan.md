# 卡内前端全量渲染改造方案（参考梨园 Liyuan）

日期：2026-08-02
参考项目：https://github.com/weidu12123/Liyuan（master 分支，已克隆到 /tmp/opencode/liyuan 研究）
状态：研究完成，方案待评审

## 一、问题陈述

当前 DrawDream 对卡内美化 HTML/JS 的渲染始终无法还原 SillyTavern 的效果。核心症状：
- 卡脚本执行的 `extensionScripts` 通过隐藏 iframe 运行，但渲染结果无法落到 ChatPage
- 消息中内嵌的 HTML/CSS/JS 即使被 `splitHtmlParts` 识别，iframe 内脚本也无法完整运行
- 卡内 "整楼界面"（full-page UI）、状态栏皮肤、交互表单均无法复现

用户判断：调整 ChatPage 的 React 渲染无法从根本上解决问题，需要研究其他项目的完整渲染方案。

## 二、梨园的渲染架构（研究结论）

梨园与 DrawDream 架构相似（React 前端 + Node server + Agent 内核 + WS），但其卡渲染思路与 DrawDream 有**根本性差异**。梨园的方案可概括为**"让卡自管 UI"**：

### 2.1 渲染模型：消息文本即 HTML，交给 iframe 全权渲染

梨园**不把卡内 HTML 翻译成 React 组件**，而是：
1. 消息正文经过卡的显示正则处理（`prepareDisplayText`）后，HTML 块被识别为独立段
2. 每个 HTML 段渲染为一个 **seamless iframe**（`HtmlFrame` 组件）
3. iframe 内直接运行卡脚本，脚本的 DOM 操作就是 UI 本身
4. React 只负责外层消息排版（名字行、操作按钮、过程条），不介入 iframe 内部

```
消息文本（服务端已套皮肤正则）
  → splitRichContentParts → [{text}, {html, scripts}, {status}]
  → html 段 → <HtmlFrame html scripts seamless />
  → iframe 内卡脚本自由渲染整个 UI
```

关键点：**卡脚本在它自己的 iframe 内创建并管理整个 UI**，脚本 `innerHTML`、`appendChild`、`position:fixed` 等都直接生效，无需通过 bridge 传回父页。

### 2.2 沙箱策略：脚本帧同源，CSP 大幅放宽

梨园的 `frameDoc.ts` 对脚本帧采用：
- **sandbox**：`allow-scripts allow-same-origin allow-forms allow-modals allow-popups`
  - 注释明确说明原因：**必须同源**，否则 IndexedDB/Dexie/localStorage 在 opaque origin 上抛 `SecurityError`，卡初始化挂掉 → 按钮绑不上
- **CSP**：`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; style-src 'unsafe-inline' https: http: data:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; connect-src https: http: ws: wss: data: blob:; worker-src blob: data:; frame-src 'none'`

即**允许 `unsafe-eval`、任意 https/http 脚本（CDN）、任意 connect、blob worker**。这让程序卡能拉取 CDN 库（dexie/echarts 等）、用 `eval`/`Function`、访问网络。

### 2.3 高度与视口处理

- `looksLikeProgramApp()`：脚本体积 ≥25KB 或含 `position:fixed` + `100vh/dvh` 特征 → 判为"全屏程序卡"，iframe 高度直接按 `78vh` 给（不指望内容盒自报）
- `HEIGHT_REPORTER_SNIPPET`：iframe 内量**内容盒**（body 直接子元素底部）而非 `scrollHeight`，避免 100vh 反馈环；ResizeObserver + 前几秒轮询后稳定停
- `SEAMLESS_DOC_CSS`：禁止 html/body 吃满 100vh，避免白底无限向下扩

### 2.4 脚本健壮性处理

- `escapeScriptEndTags()` + `findScriptCloseIndex()`：**修复卡脚本内 `</script>` 截断问题**（凡人修仙把整页 HTML 塞进模板字符串，HTML 解析器会在此截断主脚本 → 按钮无监听）。用状态机跳过 JS 字符串/模板/注释里的字面 `</script`
- 高度脚本插在**最后一个** `</body>` 前，避免插进 JS 模板字符串

### 2.5 卡脚本运行时（tavernShim）

`tavernShim.ts` 提供最小酒馆助手兼容层：
- `window.TavernHelper.generate / stopAllGeneration`
- `triggerSlash`（`/send 文本|/trigger` 管道解析）
- `eventOn / eventEmit`（iframe 内与父页各一份事件总线）
- 通过 `parent.TavernHelper` 或 `postMessage({liyuanTriggerSlash})` 与父页通信
- **明确不提供"写正文"通道**（安全边界）

### 2.6 皮肤正则服务端处理（cardfront / cardSkin）

- `cardfront.ts`：从卡 raw 提取 `regex_scripts`，筛出"显示向美化规则"（`!disabled && placement 含 2 && !(promptOnly && !markdownOnly)`），生成 `CardFrontSnapshot {enabled, hasSkin, rules, charName, userName}`
- 快照通过 **WS hello 帧同帧下发**（`helloFrame` 里带 `cardfront`），首屏不依赖二次 REST
- server wire 在消息发出前套 `prepareDisplayText(text, skin)`，把 `{{char}}/{{user}}` 展开、替换显示正则 → 消息 text 已是 HTML
- `cardSkin.ts`：纯函数正则替换，支持捕获组、`{{match}}`、`$1` 展开；单条规则失败静默跳过

## 三、DrawDream 与梨园的差距对比

| 维度 | DrawDream（当前） | 梨园 | 差距 |
|---|---|---|---|
| HTML 渲染模型 | 消息 HTML 进 CardHtmlFrame，脚本需 bridge 回写 | 消息 HTML 进 iframe，脚本在 iframe 内自管 UI | **根本差异** |
| 沙箱 sandbox | `allow-scripts`（opaque origin） | `allow-scripts allow-same-origin allow-forms allow-modals allow-popups` | 无法用 IndexedDB/localStorage |
| CSP script-src | `'unsafe-inline'` | `'unsafe-inline' 'unsafe-eval' https: http: data: blob:` | 无法拉 CDN / 用 eval |
| CSP connect-src | `'self' http://127.0.0.1:*` | `https: http: ws: wss: data: blob:` | 无法访问外部 API |
| 程序卡高度 | 固定/内容量 | 检测 program app → 78vh | 全屏 UI 被裁切 |
| 脚本 `</script>` 截断 | 未处理 | 状态机修复 | 主脚本被截断 |
| 皮肤正则 | 仅 runtimeManifest 静态分析，未应用 | server wire 层应用 + 前端应用 | 卡皮肤从未显示 |
| 脚本执行宿主 | 隐藏 iframe + bridge 回写 | 消息 iframe 即宿主 | 渲染结果落不到 UI |

## 四、推荐方案

### 核心决策：从"适配 React 渲染"切换到"卡自管 UI"

放弃当前"隐藏运行时帧 + `setChatMessages` 回写 HTML"的间接方案，改为梨园式**"消息 HTML 直接进 iframe 全权渲染"**。

### 4.1 渲染链路改造（前端）

```
服务端 wire 层：
  narrative 消息 → prepareDisplayText(text, skin)   // 应用卡显示正则（新增）

前端 ChatPage renderBubble：
  消息 text
    → splitRichContentParts(text, skin)   // 新增：text/html/status 段
    → html 段 → <HtmlFrame html scripts seamless />   // 新增组件
    → text 段 → 现有 Paragraphs/RichMessage
    → status 段 → <StatusPanel />   // 可选，优先 html
```

### 4.2 新增/改造文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/components/HtmlFrame.tsx` | 新增 | 梨园 HtmlFrame 移植：seamless/scripts/programApp 高度/源码查看 |
| `src/utils/htmlEmbed.ts` | 改造 | 补 `findFencedHtmlDocument`（首闭+末闭认领）、`looksLikeHtmlMarkup`、`splitTopLevelBlocks`、`isFullInterface` |
| `src/components/CardHtmlFrame.tsx` | 改造 | 脚本帧 sandbox 加 `allow-same-origin allow-forms allow-modals allow-popups`；CSP 放宽（unsafe-eval/https/http/blob/ws）；高度策略对齐 |
| `src/tavern/compat/tavern-shim.ts` | 新增 | 梨园 tavernShim 移植：TavernHelper.generate/triggerSlash/eventOn/eventEmit，接到 tavernRuntime |
| `src/tavern/compat/cardfront.ts` | 新增 | 皮肤规则提取 + `prepareDisplayText` + `applyCardSkin`（纯函数，server/前端共用） |
| `src/utils/richContentParts.ts` | 新增 | `splitRichContentParts` 顺序：皮肤 → HTML 段 → 状态块 → 文本 |
| `src/components/ExtensionFrame.tsx` | 改造 | CSP 对齐放宽 |

### 4.3 服务端改造

| 文件 | 动作 | 说明 |
|---|---|---|
| `agent/src/cardfront.ts` | 新增 | 从卡 raw 提取显示向 regex_scripts，生成 CardFrontSnapshot |
| `agent/src/cardSkin.ts` | 新增 | `prepareDisplayText` + `applyCardSkin`（纯函数） |
| `agent/server/wire.ts` | 改造 | hello 帧带 `cardfront`；narrative 消息发前套 `prepareDisplayText(text, skin)` |
| `agent/src/card-runtime.ts` | 改造 | 复用 cardfront 提取，避免两套逻辑 |

### 4.4 安全权衡（关键决策）

**当前 DrawDream 的安全模型**：卡脚本在 opaque origin 的 iframe 运行，完全无法访问父页。但这导致脚本无法使用 IndexedDB/Dexie/localStorage，大量卡初始化失败。

**梨园的取舍**：脚本帧同源（`allow-same-origin`），卡脚本理论上能读父页 DOM。梨园接受此风险，理由是：
1. 卡代码只在浏览器沙箱内运行，不落本机
2. 垫片**不提供改正文通道**（`triggerSlash`/`generate` 只能发消息，不能改历史）
3. 卡作者的可信度假设与 ST 相同

**建议 DrawDream 对齐梨园**：脚本帧加 `allow-same-origin`，但保持：
- CSP 仍 `default-src 'none'`，仅放宽 script/connect/img/font/media/worker 的源
- `frame-src 'none'` 禁止卡内嵌 iframe 导航
- 保留 capability token + frameId 校验的 bridge 协议（不向卡暴露 DrawDream 内部 API）
- 不提供写正文通道（梨园同样不提供）

### 4.5 分阶段实施

**阶段 A（最小可行，跑通整楼界面）**
1. 移植 `HtmlFrame` 组件 + 放宽 CSP + sandbox 加 same-origin
2. 移植 `escapeScriptEndTags` 修复 `</script>` 截断
3. 移植 `looksLikeProgramApp` + 78vh 高度
4. ChatPage `renderBubble` 的 html channel 改用 `HtmlFrame`（传 runtimeManifest 保持 bridge）

**阶段 B（皮肤正则）**
5. 移植 `cardfront.ts` / `cardSkin.ts`，server wire 层套 `prepareDisplayText`
6. `richContentParts.ts` 前端切分
7. hello 帧带 cardfront

**阶段 C（卡脚本运行时）**
8. 移植 `tavernShim.ts`，接到 tavernRuntime / sessionStore
9. 隐藏运行时帧改为消息内 iframe 直接执行卡脚本

## 五、验收标准

1. 安装含"整楼界面"（position:fixed + 100vh）的程序卡，打开聊天即显示完整 UI，不被裁切
2. 卡内表单/按钮交互可用，点击事件正常触发
3. 卡脚本可用 IndexedDB/Dexie/localStorage（不再 SecurityError）
4. 状态栏皮肤正则（`<StatusBlock>` 等）在消息上正确渲染
5. 卡脚本可拉取 CDN 库（https）
6. 卡内 `</script>` 模板字符串不再截断主脚本
7. 安全边界：卡脚本不能改历史消息、不能访问 DrawDream 内部状态

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| allow-same-origin 后卡脚本可读父页 DOM | 保持 CSP 严格 + 不提供写正文通道 + capability token 校验 |
| CSP 放宽后卡可外连 | frame-src 'none' + connect 白名单（https/http 已是梨园基线） |
| 78vh 高度误判（状态栏被锁高） | 复用梨园 `looksLikeProgramApp` 判据 + 内容盒高度上报回退 |
| 服务端套皮肤正则影响送模历史 | 只在显示层（wire 输出）套，送模走 cleanAssistantText 原始文本（与梨园一致） |
| 大改造回归风险 | 分阶段，每阶段过 release gate |
