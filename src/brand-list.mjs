/**
 * Parse the supported-brand list out of `skincare-data/skincare-brands.md`.
 *
 * The file was produced by a search-grounded model, so it carries the model's
 * *citation sources* interleaved with its answers — a brand line ends in a
 * markdown hard break and the next line is the site the claim came from. Those
 * lines look exactly like brands to a naive line-splitter, and "Scribd" and
 * "YouGov" would then be sent off to have their skincare barcodes harvested.
 *
 * Two independent signals catch them, and both are used because either alone is
 * fragile:
 *
 *   - a denylist of the six sources that actually appear, which survives the
 *     file being reformatted or the trailing whitespace being stripped;
 *   - the structural rule that a citation follows a hard-break line, which
 *     catches a *new* source the denylist has never seen.
 *
 * Anything dropped is returned rather than discarded silently, because the cost
 * of wrongly dropping a real brand is a brand that never gets harvested and
 * nobody notices.
 */

import { foldName as fold } from './products.mjs';

/**
 * Publications and retailers the grounded model cited. None is a skincare
 * brand. Compared case-insensitively after the same normalisation as a brand
 * name, so punctuation drift does not defeat it.
 */
const CITATION_SOURCES = [
  'YouGov',
  'Scribd',
  'Nordstrom',
  'WeArisma',
  'Luxury Lifestyle Awards',
  'Global Cosmetics News',
];

const DENY = new Set(CITATION_SOURCES.map(fold));

/**
 * Strip the decoration a markdown list may or may not carry. The current file
 * is bare lines, but a `1.` or `- ` prefix creeping in later should not turn
 * into part of the brand name and silently miss the cache.
 */
function cleanLine(line) {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*#+\s*/, '')
    .trim();
}

/**
 * Returns `{ brands, dropped }`.
 *
 * `brands` preserves file order and is deduplicated case-insensitively —
 * order matters only because it makes a partially-completed run easy to read
 * against the source file.
 */
export function parseBrandList(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const brands = [];
  const dropped = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const name = cleanLine(raw);
    if (!name) continue;

    const key = fold(name);
    if (!key) continue;

    if (DENY.has(key)) {
      dropped.push({ name, reason: 'known citation source' });
      continue;
    }

    // A markdown hard break (two trailing spaces) on the previous line means
    // this line is a continuation of it — which in this file is always the
    // citation for the brand above.
    if (i > 0 && /\S {2,}$/.test(lines[i - 1]) && cleanLine(lines[i - 1])) {
      dropped.push({ name, reason: 'follows a hard-break line (unlisted citation source)' });
      continue;
    }

    if (seen.has(key)) {
      dropped.push({ name, reason: 'duplicate' });
      continue;
    }

    seen.add(key);
    brands.push(name);
  }

  return { brands, dropped };
}

/** Split an array into fixed-size chunks, last one short. */
export function chunk(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`bad chunk size ${size}`);
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
