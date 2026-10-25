import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base "./" => works under any GitHub Pages path (https://<user>.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
} as any);
