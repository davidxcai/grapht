/**
 * Product identity and the derived-targets cache.
 *
 * The job: recognise that the bottle someone just scanned is the same product
 * someone else scanned last week, so its `targets[]` are derived once and stay
 * consistent afterwards. Design rationale in docs/product-identity.md.
 *
 * Identity is keyed on a hash of the normalised INCI list, not the barcode. The
 * same formulation ships under different regional barcodes and different
 * marketing names; keying on barcode stores it three times and lets the three
 * drift apart.
 *
 * Normalisation is deliberately conservative, because the two failure modes are
 * not symmetric:
 *
 *   - Too strict (synonyms like "aqua" vs "water" hash differently) -> a cache
 *     miss -> one extra classification. Costs a few cents.
 *   - Too loose (two different products collide) -> product A silently inherits
 *     product B's targets -> a trial attributes a change to the wrong thing.
 *
 * The second is unrecoverable and invisible, so this leans toward misses.
 */

import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeConcerns } from './concerns.mjs';

/**
 * How a record's targets came to be, strongest first. A human who looked at the
 * derived targets outranks the classifier that produced them, and a human who
 * *changed* them outranks one who merely accepted the default.
 */
export const PROVENANCE = {
  USER_EDITED: 'user-edited',
  USER_CONFIRMED: 'user-confirmed',
  LLM_DERIVED: 'llm-derived',
};

const PROVENANCE_RANK = {
  [PROVENANCE.USER_EDITED]: 3,
  [PROVENANCE.USER_CONFIRMED]: 2,
  [PROVENANCE.LLM_DERIVED]: 1,
};

/* ---------- normalisation ---------- */

/**
 * Canonicalise one INCI ingredient token.
 *
 * Strips the formatting noise that varies between panels of the same product —
 * case, whitespace, trailing organic asterisks, concentration callouts like
 * "2%", and stray trailing punctuation. Does NOT resolve synonyms: "aqua" and
 * "water" remain distinct, per the conservatism note above.
 */
export function normalizeIngredient(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*†‡]+/g, '')
    // "salicylic acid 2%" / "niacinamide (10%)" -> drop the concentration
    .replace(/\(?\s*\d+(\.\d+)?\s*%\s*\)?/g, '')
    .replace(/^[\s.,;:/-]+|[\s.,;:/-]+$/g, '')
    .trim();
  return cleaned || null;
}

/**
 * Normalise a full INCI list.
 *
 * **Order is preserved deliberately.** INCI panels are ordered by descending
 * concentration down to 1%, so the same ingredients in a different order are a
 * different formulation, and sorting them would merge products that shouldn't
 * merge. Duplicates are dropped (some panels repeat an ingredient across a
 * "may contain" section).
 */
