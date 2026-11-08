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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (id.includes('/@mui/icons-material/')) return 'mui-icons';
          if (id.includes('/@mui/') || id.includes('/@emotion/')) return 'mui-vendor';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react-vendor';
          if (id.includes('/react-router')) return 'router-vendor';
        },
      },
    },
  },
});
