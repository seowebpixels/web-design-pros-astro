import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment is sufficient — these are pure TypeScript
    // library functions (normalisation, validation, RDAP response
    // classification), not Astro components or browser code.
    environment: 'node',
    include: ['src/lib/domains/__tests__/**/*.test.ts'],
  },
});
