import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: {
      // 只代理后端 API 路径，避免误把 /api-testing/... 这样的前端路由转发给 FastAPI。
      '/api/': 'http://127.0.0.1:8003',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
  },
});
