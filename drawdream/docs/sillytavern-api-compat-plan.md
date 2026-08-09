# SillyTavern 原生 API 兼容层复刻计划

版本：`v2.0.0-alpha.1-mobile.52`
日期：2026-08-02
参考：PureTavern `847c042` (AGPL-3.0) + SillyTavern 原生 API 路由

## 一、现状复盘

### 1.1 已实现的兼容部分

#### 兼容契约矩阵（10/10 契约，22 fixture）

| 契约 ID | 域 | 状态 | 实现位置 |
|---|---|---|---|
| `characters.card-runtime` | 角色卡 | partial | `agent/server/rest/routes/cards.ts` |
| `chats.jsonl-import-export` | 聊天记录 | partial | `src/agent/rest.ts` |
| `world-books.entries` | 世界书 | partial | `agent/server/rest/routes/lore.ts` |
| `presets.prompt-pipeline` | 预设 | partial | `agent/server/rest/routes/presets.ts` |
| `generation.lifecycle-events` | 生成事件 | fixture-covered | `agent/server/story-subscribe.ts` |
| `extensions.legacy-hook` | 扩展 | partial | `agent/server/rest/routes/extensions.ts` |
| `assets.card-relative` | 资源 | supported | `src/tavern/card-assets.ts` |
| `import-export.archive` | 导入导出 | partial | `src/agent/rest.ts` |
| `events.tavern-runtime` | 事件 | fixture-covered | `src/tavern/kernel/event-bus.ts` |
| `runtime.card-ui` | 卡片 UI | partial | `src/components/CardHtmlFrame.tsx` |

#### iframe 沙箱运行时（两套独立帧）

| 帧 | 协议 | 组件 | 引导脚本 |
|---|---|---|---|
| 卡片 HTML 帧 | `drawdream-tavern-frame` | `CardHtmlFrame` | `cardBridgeBootstrapScript` |
| 扩展帧 | `drawdream-extension-frame` | `ExtensionFrame` | `extensionBridgeBootstrap` |

两套帧共享同一个 `tavernRuntime` 单例（`runtime-adapter.ts`），通过 postMessage bridge 通信。

#### API facade 覆盖

- **TavernHelper**：`getVariables`/`updateVariables`/`getChatMessages`/`setChatMessages`/`triggerSlash`/`generate`/`getWorldBooks`/`getPresets`/`getCharacter`/`injectPrompt`/`speak`
- **SillyTavern**：`getContext`/`substituteParams`/`eventSource.on`/`event_types`
- **TavernFrame**：`getContext`/`getVariables`/`patchVariables`/`setVariableSchema`/`resolveAsset`/`authorizeModule`/`dom`
- **DrawDreamExtension**：`capabilities`/`request`/`on`/`resize`

#### 扩展运行时

- ZIP 安装（纯 Node.js 解析器，不依赖外部 unzip）
- URL 安装（GitHub/GitLab/Direct ZIP）
- 已知扩展识别（JS-Slash-Runner、ST-Prompt-Template 标记 runnable）
- iframe `sandbox="allow-scripts"` 隔离执行
- CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`

#### DrawDream 自有 REST API（14 个路由文件，~130 个端点）

DrawDream 已有完整的自有命名空间 API（`/api/cards`、`/api/sessions`、`/api/lorebooks`、`/api/presets`、`/api/extensions` 等），但**路径风格与 SillyTavern 原生 API 完全不同**。

### 1.2 当前渲染链路的核心问题

#### 问题链路图

```
角色卡 PNG/JSON
  → agent/src/card-runtime.ts buildTavernRuntimeManifest()
  → extensions.tavern_helper.scripts → extensionScripts[]
  → CardResponse.runtimeManifest (下发到前端)
  → Chat.tsx fetchCardRuntime(cardPath) → runtimeManifest
  → 渲染隐藏 CardHtmlFrame (scripts=true, runtimeManifest)
  → iframe 内注入 cardBridgeBootstrapScript + extensionScripts 代码
  → 脚本执行 → 注册 message_received 事件监听
  → 新消息到达 → runtime-adapter 触发 message_received
  → 脚本获取消息 → 生成美化 HTML
  → TavernHelper.setChatMessages({html: ...})
  → runtime-adapter message.update → patchMessageLocal
  → session-store 更新 messages 数组
  → React 重新渲染 → renderBubble → CardHtmlFrame 渲染 HTML
