import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment is sufficient — these are pure TypeScript
    // library functions (normalisation, validation, RDAP response
    // classification), not Astro components or browser code.
    environment: 'node',
    fsModuleCache: true,
    fsModuleCachePath: '.wrangler/vitest-module-cache',
    include: ['src/lib/domains/__tests__/**/*.test.ts', 'src/lib/payments/__tests__/**/*.test.ts', 'src/lib/accounts/__tests__/**/*.test.ts', 'src/lib/orders/__tests__/**/*.test.ts'],
  },
});
