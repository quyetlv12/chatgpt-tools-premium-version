import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1', port: 5151, strictPort: true,
    proxy: { '/modules': { target: 'http://127.0.0.1:5150', changeOrigin: true }, '/api': { target: 'http://127.0.0.1:5150', changeOrigin: true } },
  },
  preview: {
    host: '127.0.0.1', port: 4173, strictPort: true,
    proxy: { '/modules': { target: 'http://127.0.0.1:5150', changeOrigin: true }, '/api': { target: 'http://127.0.0.1:5150', changeOrigin: true } },
  },
})
