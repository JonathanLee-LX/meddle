import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ command }) => ({
  // 仅在开发模式开启 DevTools，避免生产构建启动额外 worker/服务影响时长
  devtools: command === 'serve',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8989',
      '/ws': {
        target: 'ws://127.0.0.1:8989',
        ws: true,
      },
    },
  },
}))
