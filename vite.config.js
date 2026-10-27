import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const WHISPER_CPP_VERSION = process.env.WHISPER_CPP_VERSION || 'v1.7.4';
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

function expandHtmlIncludes(html, baseDir) {
  let content = html;
  const regex = /<!--\s*@include\s+['"]([^'"]+)['"]\s*-->/g;
  let depth = 0;
  const MAX_DEPTH = 10;
  while (regex.test(content) && depth++ < MAX_DEPTH) {
    content = content.replace(regex, (_, relPath) => {
      const target = resolve(baseDir, relPath);
      if (existsSync(target)) {
        return readFileSync(target, 'utf-8');
      }
      console.warn(`[html-include] File not found: ${target}`);
      return '';
    });
  }
  if (depth >= MAX_DEPTH && regex.test(content)) {
    console.warn('[html-include] Maximum include depth exceeded, possible circular include detected.');
  }
  return content;
}

export default defineConfig({
  root: 'src',
  plugins: [
    {
      name: 'html-modular-bundle',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const expanded = expandHtmlIncludes(html, srcDir);
          return expanded
            .replaceAll('__APP_VERSION__', pkg.version)
            .replaceAll('__WHISPER_CPP_VERSION__', WHISPER_CPP_VERSION);
        }
      },
      configureServer(server) {
        server.watcher.add([
          resolve(srcDir, 'views'),
          resolve(srcDir, 'components')
        ]);
        let reloadTimer = null;
        const triggerReload = () => {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            server.ws.send({ type: 'full-reload', path: '*' });
          }, 50);
        };
        server.watcher.on('all', (event, file) => {
          if (
            (event === 'add' || event === 'change' || event === 'unlink') &&
            file.endsWith('.html') &&
            !file.endsWith('index.html')
          ) {
            triggerReload();
          }
        });
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
