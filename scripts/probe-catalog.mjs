#!/usr/bin/env node
/**
 * Catalog source viability probe. Costs no YouCam units and touches no
 * YouCam/INCI/Gemini quota — it reads public web endpoints only.
 *
 * Answers one question: where can `(name, image, description, barcode)` for a
 * skincare product actually be retrieved from, at scale, for free?
 *
 * Three independent layers, because no single source has all four fields:
 *
 *   layer 1  brand Shopify `/products.json`  → official name, image, description
 *   layer 2  retailer JSON-LD `gtin13`       → barcode
 *   layer 3  data.go.kr (Korea MFDS)         → authoritative K-beauty registry
 *
 * Layer 1 is also a harvester: whatever it finds is written to
 * `data/catalog/shopify/<host>.json` so repeat runs accumulate rather than
 * re-fetch. That is the "build the list up over time" path, minus a scheduler.
 *
 * Usage:
 *   node scripts/probe-catalog.mjs                 # all three layers
 *   node scripts/probe-catalog.mjs --shopify       # harvest names/images only
 *   node scripts/probe-catalog.mjs --gtin --enrich 50
 *   node scripts/probe-catalog.mjs --retailers     # show the sitemap blockage
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validGtin } from '../src/products.mjs';

const UA = 'grapht/0.1 (catalog probe; contact via repo)';
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
// No layer flags means run everything except the retailer reachability check.
const only = ['--shopify', '--gtin', '--datagokr', '--retailers'].filter(has);
const run = (layer) => only.length === 0 || has(`--${layer}`);

const PAGES = num('--pages', 3);    // product pages sampled per retailer
const ENRICH = num('--enrich', 25); // barcode lookups per brand per run

/** Brand DTC storefronts. Shopify is the common denominator in K-beauty. */
const BRANDS = [
  'beautyofjoseon.com', 'skin1004.com', 'theanua.com', 'anua.co.kr',
  'global.cosrx.com', 'purito.com', 'axis-y.com', 'isntree.com',
  'roundlab.com', 'kravebeauty.com', 'glowrecipe.com', 'tirtir.com',
  'mixsoon.com', 'medicube.com', 'dearklairs.com', 'benton.co.kr',
  'iunik.com', 'somebymi.com', 'thelipbalm.com', 'youthtothepeople.com',
  'drunkelephant.com', 'theinkeylist.com', 'versedskin.com', 'byoma.com',
];

/** Retailers likely to publish schema.org Product with a gtin. */
const RETAILERS = [
  'https://www.notino.co.uk', 'https://www.lookfantastic.com',
  'https://www.beautybay.com', 'https://www.cultbeauty.co.uk',
  'https://www.douglas.de', 'https://www.yesstyle.com',
  'https://www.stylevana.com', 'https://www.iherb.com',
];

