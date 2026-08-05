import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → "./src/*" so tests can exercise app-route handlers.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    // Session signing fails closed when PRESTO_SESSION_SECRET is unset (there is deliberately no
    // committed fallback — a public literal would let anyone forge a session cookie). Tests that
    // exercise nonce/session signing need a real key, so supply a throwaway one here.
    env: { PRESTO_SESSION_SECRET: 'test-only-session-secret-not-used-anywhere-else' },
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
