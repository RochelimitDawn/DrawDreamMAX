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
  build: {
    // 拆分大型 vendor 依赖为独立 chunk：利于 HTTP 缓存（vendor 不变时命缓存）与并行加载
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-router')) return 'react'
          if (id.includes('node_modules/gsap') || id.includes('node_modules/@gsap')) return 'motion'
          if (id.includes('node_modules/katex')) return 'math'
          if (id.includes('node_modules/lucide-react')) return 'icons'
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'i18n'
          return undefined
        },
      },
    },
  },
})
