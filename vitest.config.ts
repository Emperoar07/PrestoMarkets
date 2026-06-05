import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Unit tests live under src/. The Hardhat contract tests (test/*.test.cjs) are run by
    // `hardhat test` (npm run test:contracts), which compiles artifacts first — vitest must not
    // pick them up or they fail with missing-artifact errors in CI.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'test/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/__tests__/**'],
    },
  },
});
