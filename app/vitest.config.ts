import { defineConfig } from 'vitest/config';

// Only the logic in src/lib is tested here; it has no React Native imports.
export default defineConfig({
  test: { environment: 'node', include: ['src/lib/**/*.test.ts'] },
});
