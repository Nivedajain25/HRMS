import os from 'node:os';
import path from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // Keep the dependency pre-bundle cache out of the (small) project drive.
  cacheDir: path.join(os.tmpdir(), 'stencil-hrms-vite'),
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:5000', changeOrigin: true },
      '/health': { target: process.env.VITE_API_PROXY ?? 'http://localhost:5000', changeOrigin: true },
    },
    fs: {
      // pnpm's virtual store may live outside the workspace (see .npmrc).
      allow: [searchForWorkspaceRoot(process.cwd()), 'C:/stencil-hrms-pnpm'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-table', 'axios', 'zustand'],
          charts: ['recharts'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
});