```

#### 已修复的断裂点

| 断裂点 | 修复版本 | 修复方式 |
|---|---|---|
| 能力校验用错变量 | mobile.52 | `capabilities` → `effectiveCapabilities` |
| 消息写回无本地通道 | mobile.52 | 新增 `patchMessageLocal(id, {text, html})` |
| message.update 不支持 html | mobile.52 | 提取 html 字段，使用 patchMessageLocal |
| RichMessage 与 CardHtmlFrame 同时渲染 | mobile.52 | 添加 `!m.html` 条件 |
| htmlEmbed 不识别 class= div | mobile.52 | 正则匹配 style= 或 class= |
| runtimeManifest 未接线 | mobile.51 | ChatPage 调用 fetchCardRuntime |
| extensionScripts 代码未注入 | mobile.51 | CardHtmlFrame 注入 extractExtensionScriptCode |
| message_received 事件未触发 | mobile.51 | runtime-adapter syncSession 检测消息变化 |
| app_ready 事件未触发 | mobile.50 | ready 请求后延迟 150ms 触发 |

#### 仍然存在的根本问题

**DrawDream 没有实现 SillyTavern 原生 API 路由**。许多 SillyTavern 扩展和卡内脚本直接通过 `fetch('/api/characters/all')`、`fetch('/api/chats/get')`、`fetch('/api/settings/get')` 等 HTTP 请求访问数据，而这些端点在 DrawDream 中不存在。扩展和脚本拿到 404 后静默失败，导致 UI 不渲染。

### 1.3 PureTavern 的 API 路由清单（从源码提取）

PureTavern 完整复刻了 SillyTavern 原生 API，共 **13 个 feature 模块**，通过 `CompatibilityRouter` 注册路由。以下是完整端点清单：

#### 核心路由（register-core-routes.ts）

| Method | Path | 说明 |
|---|---|---|
| GET | `/csrf-token` | CSRF token |
| GET | `/version` | 版本信息 |
| POST | `/api/ping` | 心跳 |
| GET | `/api/users/me` | 当前用户 |
| POST | `/api/users/get` | 用户列表 |
| GET | `/api/extensions/discover` | 扩展发现（placeholder） |
| POST | `/api/horde/status` | Horde 状态（placeholder） |
| POST | `/api/horde/text-models` | Horde 模型（placeholder） |
| POST | `/api/chats/recent` | 最近聊天（placeholder） |
| POST | `/api/characters/all` | 角色列表（placeholder） |
| POST | `/api/groups/all` | 群组列表（placeholder） |
| POST | `/api/avatars/get` | 头像列表（placeholder） |
| POST | `/api/worldinfo/list` | 世界书列表（placeholder） |
| POST | `/api/backgrounds/all` | 背景列表（placeholder） |
| POST | `/api/backgrounds/folders` | 背景文件夹（placeholder） |
| POST | `/api/image-metadata/all` | 图片元数据（placeholder） |

#### characters 模块（12 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/characters/all` | 列出所有角色 |
| POST | `/api/characters/get` | 获取单个角色 |
| POST | `/api/characters/chats` | 角色的聊天列表 |
| POST | `/api/characters/create` | 创建角色 |
| POST | `/api/characters/rename` | 重命名角色 |
| POST | `/api/characters/edit` | 编辑角色 |
| POST | `/api/characters/edit-avatar` | 编辑头像 |
| POST | `/api/characters/edit-attribute` | 编辑属性 |
| POST | `/api/characters/merge-attributes` | 合并属性 |
| POST | `/api/characters/delete` | 删除角色 |
| POST | `/api/characters/duplicate` | 复制角色 |
| POST | `/api/characters/import` | 导入角色 |
| POST | `/api/characters/export` | 导出角色 |

