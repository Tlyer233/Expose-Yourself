import { defineConfig } from 'vite'       // Vite 的配置函数（vue.config.js 的等价物）
import react from '@vitejs/plugin-react'   // 让 Vite 能编译 React 的 JSX 语法
import tailwindcss from '@tailwindcss/vite' // 让 Vite 能处理 Tailwind v4 的 @import
import path from 'path'                   // Node.js 路径拼接（用于 resolve.alias）

// 后端端口：从环境变量读取，默认 9877（与 config.yaml 保持一致）
const backendPort = process.env.HERMES_PORT || '9877'

export default defineConfig({
  plugins: [react(), tailwindcss()],  // 启用这两个插件（相当于 Vue 的 plugins: [vue()]）

  // ── 路径别名（短路径 / short import path）─────────────
  // tsconfig.app.json 里配了 paths → 只给 TypeScript 编辑器/编译器 看
  // 这里配 alias           → 给 Vite 打包时 看
  // 两者缺一不可！tsconfig 负责类型检查，vite 负责实际打包
  // 效果：import xxx from '@/lib/api' → 实际指向 src/lib/api.ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'), // @/ → src/（等价于 Vue 的 @/ alias）
    },
  },

  // ═══════════════════════════════════════════════════════
  // server — 开发服务器配置
  // 仅在 npm run dev 时生效，npm run build 时完全忽略
  // ═══════════════════════════════════════════════════════
  server: {
    port: 5173,    // Vite dev server 监听的端口
    proxy: {        // 代理：把某些请求转发到另一个服务器
      '/api': {     // 所有以 /api 开头的请求
        target: `http://127.0.0.1:${backendPort}`, // 转发到后端 FastAPI（端口从环境变量读取）
        changeOrigin: true,              // 修改请求头 Origin（避免后端 CORS 校验拒绝）
      },
      '/plugins': { // 插件 UI 静态文件（iframe 加载）
        target: `http://127.0.0.1:${backendPort}`, // 同上，FastAPI 的 StaticFiles mount
        changeOrigin: true,
      },
    },
  },

  // ═══════════════════════════════════════════════════════
  // build — 构建（打包）配置
  // 仅在 npm run build 时生效
  // ═══════════════════════════════════════════════════════
  build: {
    outDir: 'dist',       // 构建产物放到哪个目录
    emptyOutDir: true,    // 每次构建前清空 dist（避免旧文件残留）
  },
})