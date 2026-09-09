import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  root: 'src',
  plugins: [
    {
      name: 'html-version-sync',
      transformIndexHtml(html) {
        return html.replaceAll('__APP_VERSION__', pkg.version);
      }
    }
  ],
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version)
  },
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