#### chats 模块（8 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/chats/save` | 保存聊天 |
| POST | `/api/chats/get` | 获取聊天 |
| POST | `/api/chats/rename` | 重命名聊天 |
| POST | `/api/chats/delete` | 删除聊天 |
| POST | `/api/chats/export` | 导出聊天 |
| POST | `/api/chats/import` | 导入聊天 |
| POST | `/api/chats/search` | 搜索聊天 |
| POST | `/api/chats/recent` | 最近聊天 |

#### settings 模块（5 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/settings/get` | 获取设置 |
| POST | `/api/settings/save` | 保存设置 |
| POST | `/api/settings/get-snapshots` | 快照列表 |
| POST | `/api/settings/load-snapshot` | 加载快照 |
| POST | `/api/settings/make-snapshot` | 创建快照 |
| POST | `/api/settings/restore-snapshot` | 恢复快照 |

#### world-books 模块（5 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/worldinfo/list` | 列出世界书 |
| POST | `/api/worldinfo/get` | 获取世界书 |
| POST | `/api/worldinfo/edit` | 编辑世界书 |
| POST | `/api/worldinfo/delete` | 删除世界书 |
| POST | `/api/worldinfo/import` | 导入世界书 |

#### presets 模块（3+5 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/presets/save` | 保存预设 |
| POST | `/api/presets/delete` | 删除预设 |
| POST | `/api/presets/restore` | 恢复预设 |
| POST | `/api/themes/save` | 保存主题 |
| POST | `/api/themes/delete` | 删除主题 |
| POST | `/api/quick-replies/save` | 保存快捷回复 |
| POST | `/api/quick-replies/delete` | 删除快捷回复 |
| POST | `/api/moving-ui/save` | 保存移动 UI |

#### extensions 模块（8 端点）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/extensions/discover` | 扩展发现 |
| POST | `/api/extensions/install` | 安装扩展 |
| POST | `/api/extensions/version` | 扩展版本 |
| POST | `/api/extensions/update` | 更新扩展 |
| POST | `/api/extensions/branches` | 分支列表 |
| POST | `/api/extensions/switch` | 切换分支 |
| POST | `/api/extensions/move` | 移动范围 |
| POST | `/api/extensions/delete` | 删除扩展 |

#### assets 模块（~30 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/files/sanitize-filename` | 文件名净化 |
| POST | `/api/files/upload` | 上传文件 |
| POST | `/api/files/delete` | 删除文件 |
| POST | `/api/files/verify` | 验证文件 |
| POST | `/api/images/upload` | 上传图片 |
| POST | `/api/images/list` | 图片列表 |
| POST | `/api/images/folders` | 图片文件夹 |
| POST | `/api/images/delete` | 删除图片 |
| POST | `/api/backgrounds/all` | 背景列表 |
| POST | `/api/backgrounds/folders` | 背景文件夹 |
| POST | `/api/backgrounds/upload` | 上传背景 |
| POST | `/api/backgrounds/rename` | 重命名背景 |
| POST | `/api/backgrounds/delete` | 删除背景 |
| POST | `/api/image-metadata/` | 图片元数据 |
| POST | `/api/image-metadata/all` | 全部图片元数据 |
| POST | `/api/image-metadata/cleanup` | 清理元数据 |
| POST | `/api/image-metadata/folders/*` | 文件夹操作（6 端点） |
| POST | `/api/avatars/get` | 头像列表 |
| POST | `/api/avatars/upload` | 上传头像 |
| POST | `/api/avatars/delete` | 删除头像 |
| GET | `/api/sprites/get` | 精灵列表 |
| POST | `/api/sprites/upload` | 上传精灵 |
| POST | `/api/sprites/upload-zip` | 上传精灵 ZIP |
| POST | `/api/sprites/delete` | 删除精灵 |
| POST | `/api/assets/get` | 库资源 |
| POST | `/api/assets/download` | 下载资源 |
| POST | `/api/assets/delete` | 删除资源 |
| POST | `/api/assets/character` | 角色资源 |
| POST | `/api/content/importURL` | URL 导入 |

