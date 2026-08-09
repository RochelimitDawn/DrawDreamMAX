#!/usr/bin/env bash
# 仓库根兼容入口：等价于在 drawdream/ 执行 npm run dev（单端口 7620）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/drawdream"
exec npm run dev
