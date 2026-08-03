<div align="center">

<a href="https://github.com/RochelimitDawn/DrawDreamMAX">
  <img src="./public/brand/logo-wordmark.svg" alt="DrawDream" width="360" height="162" />
</a>

# DrawDream

**方寸之间，绘梦天地**

绘梦 UI + 内嵌 DrawDream Agent · **Alpha 2.0**（`2.0.0-alpha.1`）  
**主交付：安卓本地 Node APK** · 当前发布线 **`v2.0.0-alpha.1-mobile.60`** · 单端口 **7620**

[![GitHub stars](https://img.shields.io/github/stars/RochelimitDawn/DrawDreamMAX?style=for-the-badge&logo=github)](https://github.com/RochelimitDawn/DrawDreamMAX/stargazers)
[![License PolyForm NC](https://img.shields.io/badge/License-PolyForm_NC-f59e0b?style=for-the-badge)](../LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)
![Port](https://img.shields.io/badge/Port-7620-6366f1?style=flat-square)
![Platform](https://img.shields.io/badge/Primary-Android-3DDC84?style=flat-square&logo=android&logoColor=white)

</div>

---

## 说明

当前仓库以 `mobile.60` 作为唯一稳定版本。产品维护围绕桌面/平板设置体验、酒馆兼容渲染、卡内 UI 全量渲染和移动端主流程进行。

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
└── package.json         # 2.0.0-alpha.1-mobile.60
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

## 本版要点（mobile.60）

- **抉择器改进**：抉择应答作为 user 消息写入历史并广播进正文（不再只在抉择卡工具条一闪而过）；`choice_reply` 区分 `option`/`free`，`ask_director` 回传「用户选择」vs「用户自由发言」，自由输入不再被误判为选项；「停止本回合」不再粗暴 abort，改由终止型 toolResult 收尾，避免 tool_calls 无配对导致历史损坏、后续请求 400
- **助手 Plan 模式**：新增 `todo_write`/`todo_list` 工具（跨轮次持久子任务清单），助手系统提示词加入「任务拆解」纪律——长任务先拆子任务、逐步更新状态、不遗漏不重复
- **工具条汉化**：补齐 `world_read`（读取世界书）/`world_write`/`config_*`/`preset_*`/`models_list`/`skill_save`/`todo_*` 等中英文名
- **工具条去重**：前端折叠相邻「同工具同参数同结果」的重复调用，显示 ×N
- **消息头像优化**：去掉右下角金色圆点装饰，圆角 12→16px
- **手机端助手页遮挡修复**：右侧 sheet 高度改为 `calc(100dvh - 104px)`，不再与主对话顶栏重叠
- **模型失败可见**：修复自定义中转返回 401/404/400 时剧情与助手静默无输出——`agent_end` 检测失败消息并广播可见错误提示
- **助手侧栏纯 markdown**：`RichMessage` 新增 `mdOnly`，助手消息正文规避字体与 txt 框问题；保留工具调用过程条，消息头部新增复制按钮
- **卡内 UI 全量渲染修复**：提升 `MAX_REPLACEMENT` 到 256KB、显示层默认应用 `markdownOnly` 美化脚本
- 继承 mobile.53-59：卡内 UI iframe 渲染、皮肤正则、酒馆助手适配、ST 兼容层、设置页便当盒

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
