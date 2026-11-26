import { defineConfig } from 'vitest/config';

// Тесты чистой логики: окружение node, без браузера и сети.
// localStorage и window — простые заглушки из vitest.setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
