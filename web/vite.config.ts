import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  devtools: true,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 将 node_modules 中的库分离到 vendor chunks
          if (id.includes('node_modules')) {
            // Monaco 编辑器单独分离（较大）
            if (id.includes('@monaco-editor')) {
              return 'vendor-editor'
            }
            // dnd-kit 拖拽库
            if (id.includes('@dnd-kit')) {
              return 'vendor-dnd'
            }
            // radix-ui 和 lucide
            if (id.includes('@radix-ui') || id.includes('lucide-react')) {
              return 'vendor-ui'
            }
            // React 核心（保持与主 chunk 一起以减小体积）
            return 'vendor-react'
          }
          // settings-store 单独分离，避免动态/静态导入冲突
          if (id.includes('settings-store')) {
            return 'vendor-settings'
          }
        },
      },
    },
    // 警告阈值
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
})
