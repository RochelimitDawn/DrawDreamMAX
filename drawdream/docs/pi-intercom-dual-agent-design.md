# 双 Agent + 最小上下文 P2P 方案（设计）

参考：[pi-intercom RP fork](https://github.com/2722550596/pi-intercom)（`/connect` 双工、`send_message`、`deliverAsUser`、本地 IPC broker）。

目标：正文与结构化分轨；按角色最小切片投递，消除共享上下文带来的全知；降低 RP Token。

## 问题

1. 角色卡美化依赖结构化输出，但正文模型常漏标签 / 漏账本更新。
2. 单会话共享 world_state 与全历史 → 每个「角色视角」实质全知。
3. 每轮注入全量 `formatState` + 长历史 → Token 膨胀。

## 架构

| 轨 | 职责 | 上下文预算（目标） |
| --- | --- | --- |
| Narrative（正文） | 剧情、对白、ask_director、RP widget | 约 6k–12k：场景切片 + 近 2–3 轮 + 本视角 facts |
| Ledger（账本） | world_state / flags / inventory / relations 的 JSON patch | 约 2k–4k：正文增量 + 短 schema + 上一版摘要 |

- 两轨**独立会话**，不共享 message 历史。
- Ledger 为权威状态源；Narrative 只读「切片 / diff」。
- 投递参考 intercom：`send_message`（blocking | 留言）、`deliverAsUser` 回注最小 facts。

## 最小切片（省 Token）

**Narrative 入站**

- 当前 `location` + 一句 ambience
- 在场角色对本角色的可见 status / affinity（非全表）
- 本角色 inventory 相关条目
- 近 2–3 轮用户可见正文（可压缩）
- 本轮用户输入 + ask_director 结果

**Ledger 入站**

- 本轮 Narrative 可见正文（或 diff）
- 固定 JSON schema（字段说明，非示例灌水）
- 当前 state 的紧凑摘要（非 pretty 全量）

**禁止**

- 把全量 characters/flags/plot_threads 每轮塞进 Narrative system
- 多角色并行时广播「他处发生」的完整叙述

## 与现有代码的接缝

| 现状 | 改造方向 |
| --- | --- |
| `director.buildTurnInjection` → `formatState(state)` 全量 | 改为 `formatStateSlice(state, viewpoint)` |
| 正文同轮 `world_state_update` 工具 | Ledger 轨消费正文后写盘；正文可只读 `world_state_get` 切片 |
| 单 UserHost 单 story session | `ledgerMode: dual` 时第二 session + 进程内 broker |
| stagehand 助手 | 仍管配置/面板；不与 Ledger 混会话 |

## 协议草图（进程内即可，不必上 Unix socket 首版）

```text
Narrative.done(text)
  → broker.enqueue({ to: "ledger", body: text, mode: "nonblock" })
Ledger.run(patch)
  → saveState
  → broker.deliverAsUser("narrative", facts_slice)  // 可选，下轮注入
```

超时：Ledger 超时则保留旧 state + 后台 scribe 兜底（现有自动记账）。

## 分阶段

1. **Phase 0（文档/开关）**：`ledgerMode: single|dual`，默认 single。
2. **Phase 1**：`formatStateSlice` + 注入瘦身（立刻省 Token，无第二模型）。
3. **Phase 2**：独立 Ledger 调用（同进程 second complete），JSON patch 写盘。
4. **Phase 3**：多角色 viewpoint 路由 + P2P 仅场景内可见事件。
5. **Phase 4**（可选）：对齐 pi-intercom 多进程 `/connect` UX。

## 成功指标

- 单轮 prompt tokens 相对 mobile.24 基线下降 ≥ 40%（长线 RP）
- `world_state` 字段完整率不降（Ledger 或 scribe 兜底）
- 角色 A 上下文中不出现仅角色 B 可知的私密 flag 明文

## 非目标（首版）

- 跨设备网络 intercom
- 复刻 pi 终端 UI / Alt+M session 列表
- 恢复 TokUI 或方括号通用 DSL
