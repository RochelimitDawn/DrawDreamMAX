# 内嵌 Agent 说明

本目录为 **DrawDream Agent** 源码内嵌副本，作为 DrawDream（绘梦）的 Agent 运行时与 RP 领域后端。

| 项 | 说明 |
|----|------|
| 产品品牌 | **DrawDream Agent** |
| 主许可证 | PolyForm Noncommercial 1.0.0（见本目录 `LICENSE`） |
| `packages/` | 相关包多为 MIT（见各包声明）；npm 作用域 `@drawdream/*` |
| 产品 UI | 绘梦前端位于上级 `../src`，构建产物为 `../dist`（旧 `web/` 已退役） |
| 默认端口 | `7620`（由上级启动脚本注入 `PORT` / `HOST` / `DRAWDREAM_UI_DIST`） |
| 配置 | 仅 `drawdream.agent.json` / `drawdream.config.json`、数据目录 `.drawdream-*`（无历史兼容迁移） |

---

## 职责边界

| 层级 | 位置 | 职责 |
|------|------|------|
| 产品壳 UI | `../src`、`../dist` | 品牌、路由、页面交互、i18n/主题 |
| 适配层 | `../src/agent` | 同源 REST / WebSocket 客户端与会话状态 |
| 本目录 | `server/`、`src/`、`packages/` | HTTP/WS、领域逻辑、Agent 运行时、持久化 |

本目录在 DrawDream 仓库中以 **内嵌维护** 方式演进：产品对外统一 DrawDream 品牌与路径命名。

---

## 配置

| 文件 | 用途 | 入库 |
|------|------|------|
| `drawdream.agent.example.json` | 提供商、模型、API Key 占位示例 | 是 |
| `drawdream.agent.json` | 本地密钥与默认模型 | 否 |
| `drawdream.config.example.json` | RP 默认项示例 | 是 |
| `drawdream.config.json` | 本地 RP 配置 | 否 |

```bash
# 在 drawdream/ 目录
cp agent/drawdream.agent.example.json agent/drawdream.agent.json
cp agent/drawdream.config.example.json agent/drawdream.config.json
# 编辑 agent/drawdream.agent.json，填写 apiKey 与模型 id
```

请勿将含真实密钥的配置提交版本库或对外分发。

---

## 启动（由绘梦上层驱动）

在 **`drawdream/`**（本目录的上一级）执行：

| 命令 | 行为 |
|------|------|
| `npm run dev` | 构建 UI → 本目录 `npm run web`，`DRAWDREAM_UI_DIST` 指向 `../dist` |
| `npm run start` | 已有 `dist/` 时仅启动本目录服务 |
| `npm run agent:install` | 安装本目录依赖 |

进程在单端口托管：

```text
/*          ← 绘梦 dist（DRAWDREAM_UI_DIST）
/api/*      ← REST
/ws         ← Wire
```

能力说明见本目录 `README.md`；多用户见 `MULTI_USER.md`。产品默认入口以仓库根与 `drawdream/README.md` 为准。

---

## 运行时数据目录（勿入库）

| 目录 | 用途 |
|------|------|
| `.drawdream-state/` | 状态账本 |
| `.drawdream-artifacts/` | Agent 面板产物 |
| `.drawdream-codex/` | 知识库 |
| `.drawdream-uploads/` | 素材 |
| `.drawdream-skills/` | 技能 |
| `.drawdream/` | 运行态（`extensions/` 等） |
| `data/` | 多用户 SQLite 与 `users/<id>/workspace` |

---

## 致谢

早期 harness 与 RP 领域设计参考 [梨园 DrawDream](https://github.com/weidu12123/DrawDream)。本仓库在其思路上做了大量魔改，现作为 **DrawDream Agent** 交付。详见仓库根 README 致谢一节。

---

## 相关文档

| 文档 | 路径 |
|------|------|
| 仓库总览 | `../../README.md` |
| 应用 README | `../README.md` |
| 多用户 | 本目录 `MULTI_USER.md` |
| Agent 能力 | 本目录 `README.md` |