#### generation 模块（3 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/backends/chat-completions/status` | 模型列表 |
| POST | `/api/backends/chat-completions/generate` | 生成 |
| POST | `/api/backends/chat-completions/bias` | bias 映射 |

#### stats 模块（3 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/stats/get` | 获取统计 |
| POST | `/api/stats/update` | 更新统计 |
| POST | `/api/stats/recreate` | 重建统计 |

#### secrets 模块（7 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/secrets/write` | 写入密钥 |
| POST | `/api/secrets/read` | 读取密钥状态 |
| POST | `/api/secrets/view` | 查看活跃密钥 |
| POST | `/api/secrets/find` | 查找密钥 |
| POST | `/api/secrets/delete` | 删除密钥 |
| POST | `/api/secrets/rotate` | 轮换密钥 |
| POST | `/api/secrets/rename` | 重命名密钥 |
| POST | `/api/secrets/settings` | 密钥设置 |

#### import-export 模块（~15 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/backups/archive/inspect` | 检查归档 |
| POST | `/api/backups/archive/export` | 导出归档 |
| POST | `/api/backups/archive/import/preview` | 预览导入 |
| POST | `/api/backups/archive/import` | 导入归档 |
| POST | `/api/backups/archive/local/*` | 本地备份操作（6 端点） |
| POST | `/api/backups/tauritavern/*` | TauriTavern 互通（4 端点） |
| POST | `/api/backups/chat/*` | 聊天备份（3 端点，placeholder） |

#### tokenizers 模块（~40 端点）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/tokenizers/{alias}/encode` | 编码（16 个 alias） |
| POST | `/api/tokenizers/{alias}/decode` | 解码（16 个 alias） |
| POST | `/api/tokenizers/openai/count` | 消息计数 |
| POST | `/api/tokenizers/remote/kobold/count` | Kobold 计数 |
| POST | `/api/tokenizers/remote/textgenerationwebui/encode` | TGWUI 编码 |

**总计：约 140 个 SillyTavern 原生 API 端点**

## 二、复刻计划

### 2.1 设计原则

1. **Clean-room 实现**：基于 PureTavern 公开路由清单和行为契约，不拷贝源码
2. **DrawDream 适配器模式**：每个 SillyTavern 端点内部委托 DrawDream 自有 API/数据层
3. **保留 Agent 特性**：WebSocket 协议、SessionManager、MVU、Agent 工作流不变
4. **POST 风格优先**：SillyTavern 原生 API 大量使用 POST + JSON body（非 RESTful），复刻层保持一致
5. **安全边界不变**：扩展 iframe 仍 `sandbox="allow-scripts"`，CSP 不放宽
6. **渐进式实现**：按优先级分阶段，先核心数据读写，再高级功能

### 2.2 架构设计

```
扩展 iframe / 卡内脚本
  ↓ fetch('/api/characters/all', {method:'POST'})
  ↓
DrawDream Agent HTTP Server (port 7620)
  ↓
sillytavern-compat.ts (新路由文件)
  ├── 适配 DrawDream 数据层
  ├── 返回 SillyTavern 格式响应
  └── 不修改 DrawDream 自有 API
```

新增路由文件：`agent/server/rest/routes/sillytavern-compat.ts`

路由分发器 `routes.ts` 修改：为 SillyTavern 原生路径添加专用处理器，在 DrawDream 自有 `/api/*` 路由之前匹配。

### 2.3 分阶段实施

#### 阶段一：核心数据读写（P0 — 卡内脚本依赖的基础 API）

**目标**：让卡内脚本和扩展能读取角色、聊天、设置、世界书数据

