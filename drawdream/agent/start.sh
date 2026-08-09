#!/usr/bin/env bash
# DrawDream Agent — Linux / macOS launcher
# 推荐从上级 drawdream/ 使用 npm run start（含产品 UI dist）。
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7620}"
HOST="${HOST:-0.0.0.0}"
OPEN_BROWSER="${OPEN_BROWSER:-1}"
MIN_NODE_MAJOR=22

echo ""
echo "  ========================================"
echo "    DrawDream Agent"
echo "  ========================================"
echo ""

os_name="$(uname -s 2>/dev/null || echo unknown)"
is_macos=0
if [[ "$os_name" == "Darwin" ]]; then
  is_macos=1
fi

node_install_hint() {
  echo "         Install Node.js >= ${MIN_NODE_MAJOR}:"
  echo "         - https://nodejs.org/  (LTS / Current, pick >= ${MIN_NODE_MAJOR})"
  if [[ "$is_macos" -eq 1 ]]; then
    echo "         - Homebrew:  brew install node@${MIN_NODE_MAJOR}"
    echo "                      brew link --overwrite --force node@${MIN_NODE_MAJOR}"
  else
    echo "         - Linux: use NodeSource / nvm / distro packages for Node ${MIN_NODE_MAJOR}+"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found."
  node_install_hint
  exit 1
fi

NODE_VER="$(node -v 2>/dev/null || true)"
echo "[drawdream] Node ${NODE_VER}"

# Require major version >= MIN_NODE_MAJOR (e.g. v22.x.x)
major="$(echo "${NODE_VER#v}" | cut -d. -f1)"
if ! [[ "$major" =~ ^[0-9]+$ ]] || (( major < MIN_NODE_MAJOR )); then
  echo "[ERROR] Need Node.js >= ${MIN_NODE_MAJOR} (found ${NODE_VER:-unknown})."
  node_install_hint
  exit 1
fi

# First-run defaults (no personal keys)
if [[ ! -f drawdream.config.json && -f drawdream.config.example.json ]]; then
  echo "[drawdream] Creating drawdream.config.json from example ..."
  cp drawdream.config.example.json drawdream.config.json
fi
if [[ ! -f drawdream.agent.json && -f drawdream.agent.example.json ]]; then
  echo "[drawdream] Creating drawdream.agent.json from example ..."
  cp drawdream.agent.example.json drawdream.agent.json
  echo "[drawdream] Edit drawdream.agent.json and set your API key before chatting."
fi

if [[ ! -d node_modules ]]; then
  echo "[drawdream] node_modules missing — running npm install ..."
  echo "[drawdream] First run needs network; later starts are offline-ready."
  npm install
fi

# 产品 UI：上级 ../dist，或环境变量 DRAWDREAM_UI_DIST
if [[ -z "${DRAWDREAM_UI_DIST:-}" ]]; then
  if [[ -f ../dist/index.html ]]; then
    export DRAWDREAM_UI_DIST="$(cd .. && pwd)/dist"
  fi
fi
if [[ -n "${DRAWDREAM_UI_DIST:-}" ]]; then
  echo "[drawdream] UI dist: ${DRAWDREAM_UI_DIST}"
else
  echo "[drawdream] WARN: no UI dist (set DRAWDREAM_UI_DIST or build drawdream/ first)"
fi

# free port if busy (optional; ignore errors)
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pid}" ]]; then
    echo "[drawdream] Port ${PORT} in use, killing ${pid} ..."
    # shellcheck disable=SC2086
    kill ${pid} 2>/dev/null || true
    sleep 0.5
  fi
fi

export HOST PORT
LOCAL_URL="http://127.0.0.1:${PORT}"
echo "[drawdream] Starting ${LOCAL_URL}  (bind ${HOST}:${PORT})"
echo "[drawdream] Continues last session. New:  ./start.sh --new"
echo "[drawdream] Ctrl+C to stop."
echo ""

# Open browser shortly after server start (macOS open / Linux xdg-open)
if [[ "${OPEN_BROWSER}" != "0" ]]; then
  (
    sleep 2
    if [[ "$is_macos" -eq 1 ]] && command -v open >/dev/null 2>&1; then
      open "${LOCAL_URL}/" 2>/dev/null || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "${LOCAL_URL}/" 2>/dev/null || true
    fi
  ) &
fi

exec node server/main.ts "$@"
