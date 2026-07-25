import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // どのパス配下でも動くように相対パスでビルドする(GitHub Pages対応)
  base: './',
  plugins: [react()],
  // 開発時のみ: kenkoooo / atcoder.jp をdevサーバー経由(同一オリジン)で読ませて
  // CORSを回避する。本番は public/snapshot/ の静的データが土台なので不要
  // (api.ts / rating.ts 参照)。
  server: {
    proxy: {
      '/kenkoooo': {
        target: 'https://kenkoooo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kenkoooo/, ''),
      },
      '/atcoder': {
        target: 'https://atcoder.jp',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/atcoder/, ''),
      },
    },
  },
})
