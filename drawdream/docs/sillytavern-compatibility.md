# SillyTavern 兼容规范

版本：`2.0.0-alpha.1-mobile.39`

## 目标

角色卡、聊天记录、Prompt Pipeline、TavernHelper、MVU 和原卡 UI 可以在 DrawDream 单一聊天界面中协同运行。兼容层优先保证原始数据可追溯、正文显示稳定和运行安全。

## 已支持

### 角色卡

- V1、V2、V3 JSON 角色卡
- PNG 内嵌 `chara` 与 `ccv3`
- `character_book` 基础世界书
- `first_mes`、`alternate_greetings`、`system_prompt`、`post_history_instructions`
- `data.extensions.regex_scripts` 的 snake_case 和 camelCase 字段

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

## MVU 策略

当前阶段把酒馆 MVU 数据作为原始 sidecar 保存，保证后续变量解释器可以读取完整来源数据。DrawDream 的 `WorldState` 不会被未知 MVU 字段强制覆盖，避免导入过程破坏既有剧情状态。

后续 MVU 实现将采用声明式 `get/set/add/append/merge` 操作、作用域隔离、revision 和消息级快照。任意 JavaScript、STscript 和 TavernHelper API 继续保持沙箱外。

## 安全边界

- 不执行卡内 JavaScript、STscript 或酒馆前端插件。
- 不调用 `window.parent.SillyTavern`、TavernHelper 或外部插件 API。
- HTML 内容使用受限 iframe；脚本能力需要独立 capability 策略。
- 导入原始数据进入 sidecar，不自动当作模型指令执行。
- 复杂正则脚本只保留并报告，避免 ReDoS 和不可重复副作用。

## 后续兼容阶段

1. MVU 声明式变量命令与宏
2. 消息级变量快照、swipe 分支和回档
3. 卡级 HTML/CSS capability manifest 与 CSP
4. bundle 导入、附件迁移和增量导入
5. 受控的安全 UI 数据绑定
