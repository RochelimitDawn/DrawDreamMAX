# DrawDream Agent — production image
# Build: docker build -t drawdream-agent:2.0.0-alpha.1 .
# Run:   docker run -d -p 7620:7620 -v drawdream-data:/root/.drawdream drawdream-agent:2.0.0-alpha.1
#
# 产品 UI 由上级 drawdream/ 构建并挂载 DRAWDREAM_UI_DIST；本镜像默认托管 web 兼容路径已移除，
# 请将 ../dist 挂到 /ui 或设置 DRAWDREAM_UI_DIST。
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer cache)
COPY package.json package-lock.json ./
COPY packages ./packages
# file: deps need package manifests present before npm install
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# App sources
COPY server ./server
COPY src ./src
COPY assets ./assets
COPY .drawdream/extensions ./.drawdream/extensions
COPY drawdream.config.example.json drawdream.agent.example.json ./
COPY start.sh ./

# Default configs inside image (override via volume / env mount)
RUN cp drawdream.config.example.json drawdream.config.json \
  && cp drawdream.agent.example.json drawdream.agent.json \
  && chmod +x start.sh

ENV HOST=0.0.0.0
ENV PORT=7620
ENV NODE_ENV=production

EXPOSE 7620

CMD ["node", "server/main.ts"]