| 端点 | DrawDream 适配源 | 优先级 |
|---|---|---|
| `POST /api/characters/all` | `GET /api/cards` → 转换格式 | P0 |
| `POST /api/characters/get` | `GET /api/cards/detail` → 转换格式 | P0 |
| `POST /api/characters/chats` | `GET /api/sessions?card=...` → 转换格式 | P0 |
| `POST /api/chats/get` | `GET /api/sessions/export` → JSONL 解析 | P0 |
| `POST /api/chats/recent` | `GET /api/sessions` → 转换格式 | P0 |
| `POST /api/settings/get` | `GET /api/config` + `GET /api/agent-config` → 合并 | P0 |
| `POST /api/settings/save` | `PUT /api/config` → 转换格式 | P0 |
| `POST /api/worldinfo/list` | `GET /api/lorebooks` → 转换格式 | P0 |
| `POST /api/worldinfo/get` | `GET /api/lorebook` → 转换格式 | P0 |
| `POST /api/presets/save` | `POST /api/presets/saveas` → 转换格式 | P0 |
| `POST /api/presets/delete` | `DELETE /api/presets` → 转换格式 | P0 |
| `GET /api/extensions/discover` | 返回已安装扩展列表 | P0 |
| `POST /api/extensions/install` | `POST /api/extensions/install-url` → 转换 | P0 |
| `POST /api/extensions/delete` | 删除扩展目录 | P0 |
| `GET /csrf-token` | 返回固定 token | P0 |
| `GET /version` | 返回 DrawDream 版本信息 | P0 |
| `POST /api/ping` | 返回空 | P0 |
| `GET /api/users/me` | 返回默认用户 | P0 |
| `POST /api/users/get` | 返回用户列表 | P0 |
| `POST /api/horde/status` | 返回 `{ok:false}` | P0 |
| `POST /api/groups/all` | 返回 `[]` | P0 |

#### 阶段二：聊天与角色写操作（P1）

**目标**：支持扩展创建/编辑/删除聊天和角色

| 端点 | DrawDream 适配源 | 优先级 |
|---|---|---|
| `POST /api/chats/save` | 写入会话存储 | P1 |
| `POST /api/chats/rename` | `POST /api/sessions/rename` | P1 |
| `POST /api/chats/delete` | `DELETE /api/sessions` | P1 |
| `POST /api/chats/export` | `GET /api/sessions/export` → 格式转换 | P1 |
| `POST /api/chats/import` | `POST /api/import` (JSONL) | P1 |
| `POST /api/chats/search` | `GET /api/sessions/search` | P1 |
| `POST /api/characters/create` | `POST /api/cards/import` | P1 |
| `POST /api/characters/rename` | 编辑卡名称 | P1 |
| `POST /api/characters/edit` | `PUT /api/card` → 转换 | P1 |
| `POST /api/characters/delete` | `DELETE /api/cards` | P1 |
| `POST /api/characters/duplicate` | 复制卡文件 | P1 |
| `POST /api/characters/import` | `POST /api/cards/import` | P1 |
| `POST /api/characters/export` | `GET /api/card/export` | P1 |
| `POST /api/worldinfo/edit` | `PUT /api/lorebook/entry` | P1 |
| `POST /api/worldinfo/delete` | `DELETE /api/lorebooks` | P1 |
| `POST /api/worldinfo/import` | `POST /api/lorebooks/import` | P1 |
| `POST /api/presets/restore` | `POST /api/preset/revert` | P1 |

#### 阶段三：资源与头像（P2）

**目标**：支持扩展访问图片、背景、头像、精灵等资源

| 端点 | DrawDream 适配源 | 优先级 |
|---|---|---|
| `POST /api/avatars/get` | 返回用户头像列表 | P2 |
| `POST /api/avatars/upload` | `POST /api/upload` | P2 |
| `POST /api/avatars/delete` | 删除头像文件 | P2 |
| `POST /api/backgrounds/all` | 返回背景列表（可空） | P2 |
| `POST /api/images/list` | 返回用户图片列表 | P2 |
| `POST /api/images/upload` | `POST /api/upload` | P2 |
| `POST /api/files/upload` | `POST /api/upload` | P2 |
| `POST /api/files/delete` | 删除文件 | P2 |
| `GET /api/sprites/get` | 返回精灵列表（可空） | P2 |
| `POST /api/assets/get` | 返回库资源（可空） | P2 |

