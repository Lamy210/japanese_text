import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

// Japanese Writing Toolkit — Vite設定
// 仕様書 §33/34: 初期bundleは軽量化し、重い機能(textlint等)はdynamic importで遅延ロード
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      // @textlint/ast-tester が node:assert を要求するため browser互換polyfillへ差し替える (§45)
      'node:assert': 'assert'
    }
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Editor Ready 目標 300KB gzip / Initial 150KB gzip (§34)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 初期chunkとeditor/worker/textlint chunkを分離し、サイズ計測可能にする (§53)
        manualChunks(id) {
          if (id.includes('@textlint/') || /textlint-rule-/.test(id)) {
            return 'textlint'
          }
          if (id.includes('@codemirror/') || id.includes('@lezer/')) {
            return 'editor'
          }
          if (id.includes('solid-js')) {
            return 'solid'
          }
          return undefined
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    // 依存スキャンをアプリ本体に限定 (skills/ 等の非ソース資産を除外)
    entries: ['index.html', 'src/**/*.ts', 'src/**/*.tsx', 'src/worker/*.ts']
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Core (§55: UI非依存) のユニットテスト。UI層はagent-browser E2Eで検証する
  }
})
