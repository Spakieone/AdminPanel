import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = String(process.env.VITE_BASE || env.VITE_BASE || '/webpanel/').trim() || '/webpanel/'
  const outDir = String(process.env.VITE_OUT_DIR || env.VITE_OUT_DIR || 'dist').trim() || 'dist'
  const botModuleApiTarget = String(process.env.VITE_BOT_MODULE_API_TARGET || env.VITE_BOT_MODULE_API_TARGET || 'http://localhost:7777').trim()

  return {
    base,
    plugins: [svgr(), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir,
      rollupOptions: {
        output: {
          manualChunks: {
            // Разделяем тяжелые зависимости
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'chart-vendor': ['chart.js', 'react-chartjs-2'],
            'ui-vendor': ['country-flag-icons'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
      sourcemap: false, // Отключаем source maps для продакшена
      minify: 'esbuild', // Используем esbuild вместо terser для скорости
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: false,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8888',
          changeOrigin: true,
        },
        '/adminpanel/api': {
          target: botModuleApiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
