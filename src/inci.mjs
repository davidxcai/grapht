/**
 * INCI API client (inciapi.com) — ingredient-level cosmetics data.
 *
 * Contract recovered from their docs, verified 2026-08-04. Full notes in
 * docs/product-identity.md.
 *
 * Two properties shape this client:
 *
 *   - `POST /v1/analyze` takes a raw INCI array with no barcode. That is what
 *     makes "photograph the back of the bottle" a first-class input rather than
 *     a fallback, and it works on products no database has ever heard of.
 *   - 404s are free and the free tier is 20,000 req/month, so coverage probing
 *     is cheap. This does NOT draw on the YouCam unit budget — the two quotas
 *     are unrelated, and nothing here can cost a skin analysis.
 *
 * Everything is cached to disk, including misses: a 404 for a barcode is a
 * durable fact about the database, not a transient failure, and re-asking costs
 * a request for an answer we already have.
 */

import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeInci, normalizeBarcode } from './products.mjs';

const BASE_URL = 'https://inciapi.com/v1';

/**
 * How many times to sit out a 429. The limiter asks for ~25s, so this is up to
 * a couple of minutes of waiting on a single lookup — worth it in a batch pass,
 * and unreachable in the interactive path, which makes one call at a time.
 */
const RATE_LIMIT_ATTEMPTS = 5;

export class InciError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'InciError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/**
 * Keyword -> analysis concern, for reading `efficacySummary.topEffects` and
 * ingredient function strings without a language model.
 *
 * This is a coarse deterministic prior, not a replacement for the classifier. It
 * exists so there is something to check the classifier *against* — a target set
 * that this lexicon and the LLM both produce is more trustworthy than one only
 * the LLM produced, and a disagreement is worth surfacing rather than averaging.
 *
 * Longer phrases are matched first so "pore minimising" doesn't get caught by a
 * bare "pore" rule that meant something else.
 */
const EFFECT_LEXICON = [
  [/anti[- ]?acne|blemish|breakout|acne/i, 'acne'],
  [/comedogenic/i, 'acne'],
  [/exfoliat|keratolytic|smooth(ing|ness)?|texture|resurfac/i, 'texture'],
  [/sooth|calm|anti[- ]?inflammat|redness|rosacea|wound healing|barrier protect/i, 'redness'],
  [/sebum|oil control|mattif|oili/i, 'oiliness'],
  [/brighten|radian|glow|dull/i, 'radiance'],
  [/pore[- ]?(minimis|minimiz|refin|tighten)|pore size|pores?/i, 'pore'],
  [/hyperpigment|dark spot|age spot|melanin|even.{0,10}tone|depigment/i, 'age_spot'],
  [/wrinkle|fine line|anti[- ]?aging|anti[- ]?ageing/i, 'wrinkle'],
  [/hydrat|moistur|humectant|emollient|barrier repair|occlusive/i, 'moisture'],
  [/firm|elastic|collagen|sagg/i, 'firmness'],
  [/dark circle|under[- ]?eye pigment/i, 'dark_circle_v2'],
  [/eye bag|puffiness|periorbital oedema|periorbital edema/i, 'eye_bag'],
];

/**
 * Evidence grades that justify a strong signal, read from `bestEvidenceLevel`.
 * Nothing in the payload outranks these; below them sit `in_vitro`,
 * `anecdotal`, `expert_opinion` and similar, which corroborate a concern but
 * should not drive a pre-tick on their own.
 */
const HIGH_EVIDENCE = new Set(['meta_analysis', 'systematic_review', 'rct']);

/**
 * Map a free-text effect or an API effect slug onto concern keys.
 *
 * `efficacySummary.topEffects[].target` arrives as a snake_case slug
 * (`barrier_repair`, `anti_hyperpigmentation`), so underscores are flattened to
 * spaces before matching — without that, `barrier_repair` silently misses the
 * `barrier repair` rule and a real RCT-backed moisture signal is dropped.
 */
export function concernsFromText(text) {
  if (typeof text !== 'string') return [];
  const flattened = text.replace(/_/g, ' ');
  const hits = [];
  for (const [pattern, concern] of EFFECT_LEXICON) {
    if (pattern.test(flattened) && !hits.includes(concern)) hits.push(concern);
  }
  return hits;
}

/**
 * Reduce an INCI analysis payload to the handful of fields that bear on the 15
 * concerns.
 *
 * Most of the response belongs to a different product — safety scores, allergen
 * flags, pregnancy warnings, clean-beauty ratings. Real information, wrong app.
 * Pulling only what maps to a concern keeps that from leaking into the UI and
 * turning a measurement tool into a safety checker.
 */
