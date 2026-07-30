# DrawDream Agent 部署

本目录脚本面向将 **DrawDream**（含内嵌 Agent）部署到 Linux / Docker。配置主名：`drawdream.agent.json` / `drawdream.config.json`。

## 方式 A：一键安装脚本（systemd / 后台进程）

> 仓库若为 **private**：`raw.githubusercontent.com` 不可匿名下载，请先 `git clone` 后本地执行，或用带 token 的 raw URL。

```bash
# 推荐：克隆本仓库后本地执行
git clone --depth 1 https://github.com/RochelimitDawn/DrawDreamMAX.git /opt/drawdream
cd /opt/drawdream/drawdream
bash agent/deploy/install.sh --dir /opt/drawdream-agent --port 7620 --start
```

要求：Linux、Node.js ≥ 22、curl、git。

装好后：

```bash
# 填 API Key
nano agent/drawdream.agent.json

# 启动（产品壳）
npm run agent:install
npm run build
npm run start
```

## 方式 B：Docker Compose

在 `drawdream/agent` 目录：

```bash
git clone --depth 1 https://github.com/RochelimitDawn/DrawDreamMAX.git
cd DrawDreamMAX/drawdream/agent
mkdir -p data/cards data/lorebooks data/config
cp drawdream.agent.example.json data/config/drawdream.agent.json
cp drawdream.config.example.json data/config/drawdream.config.json
# 编辑 data/config/drawdream.agent.json 填入 apiKey
docker compose up -d --build
# 打开 http://服务器IP:7620
```

停止 / 清理：

```bash
docker compose down
# 连数据一起删：
docker compose down -v
```

## 方式 C：手动（开发机 / 小私服）

```bash
cd drawdream
cp agent/drawdream.agent.example.json agent/drawdream.agent.json
cp agent/drawdream.config.example.json agent/drawdream.config.json
npm install && npm run agent:install
npm run build
npm run start
```

默认端口 `7620`。多用户数据见 [../MULTI_USER.md](../MULTI_USER.md)。

## 致谢

早期独立部署脚本与 systemd 思路参考 [梨园 Liyuan](https://github.com/weidu12123/Liyuan)；当前交付路径以 DrawDreamMAX 仓库为准。