export function normalizeInci(list) {
  const out = [];
  for (const raw of list ?? []) {
    const token = normalizeIngredient(raw);
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Normalise a barcode to GTIN-14 for comparison.
 *
 * A 12-digit UPC-A and the 13-digit EAN-13 that wraps it are the same article
 * with a leading zero, and retailers print either. Left-padding both to 14
 * makes them compare equal, which is the single most common reason two scans of
 * one product would otherwise miss each other.
 */
export function normalizeBarcode(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.padStart(14, '0');
}

const slug = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Derive the cache key for a product, best available identity first.
 *
 * Returns `{ key, keyType, confidence }`. `confidence` is about the *identity*,
 * not the targets — a name-keyed record is a guess that two strings refer to the
 * same product, which is much weaker than an ingredient-list match.
 */
export function productKey({ inci, barcode, brand, name } = {}) {
  const ingredients = normalizeInci(inci);
  if (ingredients.length) {
    const hash = crypto.createHash('sha256').update(ingredients.join('|')).digest('hex').slice(0, 16);
    return { key: `inci:${hash}`, keyType: 'inci', confidence: 'high' };
  }

  const gtin = normalizeBarcode(barcode);
  if (gtin) return { key: `barcode:${gtin}`, keyType: 'barcode', confidence: 'medium' };

  const label = slug([brand, name].filter(Boolean).join(' '));
  if (label) return { key: `name:${label}`, keyType: 'name', confidence: 'low' };

  throw new Error('cannot key a product with no ingredients, barcode, or name');
}

/* ---------- records ---------- */

/**
 * Build a cache record. Targets are validated against the canonical vocabulary
 * here rather than at read time, so a bad key can never enter the store.
 *
 * `ranked` is the classifier's full ordered suggestion list; `targets` is the
 * subset that is actually pre-ticked. Keeping both means the UI can offer the
 * rest as suggestions without re-running anything, and a later reviewer can see
 * what was considered and rejected.
 */
export function buildRecord({
  inci,
  barcode,
  brand,
  name,
  targets = [],
  ranked = [],
  provenance = PROVENANCE.LLM_DERIVED,
  classifier = null,
  updatedAt = null,
} = {}) {
  if (!Object.hasOwn(PROVENANCE_RANK, provenance)) {
    throw new Error(`unknown provenance ${JSON.stringify(provenance)}`);
  }
  const identity = productKey({ inci, barcode, brand, name });
  return {
    ...identity,
    brand: brand ?? null,
    name: name ?? null,
    barcode: normalizeBarcode(barcode),
    inci: normalizeInci(inci),
    targets: normalizeConcerns(targets),
    ranked: ranked.map((r) => ({
      concern: normalizeConcerns([r.concern])[0],
      confidence: r.confidence ?? null,
      because: r.because ?? null,
    })),
    provenance,
    classifier,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Is this record's classification worth redoing?
 *
 * Only `llm-derived` records go stale. Once a human has confirmed or edited the
 * targets, a newer classifier does not get to overrule them — the review is the
 * stronger signal, and silently re-deriving over it would throw away the only
 * ground truth in the system.
 */
export function isStale(record, currentClassifier) {
  if (!record) return true;
  if (record.provenance !== PROVENANCE.LLM_DERIVED) return false;
  if (!currentClassifier) return false;
  const a = record.classifier;
  if (!a) return true;
  return a.model !== currentClassifier.model || a.promptVersion !== currentClassifier.promptVersion;
}

/** Should `incoming` replace `existing`? Higher provenance wins; ties go to newer. */
export function supersedes(incoming, existing) {
  if (!existing) return true;
  const rankIn = PROVENANCE_RANK[incoming.provenance];
  const rankEx = PROVENANCE_RANK[existing.provenance];
  if (rankIn !== rankEx) return rankIn > rankEx;
  return String(incoming.updatedAt) >= String(existing.updatedAt);
}

/**
 * Snapshot a record's targets for embedding in a trial.
 *
 * This is the boundary where a mutable cache entry becomes an immutable part of
 * a trial. Everything needed to explain the choice later travels with it, and
 * nothing links back to the live record — a cache refresh, a classifier
 * upgrade, or another user's edit must never reach into a running trial and
 * change what its metrics were attributed to. Same rule as the end date: set at
 * creation, never revised after seeing data.
 */
export function freezeTargets(record) {
  return Object.freeze({
    productKey: record.key,
    brand: record.brand,
    name: record.name,
    targets: Object.freeze([...record.targets]),
    provenance: record.provenance,
    classifier: record.classifier ? Object.freeze({ ...record.classifier }) : null,
    frozenAt: new Date().toISOString(),
  });
}

/* ---------- store ---------- */

/**
 * A flat JSON-file product store. Deliberately dumb: this is a cache, not a
 * database, and the whole thing is small enough to load at once. Swap the two
 * I/O methods for a real backend when there is one.
 */
export class ProductStore {
  #records;

  constructor({ path = null, records = {} } = {}) {
    this.path = path;
    this.#records = { ...records };
    if (path && existsSync(path)) {
      this.#records = JSON.parse(readFileSync(path, 'utf8'));
    }
  }

  get size() {
    return Object.keys(this.#records).length;
  }

  /** Look a product up by any identity we happen to have. */
  get(identity) {
    const { key } = identity.key ? identity : productKey(identity);
    return this.#records[key] ?? null;
  }

  /**
   * Insert or update. Returns `{ record, action }` where action is one of
   * `inserted` | `updated` | `kept` — `kept` meaning the existing record won on
   * provenance and the incoming one was discarded.
   */
  put(record) {
    const existing = this.#records[record.key] ?? null;
    if (!supersedes(record, existing)) return { record: existing, action: 'kept' };
    this.#records[record.key] = record;
    return { record, action: existing ? 'updated' : 'inserted' };
  }

  /** Records that an improved classifier should be re-run over. */
  staleRecords(currentClassifier) {
    return Object.values(this.#records).filter((r) => isStale(r, currentClassifier));
  }

  toJSON() {
    return this.#records;
  }

  save(path = this.path) {
    if (!path) throw new Error('no path to save to');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(this.#records, null, 2)}\n`);
    return path;
  }
}
