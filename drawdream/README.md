<div align="center">

<a href="https://github.com/RochelimitDawn/DrawDreamMAX">
  <img src="./public/brand/logo-wordmark.svg" alt="DrawDream" width="360" height="162" />
</a>

# DrawDream

**方寸之间，绘梦天地**

绘梦 UI + 内嵌 DrawDream Agent · **Alpha 2.0**（`2.0.0-alpha.1`）  
**主交付：安卓本地 Node APK** · 当前发布线 **`v2.0.0-alpha.1-mobile.62`** · 单端口 **7620**

[![GitHub stars](https://img.shields.io/github/stars/RochelimitDawn/DrawDreamMAX?style=for-the-badge&logo=github)](https://github.com/RochelimitDawn/DrawDreamMAX/stargazers)
[![License PolyForm NC](https://img.shields.io/badge/License-PolyForm_NC-f59e0b?style=for-the-badge)](../LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)
![Port](https://img.shields.io/badge/Port-7620-6366f1?style=flat-square)
![Platform](https://img.shields.io/badge/Primary-Android-3DDC84?style=flat-square&logo=android&logoColor=white)

</div>

---

## 说明

当前仓库以 `mobile.62` 作为唯一稳定版本。产品维护围绕桌面/平板设置体验、酒馆兼容渲染、卡内 UI 全量渲染和移动端主流程进行。

本目录同时包含：

| 路径 | 角色 |
| --- | --- |
| `src/` → `dist/` | 手机 WebView 中的 UI（含工坊 `/novel-forge`、资料库 `/library`、卡库 `/cards`） |
| `agent/` | 手机内嵌 Node 上的 Agent 运行时（含 `/api/forge/*`） |
| `mobile/` | Android 壳与 runtime 打包 |

三者缺一不可。桌面 `npm run dev` 用于构建 UI 与联调 Agent，**产品主线是 APK**。

规范：[docs/MOBILE.md](../docs/MOBILE.md) · [mobile/README](./mobile/README.md) · 根 [README](../README.md)

---

## 快速开始（联调）

```bash
cp agent/drawdream.agent.example.json agent/drawdream.agent.json
cp agent/drawdream.config.example.json agent/drawdream.config.json
# 填写 apiKey / provider / model

npm install && npm run agent:install
npm run dev
```

→ http://127.0.0.1:7620

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | build UI → Agent |
| `npm run dev:watch` | + vite watch |
| `npm run build` | 输出 `dist/` |
| `npm run start` | 仅启动 Agent |
| `npm run agent:install` | Agent 依赖 |
| `npm run release:gate` | 发布门禁：类型、兼容测试、构建、Android 静态检查 |
| `npm run compat:report` | 生成 PureTavern 兼容矩阵报告 |
| `npm run mobile:prepare` | 组装 runtime + inject |
| `npm run mobile:smoke` | 桌面冒烟 |
| `npm run lint` | oxlint |

| 变量 | 默认 |
| --- | --- |
| `PORT` | `7620` |
| `HOST` | `0.0.0.0` |
| `DRAWDREAM_UI_DIST` | 本目录 `dist/` |

---

## 结构

```text
drawdream/
├── public/brand/        # logo · favicon
├── src/                 # React UI（进 APK）
│   ├── pages/
│   ├── components/
│   └── agent/           # REST · WS · session-store · RP 解析
├── agent/               # DrawDream Agent（进 APK）
│   ├── server/
│   ├── src/
│   └── packages/
├── mobile/              # 安卓壳与 runtime 打包
│   ├── README.md
│   ├── scripts/
│   └── android/
├── scripts/
└── package.json         # 2.0.0-alpha.1-mobile.62
```

```text
:7620  ─►  /* dist    /api/* REST    /ws Wire
```

---

## 路由与数据

| 路径 | 页面 | 来源 |
| --- | --- | --- |
| `/` · `/cards` | 角色卡 | `/api/cards` |
| `/cards/:id` | 详情 | `/api/cards/detail` … |
| `/chat` | 对话 | WS + 会话 API |
| `/settings` | 设置 | 渠道 / 模型 / config / 阅读 |
| `/world-info` | 世界书 | `/api/lorebooks` |
| `/persona` | 人设 | `/api/personas` |
| `/presets` | 预设 | `/api/presets` |
| `/plaza` | 广场 | 本地卡库 |

---

## 本版要点（mobile.62）

- **安装包大幅精简**：移动端运行时树从 ~80MB 裁到 **17MB**——agent 全部依赖打包进单文件 `single.mjs`，不再携带 `node_modules`；APK 预计从 ~105MB 降到 ~40MB 级
- **环境工具链修正**：node 显示为「当前 Agent 运行时，恒可用」，不再误报缺失；bun/ffmpeg/python 保留 PATH 真实探测并加提示（termux 扩展需自行安装）
- **助手任务清单 UI**：`todo_write` 子任务清单实时展示（勾选动画/删除线/完成烟花，暖金主题），`assistant_todo` 帧刷新
- **记忆双路检索**：`memory_search` 向量+词法双路（配 embedding 模型自动启用，否则降级词法）；每轮摘要自动固化进记忆；「记忆宫」更名「记忆」
- **设置页「环境」分页**：运行时/端口/工作区、磁盘占用、工具链探测（`GET /api/environment`）
- **Agent 单文件打包**：`bundle-agent.mjs` 产出 14MB `single.mjs`（不依赖 node_modules）
- **抉择器改进**：抉择应答进正文；`option`/`free` 区分；停止本回合安全收尾
- **工具条汉化 + 去重**；**消息头像优化**；**模型失败可见**；**助手纯 markdown**
- 继承 mobile.53-61：卡内 UI iframe、ST 兼容层、设置页便当盒

兼容文档：

- [`docs/sillytavern-compatibility.md`](./docs/sillytavern-compatibility.md)
- [`docs/puretavern-compatibility-matrix.md`](./docs/puretavern-compatibility-matrix.md)
- [`docs/liyuan-render-plan.md`](./docs/liyuan-render-plan.md)
- [`docs/puretavern-attribution.md`](./docs/puretavern-attribution.md)

---

## 文档

- 移动端规范：[`docs/MOBILE.md`](../docs/MOBILE.md)
- 安卓构建：[`mobile/README.md`](./mobile/README.md)
- 内嵌边界：[`agent/EMBEDDED.md`](./agent/EMBEDDED.md)
- Agent 说明：[`agent/README.md`](./agent/README.md)
- 仓库总览：[根 README](../README.md)

---

## 致谢与版权

早期思路曾参考 [梨园 Liyuan](https://github.com/weidu12123/Liyuan) 的方向；**现行实现已全面自研重构**，由 DrawDream 独立维护。

许可证：**[PolyForm Noncommercial 1.0.0](../LICENSE)**（禁止商业用途）。