async function get(url, { timeout = 20000, json = false } = {}) {
  const ctl = AbortSignal.timeout(timeout);
  try {
    const res = await fetch(url, {
      signal: ctl,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: json ? 'application/json' : 'text/html,application/xml' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, body: json ? await res.json() : await res.text() };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ layer 1 */

async function probeShopify() {
  console.log('\n=== layer 1: brand Shopify /products.json ===\n');
  const rows = [];
  let harvested = 0;

  for (const host of BRANDS) {
    const res = await get(`https://${host}/products.json?limit=250`, { json: true });
    if (!res.ok) {
      rows.push({ host, ok: false, status: res.status, error: res.error });
      console.log(`  ${host.padEnd(24)} ${res.error || `HTTP ${res.status}`}`);
      continue;
    }

    const products = res.body?.products || [];
    const f = { name: 0, image: 0, description: 0, barcode: 0, sku: 0 };
    const records = products.map((p) => {
      const v = (p.variants || [])[0] || {};
      const img = (p.images || [])[0]?.src || null;
      const desc = strip(p.body_html);
      if (p.title) f.name++;
      if (img) f.image++;
      if (desc) f.description++;
      if (v.barcode) f.barcode++;
      if (v.sku) f.sku++;
      return {
        source: `shopify:${host}`,
        brand: p.vendor || null,
        name: p.title || null,
        productType: p.product_type || null,
        handle: p.handle,
        url: `https://${host}/products/${p.handle}`,
        image: img,
        description: desc || null,
        sku: v.sku || null,
        barcode: v.barcode || null,
        price: v.price || null,
        updatedAt: p.updated_at || null,
      };
    });

    const n = products.length;
    rows.push({ host, ok: true, n, fill: Object.fromEntries(Object.entries(f).map(([k, c]) => [k, pct(c, n)])) });
    console.log(
      `  ${host.padEnd(24)} ${String(n).padStart(3)} products  ` +
        `name ${pct(f.name, n).padStart(4)}  image ${pct(f.image, n).padStart(4)}  ` +
        `desc ${pct(f.description, n).padStart(4)}  barcode ${pct(f.barcode, n).padStart(4)}`,
    );

    if (n) {
      await save(`data/catalog/shopify/${host}.json`, {
        host, fetchedAt: new Date().toISOString(), count: n, products: records,
      });
      harvested += n;
    }
  }

  const reachable = rows.filter((r) => r.ok);
  console.log(
    `\n  reachable: ${reachable.length}/${BRANDS.length} stores, ` +
      `${harvested} products harvested -> data/catalog/shopify/`,
  );
  const anyBarcode = reachable.some((r) => r.fill.barcode !== '0%');
  console.log(`  barcode present anywhere: ${anyBarcode ? 'YES' : 'NO — Shopify redacts it from the public endpoint'}`);
  return { rows, harvested };
}

/* ------------------------------------------------------------------ layer 2 */

/** Pull a handful of plausible product URLs out of a site's sitemap tree. */
async function productUrls(origin, want) {
  const seen = [];
  const index = await get(`${origin}/sitemap.xml`);
  if (!index.ok) return { urls: [], note: index.error || `sitemap HTTP ${index.status}` };

  const locs = [...index.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  // A sitemap index points at more sitemaps; a plain sitemap already has pages.
  const nested = locs.filter((u) => /\.xml/i.test(u));
  const direct = locs.filter((u) => !/\.xml/i.test(u));

  if (direct.length) seen.push(...direct);
  const candidates = nested
    .filter((u) => /product|item|pdp/i.test(u))
    .concat(nested)
    .slice(0, 3);

  for (const sm of candidates) {
    if (seen.length >= want * 8) break;
    const sub = await get(sm);
    if (!sub.ok) continue;
    const urls = [...sub.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((m) => m[1])
      .filter((u) => !/\.xml/i.test(u));
    seen.push(...urls);
  }
  return { urls: seen.slice(0, want * 8), note: null };
}

/** Find a gtin in JSON-LD, microdata, or anywhere in the raw markup. */
function findGtin(html) {
  const out = { jsonLd: false, gtin: null, name: null, image: null, via: null };
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  out.jsonLd = blocks.length > 0;

  for (const [, raw] of blocks) {
    let data;
    try { data = JSON.parse(raw.trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      const type = [].concat(node['@type'] || []).join(',');
      if (/Product/i.test(type)) {
        const g = node.gtin13 || node.gtin14 || node.gtin12 || node.gtin || node.gtin8;
        if (g) { out.gtin = String(g); out.via = 'json-ld'; }
        out.name ||= node.name || null;
        const img = node.image;
        out.image ||= Array.isArray(img) ? img[0] : typeof img === 'string' ? img : img?.url || null;
      }
      stack.push(...Object.values(node));
    }
    if (out.gtin) return out;
  }

  // Fallbacks: microdata, then a bare 13-digit run near an EAN-ish label.
  const micro = html.match(/itemprop=["']gtin1?[2348]?["'][^>]*content=["'](\d{8,14})["']/i);
  if (micro) { out.gtin = micro[1]; out.via = 'microdata'; return out; }
  const loose = html.match(/\b(?:ean|gtin|barcode)\b[^0-9]{0,40}(\d{13})\b/i);
  if (loose) { out.gtin = loose[1]; out.via = 'loose-text'; }
  return out;
}

/** EAN-13 / UPC-A check digit. Rejects OCR slips and scraped junk alike. */
/**
 * Layer 2, as measured rather than as designed.
 *
 * The original plan crawled retailer sitemaps for schema.org gtin. Every
 * retailer tried returned 403 or 404 at `/sitemap.xml` — bot-blocked, not
 * gtin-free, so that route is unmeasured rather than disproven.
 *
 * What does work: the *brand* storefronts already reachable in layer 1 emit
 * JSON-LD on their product pages, and roughly a third of them populate a real
 * gtin there — even though `/products.json` nulls the `barcode` field. So the
 * barcode hop needs no new hosts, only a second fetch per product.
 *
 * Incremental by design: products that already carry a barcode are skipped, so
 * repeated runs deepen the catalog instead of re-fetching it.
 */
async function probeGtin() {
  console.log('\n=== layer 2: gtin from brand product pages ===\n');
  const dir = 'data/catalog/shopify';
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('  no harvest yet — run --shopify first');
    return { rows: [] };
  }

  const rows = [];
  for (const file of files) {
    const path = `${dir}/${file}`;
    const store = JSON.parse(await readFile(path, 'utf8'));
    const todo = store.products.filter((p) => !p.barcode).slice(0, ENRICH);

    let fetched = 0, withLd = 0, found = 0, invalid = 0;
    let sample = null;
    for (const product of todo) {
      const page = await get(product.url, { timeout: 25000 });
      if (!page.ok) continue;
      fetched++;
      const hit = findGtin(page.body);
      if (hit.jsonLd) withLd++;
      if (!hit.gtin) continue;
      if (!validGtin(hit.gtin)) { invalid++; continue; }
      product.barcode = hit.gtin;
      product.barcodeSource = hit.via;
      found++;
      sample ||= hit.gtin;
    }

    if (found) await save(path, store);
    const have = store.products.filter((p) => p.barcode).length;
    rows.push({ host: store.host, fetched, withLd, found, invalid, totalWithBarcode: have, total: store.count });

    console.log(
      `  ${store.host.padEnd(22)} ${String(fetched).padStart(3)} checked  ` +
        `json-ld ${pct(withLd, fetched).padStart(4)}  gtin ${pct(found, fetched).padStart(4)}  ` +
        `catalog ${have}/${store.count}` +
        (invalid ? `  (${invalid} failed checksum)` : '') +
        (sample ? `  e.g. ${sample}` : ''),
    );
  }

  const t = rows.reduce((a, r) => ({ f: a.f + r.fetched, g: a.g + r.found }), { f: 0, g: 0 });
  console.log(`\n  ${t.g}/${t.f} pages yielded a checksum-valid gtin (${pct(t.g, t.f)})`);
  console.log(`  brands publishing gtin: ${rows.filter((r) => r.found > 0).length}/${rows.length}`);
  return { rows };
}

/** Kept because the blockage is itself the finding. Not part of a normal run. */
async function probeRetailers() {
  console.log('\n=== retailer sitemap reachability ===\n');
  const rows = [];
  for (const origin of RETAILERS) {
    const host = new URL(origin).host;
    const { urls, note } = await productUrls(origin, PAGES);
    rows.push({ host, urls: urls.length, note });
    console.log(`  ${host.padEnd(24)} ${urls.length} urls  ${note || ''}`);
  }
  return { rows };
}

/* ------------------------------------------------------------------ layer 3 */

async function probeDataGoKr() {
  console.log('\n=== layer 3: data.go.kr / MFDS ===\n');
  const key = process.env.DATA_GO_KR_KEY;
  const endpoints = [
    ['MFDS cosmetic product list', 'https://apis.data.go.kr/1471000/CsmtcsPrdtInfoService01/getCsmtcsPrdtInfoList01'],
    ['MFDS cosmetic ingredient',   'https://apis.data.go.kr/1471000/CsmtcsIngdCpntInfoService/getCsmtcsIngdCpntInfoList'],
  ];
  const rows = [];

  for (const [label, base] of endpoints) {
    const url = `${base}?serviceKey=${encodeURIComponent(key || 'TEST')}&pageNo=1&numOfRows=3&type=json`;
    const res = await get(url, { timeout: 25000 });
    const body = typeof res.body === 'string' ? res.body.slice(0, 200) : '';
    const needsKey = /SERVICE_KEY|등록되지|NOT_REGISTERED|UNREGISTERED/i.test(body);
    rows.push({ label, status: res.status, needsKey, sample: body });
    console.log(`  ${label.padEnd(30)} HTTP ${res.status || res.error} ${needsKey ? '— key required' : ''}`);
    if (body) console.log(`    ${body.replace(/\s+/g, ' ').slice(0, 150)}`);
  }

  if (!key) {
    console.log('\n  DATA_GO_KR_KEY unset. Free signup at data.go.kr, then re-run.');
  }
  return { rows, hasKey: Boolean(key) };
}

/* -------------------------------------------------------------------- main */

async function save(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2));
}

const report = { probedAt: new Date().toISOString(), layers: {} };

if (run('shopify')) report.layers.shopify = await probeShopify();
if (run('gtin')) report.layers.gtin = await probeGtin();
if (run('datagokr')) report.layers.datagokr = await probeDataGoKr();
if (has('--retailers')) report.layers.retailers = await probeRetailers();

await save('data/catalog-probe.json', report);
console.log('\nreport -> data/catalog-probe.json');
