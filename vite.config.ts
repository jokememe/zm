import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  // GitHub Pages 项目站：https://jokememe.github.io/zm/
  // 本地 dev 不受影响；若改仓库名请同步改此路径
  base: process.env.GITHUB_PAGES === 'true' || process.env.VITE_BASE
    ? (process.env.VITE_BASE || '/zm/')
    : './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // 单 CSS：避免异步 chunk 样式晚到
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 单 JS 包：消灭跨 chunk 循环依赖导致的生产初始化 bug
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
})
