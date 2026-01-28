import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3100', changeOrigin: true },
      // WebSocket connects directly to port 3101 (see src/lib/websocket.ts)
    },
  },
});
