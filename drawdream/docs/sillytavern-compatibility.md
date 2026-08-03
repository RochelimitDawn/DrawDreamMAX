# SillyTavern 兼容规范

版本：`2.0.0-alpha.1-mobile.59`

## 目标

角色卡、聊天记录、Prompt Pipeline、TavernHelper、MVU、扩展运行时和原卡 UI 可以在 DrawDream 单一聊天界面中协同运行。兼容层优先保证原始数据可追溯、正文显示稳定和运行安全。

## 已支持

### 角色卡

- V1、V2、V3 JSON 角色卡
- PNG 内嵌 `chara` 与 `ccv3`
- `character_book` 基础世界书
- `first_mes`、`alternate_greetings`、`system_prompt`、`post_history_instructions`
- `data.extensions.regex_scripts` 的 snake_case 和 camelCase 字段
- Runtime Manifest：entrypoints、uiModules、CSP、mobile 能力和 card fingerprint

### 显示美化

`regex_scripts` 支持显示和 Prompt placement、捕获组、trimStrings、`markdownOnly`、`promptOnly`、`runOnEdit`、深度范围和执行 trace。无效规则按条隔离，保留其余输出。

DrawDream 自有 Markdown、RP DSL 和受控 TavernFrameHost 负责最终显示。卡内脚本通过 capability token、frameId 和受控 Bridge 访问 Context、变量、消息、事件、资源和 DOM surface。

### 聊天记录

聊天页“导入酒馆”支持 SillyTavern JSONL。导入流程为：

```text
JSONL 解析 -> 正文清洗 -> rp-import 消息 -> 当前会话显示 -> 继续对话
```

每条消息的 sidecar 保留：

- `send_date`
- `extra`
- `variables`
- `metadata`
- `swipes`
- `swipe_id`
- 原始 `mes`

### 生成与事件

- `generation start/retry/end`
- 结果：`completed` / `aborted` / `failed`
- 严格递增 `sequence`
- 非递减 `sessionRevision`
- 中间工具轮 activity
- 最终消息按 stream ID 原子替换

### TavernHelper / MVU / Prompt

- Context、变量、消息、事件、资源、slash
- generate、worldbook、preset、character、inject、audio
- MVU scope、revision、schema、原子提交和路径安全
- Prompt section 顺序：system → character → persona → world info → history → agent → depth → author note → post-history

### 扩展运行时

- `/extensions` 页面安装 ZIP 并在受控 iframe 中启动
- `POST /api/extensions/install`、`GET /api/extensions`、`GET /api/extensions/file`
- Legacy API facade：`SillyTavern` / `TavernHelper`
- PureTavern 内置扩展：
  - `js-slash-runner-4.8.19`（酒馆助手）`runnable`
  - `st-prompt-template-1.16`（Prompt Template）`runnable`

报告：

```bash
npm run compat:report
npm run bundled-extension:report
```

## 安全边界

- 扩展脚本只在 `sandbox="allow-scripts"` iframe 中执行
- CSP 默认 `default-src 'none'`，限制 connect/img/script/style
- 每个扩展实例使用独立 frameId 和 token
- 外部模块要求 HTTPS、声明和用户显式授权
- 未知 API 返回 `RUNTIME_CAPABILITY_UNAVAILABLE`
- Node Agent 进程不直接执行第三方 JavaScript
- 导入原始数据进入 sidecar，不自动当作模型指令执行

## 边界说明

完整兼容指公开入口、核心 facade 和资源链路可运行。依赖原版 SillyTavern 页面 DOM 选择器或 parent window 深层对象图的扩展，仍可能出现 UI 布局差异；这类调用会通过结构化错误降级，主聊天 UI 保持可用。

PureTavern 参考与 AGPL-3.0 归属见 [`puretavern-attribution.md`](./puretavern-attribution.md)。
