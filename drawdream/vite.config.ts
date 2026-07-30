import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 仅负责 UI 构建；运行时由内嵌 Agent 在 PORT（默认 7620）同源托管 dist + /api + /ws
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.monkeycode-ai.online'],
  },
  preview: {
    host: true,
    allowedHosts: ['.monkeycode-ai.online'],
  },
})
