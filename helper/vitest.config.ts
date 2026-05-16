import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.{test,spec}.ts',
      'src/**/*.{test,spec}.tsx',
      'tests/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.tsx'
    ],
    passWithNoTests: true
  }
});
