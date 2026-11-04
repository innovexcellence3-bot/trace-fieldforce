import { defineConfig } from 'vite';

/* UI ada di frontend/, hasil build ke frontend/dist (disajikan oleh server/index.js).
   Saat `npm run dev`, panggilan /api diteruskan ke server Node di port 8020. */
export default defineConfig({
  root: 'frontend',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5174,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.TRACE_PORT || 8020}`, changeOrigin: true } },
  },
});
