#!/usr/bin/env bash
# DrawDream Agent — 一键安装（Linux）
# 用法：
#   bash install.sh [--dir /opt/drawdream-agent] [--port 7620] [--ref main] [--start]
#
# 环境变量（可选）：
#   DRAWDREAM_DIR   安装目录，默认 /opt/drawdream-agent
#   DRAWDREAM_PORT  端口，默认 7620
#   DRAWDREAM_REF   git 标签/分支，默认 main
#   DRAWDREAM_REPO  仓库 URL
set -euo pipefail

REPO_DEFAULT="https://github.com/RochelimitDawn/DrawDreamMAX.git"
DIR="${DRAWDREAM_DIR:-/opt/drawdream-agent}"
PORT="${DRAWDREAM_PORT:-7620}"
REF="${DRAWDREAM_REF:-main}"
REPO="${DRAWDREAM_REPO:-$REPO_DEFAULT}"
SERVICE_NAME="${DRAWDREAM_SERVICE:-drawdream-agent}"
DO_START=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --start) DO_START=1; shift ;;
    --no-start) DO_START=0; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "[drawdream] unknown arg: $1"; exit 1 ;;
  esac
done

log() { echo "[drawdream] $*"; }
die() { echo "[drawdream] ERROR: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "需要命令: $1"
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [[ "$major" -ge 22 ]]; then
      log "Node $(node -v) OK"
      return 0
    fi
    log "Node $(node -v) 过旧（需要 >= 22），尝试安装 Node 22..."
  else
    log "未找到 Node，尝试安装 Node 22..."
  fi
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    die "无法自动安装 Node，请先安装 Node.js >= 22"
  fi
  command -v node >/dev/null 2>&1 || die "Node 安装失败"
  log "Node $(node -v)"
}

need_cmd curl
need_cmd git
install_node_if_missing
need_cmd npm

log "安装目录: $DIR"
log "版本/分支: $REF"
log "端口: $PORT"

mkdir -p "$(dirname "$DIR")"
if [[ -d "$DIR/.git" ]]; then
  log "已有 git 仓库，拉取 $REF ..."
  git -C "$DIR" fetch --tags --force origin
  git -C "$DIR" checkout -f "$REF" 2>/dev/null || git -C "$DIR" checkout -f "origin/$REF"
  git -C "$DIR" pull --ff-only 2>/dev/null || true
else
  if [[ -d "$DIR" ]] && [[ -n "$(ls -A "$DIR" 2>/dev/null || true)" ]]; then
    die "目录非空且不是 git 仓库: $DIR（请换目录或清空）"
  fi
  log "克隆 $REPO ($REF) ..."
  git clone --depth 1 --branch "$REF" "$REPO" "$DIR" \
    || { git clone --depth 1 "$REPO" "$DIR" && git -C "$DIR" checkout "$REF"; }
fi

# 优先使用 monorepo 内 drawdream/agent
AGENT_DIR="$DIR"
if [[ -d "$DIR/drawdream/agent" ]]; then
  AGENT_DIR="$DIR/drawdream/agent"
  APP_DIR="$DIR/drawdream"
else
  APP_DIR=""
fi

cd "$AGENT_DIR"

if [[ ! -f drawdream.config.json && -f drawdream.config.example.json ]]; then
  cp drawdream.config.example.json drawdream.config.json
fi
if [[ ! -f drawdream.agent.json && -f drawdream.agent.example.json ]]; then
  cp drawdream.agent.example.json drawdream.agent.json
  log "已生成 drawdream.agent.json — 请填入 API Key"
fi

log "npm install (agent) ..."
npm install --omit=dev --no-audit --no-fund

if [[ -n "$APP_DIR" && -f "$APP_DIR/package.json" ]]; then
  log "构建产品 UI ..."
  (cd "$APP_DIR" && npm install --no-audit --no-fund && npm run build) || log "UI 构建跳过/失败，可稍后手动 npm run build"
  if [[ -f "$APP_DIR/dist/index.html" ]]; then
    export DRAWDREAM_UI_DIST="$APP_DIR/dist"
  fi
fi

# systemd unit（可选，有权限时；服务名可用 --service 区分多实例）
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
if [[ "$(id -u)" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
  log "写入 systemd: $UNIT"
  UI_ENV=""
  if [[ -n "${DRAWDREAM_UI_DIST:-}" ]]; then
    UI_ENV="Environment=DRAWDREAM_UI_DIST=${DRAWDREAM_UI_DIST}"
  fi
  cat > "$UNIT" <<EOF
[Unit]
Description=DrawDream Agent (${SERVICE_NAME})
After=network.target

[Service]
Type=simple
WorkingDirectory=$AGENT_DIR
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
$UI_ENV
ExecStart=$(command -v node) server/main.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service"
  if [[ "$DO_START" -eq 1 ]]; then
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${PORT}/tcp" 2>/dev/null || true
    fi
    systemctl restart "${SERVICE_NAME}.service"
    sleep 2
    systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
  fi
  log "管理: systemctl status|restart|stop ${SERVICE_NAME}"
else
  log "非 root 或无 systemd — 跳过服务注册"
  if [[ "$DO_START" -eq 1 ]]; then
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${PORT}/tcp" 2>/dev/null || true
    fi
    nohup env HOST=0.0.0.0 PORT="$PORT" ${DRAWDREAM_UI_DIST:+DRAWDREAM_UI_DIST="$DRAWDREAM_UI_DIST"} \
      node server/main.ts >>"$AGENT_DIR/drawdream.log" 2>&1 &
    echo $! > "$AGENT_DIR/drawdream.pid"
    log "已后台启动 PID=$(cat "$AGENT_DIR/drawdream.pid") 日志 $AGENT_DIR/drawdream.log"
  fi
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "完成。访问: http://${IP:-localhost}:$PORT"
log "配置 API: 编辑 $AGENT_DIR/drawdream.agent.json"