export function extractSignals(analysis) {
  const signals = [];
  const ingredients = analysis?.parsedIngredients ?? [];

  // Comedogenicity is the one clean, direct mapping in the whole payload.
  // Note it points at `acne` in the *worsening* direction — but targets[] does
  // not carry a direction, and per docs/trial-model.md the app should not
  // presume the sign of an effect even for a removal. Targeting is enough.
  //
  // The top-level score is often 0 even when an individual ingredient is
  // strongly comedogenic, so both are checked.
  const comedogenic = analysis?.comedogenicityScore;
  if (typeof comedogenic === 'number' && comedogenic >= 3) {
    signals.push({ concern: 'acne', weight: 'strong', because: `comedogenicity ${comedogenic}/5` });
  } else {
    const worst = ingredients.filter((i) => (i?.comedogenicityRating ?? 0) >= 3);
    if (worst.length) {
      signals.push({
        concern: 'acne',
        weight: 'weak',
        because: `comedogenic ingredient(s): ${worst.slice(0, 3).map((i) => i.inciName).join(', ')}`,
      });
    }
  }

  // The best signal in the payload by a distance: evidence-backed effects with
  // a strength grade and the ingredients responsible.
  //
  // `topEffects` entries are objects keyed on `target` (a snake_case slug), not
  // strings. An earlier version of this read `.effect`/`.name` and silently
  // extracted nothing at all from a perfectly good response — caught only by
  // running it against the live API.
  for (const effect of analysis?.efficacySummary?.topEffects ?? []) {
    const target = typeof effect === 'string' ? effect : (effect?.target ?? '');
    if (!target) continue;

    // A well-evidenced strong/moderate composite is worth pre-ticking over; a
    // weak composite or lower-grade evidence is corroboration, not a headline.
    //
    // Note `meta_analysis` and `systematic_review` sit ABOVE `rct`, not below.
    // An earlier version tested `=== 'rct'` and silently demoted the strongest
    // evidence in the payload to a weak signal.
    const graded =
      HIGH_EVIDENCE.has(effect?.bestEvidenceLevel) &&
      (effect?.compositeStrength === 'strong' || effect?.compositeStrength === 'moderate');
    const weight = typeof effect === 'string' || graded ? 'strong' : 'weak';

    const from = effect?.contributingIngredients?.slice(0, 3).join(', ');
    const because = [
      `${effect?.bestEvidenceLevel ?? 'reported'}-backed ${target.replace(/_/g, ' ')}`,
      effect?.compositeStrength ? `(${effect.compositeStrength})` : null,
      from ? `via ${from}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    for (const concern of concernsFromText(target)) {
      signals.push({ concern, weight, because });
    }
  }

  const irritants = ingredients.filter(
    (i) => i?.irritancyPotential === 'high' || i?.irritancyPotential === 'severe',
  );
  if (irritants.length) {
    signals.push({
      concern: 'redness',
      weight: 'weak',
      because: `${irritants.length} high-irritancy ingredient(s): ${irritants
        .slice(0, 3)
        .map((i) => i.inciName)
        .join(', ')}`,
    });
  }

  // Collapse to one entry per concern, keeping the strongest justification.
  const byConcern = new Map();
  for (const s of signals) {
    const prior = byConcern.get(s.concern);
    if (!prior || (prior.weight === 'weak' && s.weight === 'strong')) {
      byConcern.set(s.concern, { ...s, evidence: (prior?.evidence ?? 0) + 1 });
    } else {
      prior.evidence += 1;
    }
  }

  // Strong signals first, then by how many ingredients corroborated them.
  return [...byConcern.values()].sort(
    (a, b) =>
      (b.weight === 'strong') - (a.weight === 'strong') || b.evidence - a.evidence,
  );
}

/**
 * Flatten either response shape into one view.
 *
 * The two endpoints do NOT return the same structure, which is not documented
 * and fails silently — you get a 200, a populated body, and zero signals:
 *
 *   POST /v1/analyze        -> { analysis: {...} }
 *   GET  /v1/products/:code -> { product: { name, brand, ingredients,
 *                                           details: { inci: [...],
 *                                                      analysis: {...} } } }
 *
 * The barcode form is the richer one — it carries the product's name, brand,
 * country, and a `qualityScore` that `/v1/analyze` has no way to know.
 */
export function unwrap(payload) {
  const product = payload?.product ?? null;
  const details = product?.details ?? null;

  return {
    analysis: details?.analysis ?? payload?.analysis ?? payload ?? {},
    inci:
      details?.inci ??
      payload?.inci ??
      payload?.analysis?.parsedIngredients?.map((i) => i.inciName) ??
      null,
    brand: product?.brand ?? payload?.brand ?? null,
    name: product?.name ?? payload?.productName ?? payload?.name ?? null,
    barcode: product?.barcode ?? payload?.analysis?.barcode ?? null,
    qualityScore: product?.qualityScore ?? null,
  };
}

export class InciClient {
  #cacheDir;

  /**
   * `offline: true` replays fixtures only and throws rather than hitting the
   * network — the mode the demo and the test suite run in, so the whole product
   * path stays exercisable with no API key.
   */
  constructor({ apiKey = null, cacheDir = 'data/inci', offline = false, verbose = false } = {}) {
    this.apiKey = apiKey;
    this.offline = offline;
    this.verbose = verbose;
    this.#cacheDir = cacheDir;
  }

  #log(...args) {
    if (this.verbose) console.error('[inci]', ...args);
  }

  #cachePath(kind, id) {
    return join(this.#cacheDir, kind, `${id}.json`);
  }

  #readCache(kind, id) {
    const path = this.#cachePath(kind, id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  #writeCache(kind, id, value) {
    const path = this.#cachePath(kind, id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    return value;
  }

  async #request(path, { method = 'GET', body = null, attempt = 0 } = {}) {
    if (!this.apiKey) throw new InciError('no INCI_API_KEY set');
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    // The rate limit is per IP, separate from the monthly quota, and it is
    // strict enough that a batch loop trips it within a few dozen calls. The
    // body carries `retryAfter` in seconds — obeying it is the difference
    // between a slow pass and a 73% failure rate, measured on the first real
    // 115-code run before this existed.
    //
    // Retrying here rather than in the caller means nothing is cached until it
    // actually succeeded, so a re-run resumes cleanly on whatever timed out.
    if (res.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
      const headerWait = Number(res.headers.get('retry-after'));
      const bodyWait = Number(parsed?.retryAfter);
      const waitS = [bodyWait, headerWait].find((n) => Number.isFinite(n) && n > 0) ?? 2 ** attempt;
      this.#log(`429 on ${path} — waiting ${waitS}s (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
      return this.#request(path, { method, body, attempt: attempt + 1 });
    }

    if (res.status === 404) return { found: false, status: 404 };
    // 403 means the endpoint exists but the tier doesn't cover it (efficacy,
    // incompatibilities are Pro+). That is a configuration fact, not an error
    // worth aborting a product lookup over — degrade and carry on.
    if (res.status === 403) {
      this.#log(`403 on ${path} — endpoint requires a higher tier`);
      return { found: false, status: 403, tierLimited: true };
    }
    if (!res.ok) {
      throw new InciError(`${method} ${url} -> ${res.status}: ${JSON.stringify(parsed)}`, {
        status: res.status,
        body: parsed,
        url,
      });
    }
    return { found: true, status: res.status, data: parsed };
  }

  /** Cache-first fetch. Misses (404) are cached too — they don't change. */
  async #cached(kind, id, path, options) {
    const hit = this.#readCache(kind, id);
    if (hit) {
      this.#log(`cache hit ${kind}/${id}`);
      return hit;
    }
    if (this.offline) {
      throw new InciError(
        `offline: no fixture at ${this.#cachePath(kind, id)} (run with an INCI_API_KEY to populate)`,
      );
    }
    const result = await this.#request(path, options);
    return this.#writeCache(kind, id, { ...result, fetchedAt: new Date().toISOString() });
  }

  /** Barcode -> product record with its INCI list. */
  async productByBarcode(barcode) {
    const gtin = normalizeBarcode(barcode);
    if (!gtin) throw new InciError(`not a usable barcode: ${JSON.stringify(barcode)}`);
    // The API wants the barcode as printed; GTIN-14 is our cache key only.
    const asPrinted = String(barcode).replace(/\D/g, '');
    return this.#cached('barcode', gtin, `/products/${asPrinted}`);
  }

  /**
   * Analyse a raw INCI list. No barcode, no database, works on anything.
   * Cache key is the normalised-list hash, matching src/products.mjs identity.
   */
  async analyzeInci(list) {
    const ingredients = normalizeInci(list);
    if (!ingredients.length) throw new InciError('analyzeInci requires a non-empty ingredient list');
    const id = crypto.createHash('sha256').update(ingredients.join('|')).digest('hex').slice(0, 16);
    return this.#cached('analyze', id, '/analyze', {
      method: 'POST',
      body: { inci: ingredients },
    });
  }

  /** Ingredient conflicts — a trial-creation warning, not a targets signal. Pro+. */
  async incompatibilities(inciName) {
    const id = inciName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return this.#cached('incompatibilities', id, `/ingredients/${encodeURIComponent(inciName)}/incompatibilities`);
  }

  /**
   * The whole enrichment step in one call: whatever identity we have in, a
   * ranked deterministic signal list out. Prefers the ingredient list over the
   * barcode, since the list is what the analysis actually runs on.
   */
  async enrich({ inci = null, barcode = null } = {}) {
    let payload = null;
    let source = null;

    if (inci?.length) {
      const res = await this.analyzeInci(inci);
      if (res.found) {
        payload = res.data;
        source = 'inci';
      }
    }

    if (!payload && barcode) {
      const res = await this.productByBarcode(barcode);
      if (res.found) {
        payload = res.data;
        source = 'barcode';
      }
    }

    if (!payload) return { found: false, source: null, signals: [], inci: normalizeInci(inci) };

    const view = unwrap(payload);
    return {
      found: true,
      source,
      signals: extractSignals(view.analysis),
      inci: normalizeInci(view.inci ?? inci),
      brand: view.brand,
      name: view.name,
      barcode: view.barcode ?? normalizeBarcode(barcode),
    };
  }
}

export function clientFromEnv({ offline = false, verbose = false } = {}) {
  return new InciClient({
    apiKey: process.env.INCI_API_KEY ?? null,
    offline: offline || !process.env.INCI_API_KEY,
    verbose,
  });
}
