// @ts-nocheck
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Loads an HTML file and recursively resolves all `<!-- @include "..." -->` comments.
 * Paths are resolved relative to the directory containing the file.
 * Defaults to resolving `src/index.html`.
 */
export function loadResolvedHtml(htmlFile: string = resolve(__dirname, 'index.html')): string {
  let content = readFileSync(htmlFile, 'utf-8');
  const regex = /<!--\s*@include\s+['"]([^'"]+)['"]\s*-->/g;
  let depth = 0;
  const MAX_DEPTH = 10;
  while (regex.test(content) && depth++ < MAX_DEPTH) {
    content = content.replace(regex, (_, relPath) => {
      const target = resolve(dirname(htmlFile), relPath);
      if (existsSync(target)) {
        return readFileSync(target, 'utf-8');
      }
      return '';
    });
  }
  return content;
}