#### 阶段四：生成后端与统计（P3）

**目标**：兼容 SillyTavern 生成 API 和统计

| 端点 | DrawDream 适配源 | 优先级 |
|---|---|---|
| `POST /api/backends/chat-completions/status` | `GET /api/models` → 转换 | P3 |
| `POST /api/backends/chat-completions/generate` | WebSocket prompt → 转换 | P3 |
| `POST /api/backends/chat-completions/bias` | 返回空映射 | P3 |
| `POST /api/stats/get` | 返回空统计 | P3 |
| `POST /api/stats/update` | 忽略 | P3 |
| `POST /api/stats/recreate` | 忽略 | P3 |

#### 阶段五：密钥、快照、归档（P4）

**目标**：完整兼容剩余 API

| 端点 | DrawDream 适配源 | 优先级 |
|---|---|---|
| `POST /api/secrets/read` | 返回已配置 channel key 状态 | P4 |
| `POST /api/secrets/find` | 返回 channel key | P4 |
| `POST /api/secrets/write` | 写入 channel key | P4 |
| `POST /api/secrets/delete` | 删除 channel key | P4 |
| `POST /api/settings/get-snapshots` | 返回空 | P4 |
| `POST /api/settings/make-snapshot` | 忽略 | P4 |
| `POST /api/settings/load-snapshot` | 忽略 | P4 |
| `POST /api/settings/restore-snapshot` | 忽略 | P4 |
| `POST /api/backups/*` | 返回空/placeholder | P4 |
| `POST /api/tokenizers/*` | 近似计数（按 4 char/token） | P4 |
| `POST /api/themes/*` | 忽略 | P4 |
| `POST /api/quick-replies/*` | 忽略 | P4 |
| `POST /api/moving-ui/save` | 忽略 | P4 |
| `POST /api/extensions/version` | 返回已安装版本 | P4 |
| `POST /api/extensions/update` | 重新安装 | P4 |
| `POST /api/extensions/branches` | 返回 main | P4 |
| `POST /api/extensions/switch` | 忽略 | P4 |
| `POST /api/extensions/move` | 忽略 | P4 |

### 2.4 数据格式转换

SillyTavern 和 DrawDream 的数据模型差异较大，需要格式转换层：

#### 角色卡格式

```typescript
// SillyTavern → DrawDream
function stCharacterToDrawDream(stChar: SillyTavernCharacter): DrawDreamCard {
  return {
    path: stChar.avatar,
    name: stChar.name,
    description: stChar.description,
    firstMes: stChar.first_mes,
    // ...
  }
}

// DrawDream → SillyTavern
function drawDreamToStCharacter(card: DrawDreamCard): SillyTavernCharacter {
  return {
    avatar: card.path,
    name: card.name,
    description: card.description,
    first_mes: card.firstMes,
    // ...
  }
}
```

#### 聊天格式

```typescript
// SillyTavern chat JSONL → DrawDream messages
function stChatToMessages(stChat: SillyTavernChat): DrawDreamMessage[] {
  return stChat.messages.map(msg => ({
    role: msg.is_user ? 'user' : 'assistant',
    text: msg.mes,
    name: msg.name,
    // ...
  }))
}
```

#### 设置格式

```typescript
// DrawDream config → SillyTavern settings
function drawDreamToStSettings(config: DrawDreamConfig): SillyTavernSettings {
  return {
    power_user: { ... },
    extension_settings: { ... },
    // ...
  }
}
```

### 2.5 路由分发器修改

`routes.ts` 中添加 SillyTavern 兼容路由的优先匹配：

