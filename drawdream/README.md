<div align="center">

<a href="https://github.com/RochelimitDawn/DrawDreamMAX">
  <img src="./public/brand/logo-wordmark.svg" alt="DrawDream" width="360" height="162" />
</a>

# DrawDream

**方寸之间，绘梦天地**

绘梦 UI + 内嵌 DrawDream Agent · **Alpha 2.0**（`2.0.0-alpha.1`）  
**主交付：安卓本地 Node APK** · 当前发布线 **`v2.0.0-alpha.1-mobile.69`** · 单端口 **7620**

[![GitHub stars](https://img.shields.io/github/stars/RochelimitDawn/DrawDreamMAX?style=for-the-badge&logo=github)](https://github.com/RochelimitDawn/DrawDreamMAX/stargazers)
[![License PolyForm NC](https://img.shields.io/badge/License-PolyForm_NC-f59e0b?style=for-the-badge)](../LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)
![Port](https://img.shields.io/badge/Port-7620-6366f1?style=flat-square)
![Platform](https://img.shields.io/badge/Primary-Android-3DDC84?style=flat-square&logo=android&logoColor=white)

</div>

---

## 说明

当前仓库以 `mobile.69` 作为唯一稳定版本。产品维护围绕桌面/平板设置体验、酒馆兼容渲染、卡内 UI 全量渲染和移动端主流程进行。

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
└── package.json         # 2.0.0-alpha.1-mobile.69
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

## 本版要点（mobile.69）

- **更新日志 Markdown 渲染**：升级确认对话框的 Release notes 改为 Markdown 渲染（标题/列表/加粗/代码块/引用），不再是纯文本
- **更新下载进度条**：下载更新时弹框显示暖金进度条与百分比，下载完成后自动关闭并提示；私有仓库已公开，`releases/latest` 可正常读取
- 继承 mobile.68：思考强度显式探测；mobile.67 后的 UI 修正（便当盒左下角切角 + 同排卡片等高）

## 本版要点（mobile.68）

- **思考强度显式探测**：模型设置页新增「探测思考强度」按钮，默认探测默认模型的真实思考档位，成功即缓存并自动应用最低档，思考强度控件立即可用；不再依赖后台静默探测，渠道无 Key / 模型不支持思考 / 探测失败均有明确提示
- 继承 mobile.67：子 agent 结果聚合、设置页便当盒图标 + 左下角折角、向量模型折叠卡片、检查更新按钮响应式、升级对话框品牌化

- **子 agent 结果聚合**：主助手不再逐条接收子 agent 完成消息（避免产生多段对话），改为全部子 agent 终态后一次性汇总注入，由主助手整合进最终回复
- **检查更新按钮响应式**：手机端（≤899px）采用 Uiverse「learn-more」圆钮展开风格；平板/桌面（≥900px）保持便当盒按钮外观
- **升级对话框品牌化**：暖金描边 + 顶部光晕，下载徽章 + 版本号 chip + Release notes 卡片化
- **设置页便当盒升级**：所有便当盒卡片左上角新增主题小图标；卡片尺寸收紧；左下角改为向内折角异形卡片（其余圆角）
- **向量模型折叠卡片**：向量模型配置改为可折叠卡片，默认折叠，点击头部展开/收起
- 移除任务清单 / 子拓展折叠按钮右侧脉冲点
- 子拓展结果改为 Markdown 渲染、终态时长固定不再增长
- 继承 mobile.66：自动更新、对话框玻璃态、子拓展并行编排、向量模型独立配置、思考档位自动应用

- **自动更新**：通过 GitHub Releases API 检查新版本，启动后静默检查（有新版本才提示），设置页「关于」提供手动「检查更新」；下载 APK 并对照 SHA256SUMS.txt 校验后拉起系统安装器，确认对话框展示 Release notes
- 继承 mobile.65：子拓展并行编排、对话框玻璃态、向量模型独立配置、思考档位自动应用

- **子拓展（Subagent）并行编排**：助手可派发多个后台子 agent 并行执行独立子任务，复用任务清单面板实时展示状态（启动/执行/停滞/完成），结果自动回传主会话整合
- **对话框玻璃态升级**：主对话与助手对话框采用 LiveAgent 风格毛玻璃质感（半透明 + 背景模糊 + 顶部高光），圆角收窄为方框微圆角，扩大可读空间，保留原有胶囊展开动效
- **向量模型独立配置**：设置页新增独立"向量模型"区块（渠道 + 模型），与对话模型分开配置，对话模型列表自动排除向量模型
- **思考档位自动应用**：选中默认对话模型或切换模型时自动侦测可用档位并应用最低档（降低 token 消耗），完成有 Toast 提示；同一模型不重复侦测除非报错
- 修复：助手展开/折叠按钮改用清晰图标、工具调用条流式宽度对齐
- 继承 mobile.64：助手输入条贴底、头像暖金配色、思考强度自动探测、交错时间线、任务清单、向量记忆召回

- **助手输入条贴底**：助手面板改为 flex 列布局，消息流独占剩余空间并内部滚动，输入条在横屏/竖屏下始终贴底，不再遮挡消息或被挤出屏幕
- **空对话稳定贴底**：空状态自适应面板高度，输入条不再悬浮于屏幕中部
- **头像暖金配色**：消息/历史/顶部助手头像渐变统一为暖金（accent-gold → brand → brand-deep），生成中的 3D spinner 同步改暖金
- 继承 mobile.63：思考强度自动探测、交错时间线、任务清单、向量记忆召回、环境页概览条、联网搜索模式由用户决定

- **思考强度自动探测**：按渠道实际推理档位探测 off/low/medium/high，浮动面板快捷切换，历史消息按档位归档
- **思考/工具交错时间线**：`thinking` 段与工具调用按到达顺序交错展示，相邻重复工具折叠，过程更贴近 Monkey Code 风格
- **助手侧栏布局修复**：高瘦屏下输入栏不再被挤出、顶栏不再被推出屏幕
- **任务清单折叠**：`todo_write` 清单可折叠为单行，保留标题/进度/进行中徽标
- **处理中 3D spinner**：助手生成时卡片头像展示暖金双层旋转动画（reduced-motion 回退静态）
- **向量模型（Embedding）配置**：渠道可指定向量模型，记忆/世界书启用向量召回，留空回退纯词法
- **环境页优化**：参考 1Panel 增加运行时/端口/工具就绪/数据占用概览条与工具链状态圆点
- **联网搜索单路/多路修复**：搜索模式由用户设置决定，不再由模型自主选择
- 继承 mobile.62：单文件 agent 运行时（17MB）、环境工具链修正、任务清单、记忆双路检索

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
