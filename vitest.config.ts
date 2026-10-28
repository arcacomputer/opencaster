import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { include: ['{apps,services,packages}/**/*.{test,spec}.{ts,tsx,mjs}', 'scripts/**/*.{test,spec}.mjs'] },
});