```typescript
// SillyTavern 原生路径前缀列表
const ST_COMPAT_PREFIXES = [
  '/api/characters',
  '/api/chats',
  '/api/settings',
  '/api/worldinfo',
  '/api/presets',
  '/api/themes',
  '/api/quick-replies',
  '/api/moving-ui',
  '/api/extensions',
  '/api/backends',
  '/api/stats',
  '/api/secrets',
  '/api/backups',
  '/api/tokenizers',
  '/api/files',
  '/api/images',
  '/api/backgrounds',
  '/api/image-metadata',
  '/api/avatars',
  '/api/sprites',
  '/api/assets',
  '/api/content',
  '/api/groups',
  '/api/horde',
  '/api/users',
  '/csrf-token',
  '/version',
  '/api/ping',
]

function isStCompatPath(urlPath: string): boolean {
  return ST_COMPAT_PREFIXES.some(prefix => 
    urlPath === prefix || urlPath.startsWith(prefix + '/')
  )
}
```

### 2.6 安全考量

1. **不暴露 DrawDream 内部端点**：兼容层是独立适配器，不修改 DrawDream 自有 API
2. **密钥安全**：`/api/secrets/*` 只返回 key 是否存在，不返回真实值（遵循 guardrail 规则）
3. **CSP 不变**：iframe 仍 `sandbox="allow-scripts"`，不添加 `allow-same-origin`
4. **路径安全**：所有文件操作经过路径校验，防止路径穿越
5. **大小限制**：上传文件仍受 `MAX_UPLOAD` 限制

## 三、实施步骤

### Step 1: 创建路由文件骨架

创建 `agent/server/rest/routes/sillytavern-compat.ts`，注册到 `routes.ts`。

### Step 2: 实现核心数据读取（阶段一）

实现 21 个 P0 端点，重点是将 DrawDream 数据格式转换为 SillyTavern 格式。

### Step 3: 测试卡内脚本渲染

安装一个使用 SillyTavern API 的美化卡片，验证：
- `fetch('/api/characters/get')` 返回正确数据
- `fetch('/api/chats/get')` 返回聊天记录
- `fetch('/api/settings/get')` 返回设置
- 卡内脚本基于这些数据生成美化 HTML

### Step 4: 实现写操作（阶段二）

实现 17 个 P1 端点，支持扩展创建/编辑/删除数据。

### Step 5: 实现资源 API（阶段三）

实现 10 个 P2 端点，支持图片/头像/背景操作。

### Step 6: 实现生成与统计（阶段四）

实现 6 个 P3 端点，兼容生成后端 API。

### Step 7: 实现剩余 API（阶段五）

实现剩余 P4 端点，达到完整兼容。

### Step 8: 集成测试

- 安装 JS-Slash-Runner 扩展，验证全部 API 调用
- 安装使用 SillyTavern API 的美化卡片，验证渲染
- 运行 release gate 测试
- 真机 Android 验证

## 四、验收标准

1. **卡内美化脚本渲染**：安装含 `tavern_helper.scripts` 的角色卡后，聊天界面显示美化 UI
2. **扩展 API 兼容**：JS-Slash-Runner 扩展的所有 `fetch` 调用不返回 404
3. **数据一致性**：通过兼容 API 读取的数据与 DrawDream 自有 API 读取的数据一致
4. **安全边界**：密钥不泄露，路径不穿越，CSP 不放宽
5. **Release gate 通过**：TypeScript、构建、兼容矩阵测试全部通过

## 五、风险与缓解

| 风险 | 缓解 |
|---|---|
| 格式转换不完整导致脚本异常 | 渐进式实现，先返回最小可用数据，逐步完善 |
| SillyTavern API 行为与文档不一致 | 参考 PureTavern 源码行为，以实际扩展调用为准 |
| 性能影响（额外路由匹配） | 使用前缀快速匹配，避免线性扫描 |
| 安全风险（暴露内部数据） | 兼容层只读优先，写操作需校验，密钥不返回真实值 |
