import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // どのパス配下でも動くように相対パスでビルドする(GitHub Pages対応)
  base: './',
  plugins: [react()],
})
