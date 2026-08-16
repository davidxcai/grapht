/**
 * Module hooks that let a plain `node scripts/test-*.mjs` import the app's own
 * `lib/` modules unchanged.
 *
 * Two things the bundler does for free and Node does not:
 *
 *   - `@/lib/x` — the `paths` alias from tsconfig.json. `lib/capture-guide.ts`
 *     dodges this by importing `../src/...` relatively (see its own comment),
 *     but `lib/trials.ts` and `lib/trial-detail.ts` are imported by client
 *     components and use the alias throughout; rewriting them to relative paths
 *     to suit a test script would be the test dictating the app's style.
 *   - `import table from './x.json'` — Node requires an import attribute that
 *     the app's source does not carry, so the JSON is served as a synthetic
 *     module with the parsed object as its default export instead.
 *
 * Register from the test itself, before the modules under test are imported:
 *
 *     import { register } from 'node:module';
 *     register('./alias-hook.mjs', import.meta.url);
 *     const { toCardData } = await import('../lib/trials.ts');
 */

import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

/** The bundler's extension search, which the app's imports rely on. */
const EXTENSIONS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts'];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), ROOT);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(`${base.href}${extension}`);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    const source = readFileSync(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${source};`,
    };
  }
  return next(url, context);
}
