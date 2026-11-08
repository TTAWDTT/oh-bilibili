import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri 在开发期会打开 devUrl，端口必须固定，否则窗口会指向空页面。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    // macOS 的 WKWebView 跟随系统 Safari，锁定一个足够新的基线即可。
    target: 'safari18',
    sourcemap: false,
  },
})
