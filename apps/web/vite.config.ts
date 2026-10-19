import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@zyvora/ui': path.resolve(import.meta.dirname, '../../packages/ui/src'),
      '@zyvora/types': path.resolve(
        import.meta.dirname,
        '../../packages/types/src',
      ),
    },
  },
});
