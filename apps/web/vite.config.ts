import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  // Don't pre-bundle the workspace packages — serve them as live source so edits
  // to the engine/data hot-reload instead of needing a manual server restart.
  optimizeDeps: {
    exclude: ['@tactica/engine', '@tactica/data'],
  },
});
