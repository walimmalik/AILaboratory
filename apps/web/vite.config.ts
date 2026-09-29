import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
});
