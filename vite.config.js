import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'esnext'
  },
  server: {
    port: 1420,
    strictPort: true,
    host: true,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        '..'
      ]
    }
  }
});
