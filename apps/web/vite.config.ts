import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@zyvora/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@zyvora/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
});
