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
    exclude: ['@tactica/engine', '@tactica/data', '@tactica/bots'],
  },
  server: {
    watch: {
      // With preserveSymlinks the workspace packages resolve through
      // node_modules/@tactica/*, which the watcher ignores by default — edits
      // to packages/*/json then serve STALE from the transform cache forever
      // (units.json kept resurrecting deleted units). Un-ignore them.
      ignored: ['!**/node_modules/@tactica/**'],
    },
  },
});
