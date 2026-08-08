/**
 * List every brand across the full incidecoder scrape
 * (skincare-data/raw/incidecoder/products/*.json, gitignored, ~183,181 files
 * as of 2026-08-08). Offline, free — no DB, no API. Mirrors the brand-dedup
 * logic in scripts/import-catalog.mjs's phase A exactly (same seenProductSlugs
 * dedup, same brand.slug/brand.name grouping), so counts here should match
 * catalog_brands once a full `import-catalog.mjs` run has caught up — this
 * script exists because the DB is only partially imported right now while the
 * raw files are already complete.
 *
 *   node scripts/list-catalog-brands.mjs
 *   node scripts/list-catalog-brands.mjs --out=path.txt
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCTS_DIR = 'skincare-data/raw/incidecoder/products';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const outPath = outArg ? outArg.slice('--out='.length) : null;

const files = readdirSync(PRODUCTS_DIR).filter((f) => f.endsWith('.json'));

const brands = new Map(); // slug -> {name, count}
const seenProductSlugs = new Set();
let duplicateFiles = 0;
let noBrand = 0;

for (let i = 0; i < files.length; i++) {
  const p = JSON.parse(readFileSync(join(PRODUCTS_DIR, files[i]), 'utf8'));
  if (!p || p.notFound) continue;

  if (seenProductSlugs.has(p.slug)) {
    duplicateFiles += 1;
    continue;
  }
  seenProductSlugs.add(p.slug);

  if (p.brand?.slug) {
    const existing = brands.get(p.brand.slug);
    if (existing) existing.count += 1;
    else brands.set(p.brand.slug, { name: p.brand.name, count: 1 });
  } else {
    noBrand += 1;
  }

  if ((i + 1) % 20000 === 0 || i + 1 === files.length) {
    process.stderr.write(`\rscanned ${i + 1}/${files.length} files   `);
  }
}
process.stderr.write('\n');

const sorted = [...brands.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const totalProducts = sorted.reduce((sum, r) => sum + r.count, 0);
const lines = sorted.map((r) => `${r.name}\t${r.count}`);
const header = `# ${sorted.length} brands, ${totalProducts} branded products, ${noBrand} unbranded, ${duplicateFiles} duplicate files (raw scrape, ${new Date().toISOString().slice(0, 10)})`;
const output = [header, ...lines].join('\n');

if (outPath) {
  writeFileSync(outPath, output + '\n');
  console.log(`Wrote ${sorted.length} brands to ${outPath}`);
} else {
  console.log(output);
}
