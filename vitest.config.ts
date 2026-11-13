import { defineConfig } from 'vitest/config';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * The integration tests need DATABASE_URL_TEST. It is read from .env when it is not
 * already in the environment. Nothing else from .env is passed to tests, so they cannot
 * reach the real database or call paid APIs by accident.
 */
function testDatabaseUrl(): Record<string, string> {
  if (process.env.DATABASE_URL_TEST) return {};
  const envFile = path.resolve(__dirname, '.env');
  if (!existsSync(envFile)) return {};
  const line = readFileSync(envFile, 'utf-8')
    .split('\n')
    .find((l) => l.trim().startsWith('DATABASE_URL_TEST='));
  if (!line) return {};
  const value = line.trim().slice('DATABASE_URL_TEST='.length).replace(/^["']|["']$/g, '');
  return value ? { DATABASE_URL_TEST: value } : {};
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    // SESSION_SECRET signs sign-in tokens; tests get a throwaway value, never the real one.
    env: { SESSION_SECRET: 'test-only-secret-not-used-anywhere-else', ...testDatabaseUrl() },
    // Increase timeout for integration tests that hit the database
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files share one database and empty its tables between tests, so they run one at a time.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
