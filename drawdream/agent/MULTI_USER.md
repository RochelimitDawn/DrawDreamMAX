# 多用户与服务端持久化

## 默认管理员

| 项 | 默认值 | 环境变量 |
|----|--------|----------|
| 用户名 | `admin` | `DD_ADMIN_USER` |
| 密码 | `DrawDream!Admin` | `DD_ADMIN_PASSWORD` |

首次登录后请立即在 **设置 → 账户** 修改密码。

## 常用环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `7620` | HTTP/WS 端口 |
| `DD_DATA_ROOT` | `<agent cwd>/data` | SQLite + 用户目录根 |
| `DD_ALLOW_REGISTER` | `true` | 是否开放自助注册 |
| `DD_BOOTSTRAP_TOKEN` | 空 | 非空时允许 `POST /api/admin/bootstrap` |
| `DD_UAPI_KEY` | 空 | UAPI Key 初始值（也可在设置→管理员配置） |
| `DD_UAPI_BASE` | `https://uapis.cn/api/v1` | UAPI 根地址 |
| `DRAWDREAM_UI_DIST` | 自动探测 | UI `dist` 绝对路径 |

## 登录设备与 UAPI

- **设置 → 登录设备**：查看设备名/浏览器/系统、公网 IP、归属地、登录与活跃时间，可注销会话
- 公网 IP 由**浏览器**调用 UAPI `GET /network/myip` 后上报（`POST /api/auth/sessions/geo`），避免服务端出口 IP 不准
- **设置 → 管理员 → UAPI**：开关、Base URL、API Key、标准/商业数据源
- 文档：https://uapis.cn/docs/api-reference/get-network-myip

## 数据布局

```text
data/
  drawdream.sqlite
  users/<userId>/workspace/   # 会话、记忆、角色卡、预设、世界书、人设…
```

## API 摘要

- `POST /api/auth/register` `{ username, password }`
- `POST /api/auth/login` / `logout` / `GET /api/auth/me`
- `GET|PUT /api/user/settings`
- `GET /api/admin/users`（需 admin Cookie）
- `PUT /api/admin/settings` `{ allowRegistration }`

Cookie 名：`dd_session`（HttpOnly）。

## 记忆隔离

记忆按 **sessionId** 隔离；新开对话不会继承旧对话记忆。

## 跨用户并发（UserRuntime 池）

进程内按用户懒创建独立 Agent runtime：不同用户可同时流式生成，帧只推送给本用户的 WebSocket。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DD_MAX_USER_RUNTIMES` | `20` | 同时驻留的用户 runtime 上限 |
| `DD_RUNTIME_IDLE_TTL_MS` | `1200000`（20min） | 无连接且非流式后回收 |
| `DD_RUNTIME_EVICT_INTERVAL_MS` | `60000` | 空闲扫描间隔 |

- `GET /healthz` → `{ ok, pool: { runtimes, maxRuntimes, connections } }`
- `GET /api/admin/runtime-stats`（admin）→ 含各用户连接/流式摘要
- 池满：REST `503` + `RUNTIME_POOL_FULL`；WS close `4413`
- 同一账号多设备共享一份 runtime（多端同步同一剧情会话）

## MonkeyCode 部署提示

```bash
export DD_ADMIN_USER=admin
export DD_ADMIN_PASSWORD='你的强密码'
export DD_ALLOW_REGISTER=true
npm run build && npm run start
```
