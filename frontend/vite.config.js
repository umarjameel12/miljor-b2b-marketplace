import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Isolated browser acceptance must never proxy to another local app instance.
const isolatedPort = process.env.MILJOR_TEST_API_PORT;
const isolatedApi = process.env.NODE_ENV === 'test' && process.env.DB_NAME === 'miljor_test_db' && isolatedPort;
if (isolatedApi && (!/^[1-9]\d{3,4}$/.test(isolatedPort) || Number(isolatedPort) > 65535)) throw new Error('Invalid isolated API port');
const apiTarget = isolatedApi ? `http://127.0.0.1:${isolatedPort}` : 'http://localhost:5000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || apiTarget,
        changeOrigin: true,
      },
    },
  },
})
