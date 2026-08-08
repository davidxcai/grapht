/**
 * HTML parsing for incidecoder.com — the only public source for a
 * name -> full INCI ingredient list mapping at any scale. No API exists;
 * this is regex parsing of the rendered page, same approach as
 * `barcode-harvest.mjs` takes with Gemini text. Parsing is kept separate from
 * fetching (`scripts/scrape-incidecoder.mjs`) so a bad regex costs a re-parse
 * of cached HTML, never a re-fetch.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
};

export function decodeHtml(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/​/g, '') // zero-width space, used site-wide as a "func/​name" wrap hint
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `sitemap-index.xml` -> the `sitemap-products.N.xml` filenames it lists.
 * This is the full slug index in ~92 requests (2000 slugs/chunk) rather than
 * ~3800 requests walking `/products/all?offset=N` at 48/page — same catalog,
 * a source built for bulk enumeration instead of human browsing.
 */
export function parseSitemapIndex(xml) {
  const re = /<loc>https:\/\/incidecoder\.com\/(sitemap-products\.\d+\.xml)<\/loc>/g;
  const files = [];
  let m;
  while ((m = re.exec(xml))) files.push(m[1]);
  return files;
}

/** One `sitemap-products.N.xml` -> `[{ slug, image, lastmod }]`. */
export function parseSitemapChunk(xml) {
  const out = [];
  const blockRe = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = blockRe.exec(xml))) {
    const block = m[1];
    const loc = block.match(/<loc>https:\/\/incidecoder\.com\/products\/([a-z0-9-]+)<\/loc>/);
    if (!loc) continue;
    const img = block.match(/<image:loc>([^<]*)<\/image:loc>/);
    const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/);
    out.push({ slug: loc[1], image: img ? img[1] : null, lastmod: lastmod ? lastmod[1] : null });
  }
  return out;
}

/**
 * The `product-skim` table is the single source for the ingredient list: one
 * row per ingredient, in INCI (concentration) order, each carrying its name,
 * functions ("what it does"), irritancy/comedogenicity, and "our take" rating
 * together. Preferred over stitching together the flat ingredient list and
 * the separate by-function blocks used elsewhere on the page, which carry
 * the same data split across two structures.
 */
const ROW_RE = /<tr[^>]*>\s*<td>\s*<a href="\/ingredients\/([a-z0-9-]+)"\s+class="black ingred-detail-link">([^<]*)<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
const FUNCTION_RE = /<a href="\/ingredient-functions\/([a-z0-9-]+)"\s+class="lilac ingred-function-link">([^<]*)<\/a>/g;
const RATING_RE = /title="(irritancy|comedogenicity): (\d)"/g;
const TAKE_RE = /class="our-take our-take-([a-z-]+)"/;

function parseIngredientTable(html) {
  const tableMatch = html.match(/<table class="product-skim fs16">([\s\S]*?)<\/table>/);
  if (!tableMatch) return null;

  const out = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(tableMatch[1]))) {
    const [, slug, name, functionsCell, ratingCell, takeCell] = m;

    const functions = [];
    FUNCTION_RE.lastIndex = 0;
    let fm;
    while ((fm = FUNCTION_RE.exec(functionsCell))) functions.push({ slug: fm[1], name: decodeHtml(fm[2]) });

    const rating = {};
    RATING_RE.lastIndex = 0;
    let rm;
    while ((rm = RATING_RE.exec(ratingCell))) {
      const field = rm[1] === 'irritancy' ? 'irritancy' : 'comedogenicity';
      // A range ("0-3") reports two matches for the same field; keep the max.
      rating[field] = Math.max(rating[field] ?? -1, Number(rm[2]));
    }

    const takeMatch = takeCell.match(TAKE_RE);

    out.push({
      slug,
      name: decodeHtml(name),
      position: out.length,
      functions,
      irritancy: rating.irritancy ?? null,
      comedogenicity: rating.comedogenicity ?? null,
      take: takeMatch ? takeMatch[1] : null,
    });
  }
  return out;
}

/**
 * `/products/new` -> newest-first slugs. One page, no pagination, ~200
 * entries — the whole point of polling this daily instead of re-walking the
 * sitemap for what changed. `class="klavika simpletextlistitem"` is the
 * exact class incidecoder gives this listing's links and nothing else on the
 * page, which is what keeps this regex from also matching nav/footer links
 * to `/products`.
 */
const NEW_PRODUCT_LINK_RE = /<a href="\/products\/([a-z0-9-]+)" class="klavika simpletextlistitem">/g;

export function parseNewProductsPage(html) {
  const seen = new Set();
  const slugs = [];
  let m;
  NEW_PRODUCT_LINK_RE.lastIndex = 0;
  while ((m = NEW_PRODUCT_LINK_RE.exec(html))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      slugs.push(m[1]);
    }
  }
  return slugs;
}

/**
 * A product detail page -> its full record. Returns `null` for a page that
 * isn't actually a product (deleted/redirected slug), detected by the
 * absence of `#product-title`, so the caller can tell "fetched, not a
 * product" apart from a network failure.
 */
export function parseProductPage(html, slug) {
  const titleMatch = html.match(/<span id="product-title">([^<]*)<\/span>/);
  if (!titleMatch) return null;

  const brandMatch = html.match(
    /<span id="product-brand-title">\s*<a href="\/brands\/([a-z0-9-]+)" class="underline">([^<]*)<\/a>/,
  );
  const descMatch = html.match(/<span id="product-details">([\s\S]*?)<\/span>/);
  const uploadedMatch = html.match(
    /Uploaded by: ([^<]*) on <time datetime="([^"]+)">/,
  );

  let image = null;
  const imgBlock = html.match(/id="product-main-image">([\s\S]*?)<\/picture>/);
  if (imgBlock) {
    const imgMatch = imgBlock[1].match(/<img src="([^"]+)"/);
    if (imgMatch) image = imgMatch[1];
  }

  return {
    slug,
    brand: brandMatch ? { slug: brandMatch[1], name: decodeHtml(brandMatch[2]) } : null,
    name: decodeHtml(titleMatch[1]),
    description: descMatch ? decodeHtml(descMatch[1]) : null,
    image,
    uploadedBy: uploadedMatch ? uploadedMatch[1].trim() : null,
    uploadedAt: uploadedMatch ? uploadedMatch[2] : null,
    ingredients: parseIngredientTable(html) ?? [],
  };
}
