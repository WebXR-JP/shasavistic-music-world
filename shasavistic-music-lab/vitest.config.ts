import { defineConfig } from 'vitest/config';

// 検査は純粋な音声処理だけを対象とするため、本番用の Module Federation
// 設定（vite.config.ts）は読み込まない。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
