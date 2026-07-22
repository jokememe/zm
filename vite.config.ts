import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const LLM_TARGET = process.env.VITE_LLM_PROXY_TARGET || 'http://38.244.63.197:15511'

export default defineConfig({
  plugins: [vue()],
  // GitHub Pages 项目站才设 /zm/；Vercel 根路径用 ./
  base:
    process.env.GITHUB_PAGES === 'true' || process.env.VITE_BASE
      ? process.env.VITE_BASE || '/zm/'
      : './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 与 Vercel /api/chat、/api/models 对齐
      '/api/chat': {
        target: LLM_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: () => '/v1/chat/completions',
      },
      '/api/models': {
        target: LLM_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: () => '/v1/models',
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api/chat': {
        target: LLM_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: () => '/v1/chat/completions',
      },
      '/api/models': {
        target: LLM_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: () => '/v1/models',
      },
    },
  },
})
