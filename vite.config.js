import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const WHISPER_CPP_VERSION = process.env.WHISPER_CPP_VERSION || 'v1.7.4';

export default defineConfig({
  root: 'src',
  plugins: [
    {
      name: 'html-version-sync',
      transformIndexHtml(html) {
        return html
          .replaceAll('__APP_VERSION__', pkg.version)
          .replaceAll('__WHISPER_CPP_VERSION__', WHISPER_CPP_VERSION);
      }
    }
  ],
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
    '__WHISPER_CPP_VERSION__': JSON.stringify(WHISPER_CPP_VERSION)
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
