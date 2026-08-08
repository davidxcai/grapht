/**
 * Seed a brand -> barcode table by asking Gemini to recall published UPC/EANs.
 *
 * This exists to close the one gap `docs/product-identity.md` measures and does
 * not solve: there is no product-name search anywhere in the INCI API, every
 * product endpoint is barcode-keyed, and Shopify redacts `barcode` from the
 * public storefront endpoint. A typed product name therefore has nothing to
 * resolve against. A pre-seeded table gives it one.
 *
 * **What comes out of here is a candidate, never an identity.** The model is
 * recalling strings it saw during training; some will be real, some will be
 * near-misses, and some will be invented. That is accepted deliberately —
 * nothing here touches the measurement path, and the whole output is filtered
 * twice before it can mean anything:
 *
 *   1. the GS1 check digit, here, free — kills most fabrications with no quota
 *      spend at all (`validGtin`, ~90% rejection on arbitrary digit strings);
 *   2. the INCI API, in `scripts/verify-barcodes.mjs` — the only thing that can
 *      say a code corresponds to a product that exists.
 *
 * The failure that survives both filters is the one worth designing against: a
 * fabricated code that happens to be checksum-valid *and* happens to be a real
 * product from some other brand. That is why every candidate carries the brand
 * and product name the model asserted — phase 2 compares them against what INCI
 * returns, so a code that resolves to the wrong thing is reported as a mismatch
 * rather than quietly filed as a verified CeraVe cleanser.
 *
 * Costs Gemini quota only. Cannot touch the YouCam unit budget.
 */

import { validGtin, foldName } from './products.mjs';
import { client, MODEL, withRetry } from './gemini.mjs';

/**
 * Bump when the prompt or schema below changes in a way that could move the
 * output, so cached batches from an older prompt are identifiable rather than
 * silently mixed in. Same discipline as `PROMPT_VERSION` in product-targets.
 */
export const HARVEST_PROMPT_VERSION = '2026-08-07.1';

export const HARVESTER = { model: MODEL, promptVersion: HARVEST_PROMPT_VERSION };

/**
 * The instruction that matters is "omit rather than invent".
 *
 * Asking for *exactly* N barcodes per brand manufactures hallucinations: a
 * model that recalls eleven real codes and is told to produce fifty will pad
 * the remaining thirty-nine, and padding is generated digit by digit, which is
 * precisely the output the check digit and the INCI lookup then have to burn
 * effort rejecting. A short honest list is strictly more useful than a long
 * padded one, so N is framed as a ceiling throughout.
 */
const SYSTEM = [
  'You are a product metadata and GTIN recall tool for retail skincare products.',
  'Output only JSON matching the provided schema. No prose, no markdown fences.',
  '',
  'Rules, in priority order:',
  '1. Report only barcodes you actually recall being printed on a real retail package.',
  '2. Never construct, compute, guess, or pattern-fill a barcode. Do not derive a check',
  '   digit to make a number look valid. An invented code is far worse than a missing one,',
  '   because it is indistinguishable from a real one downstream.',
  '3. Returning fewer products than the maximum is correct and expected. Returning zero for',
  '   a brand you do not have package-level recall of is correct. Do not pad the list.',
  '4. Give the barcode exactly as printed: digits only, no spaces or hyphens. UPC-A is 12',
  '   digits, EAN-13 is 13. Do not strip or add a leading zero.',
  '5. One entry per package size. The same product in 8 oz and 16 oz has two different',
  '   barcodes; if you only recall one size, return only that one.',
  '6. Only skincare (cleansers, moisturisers, serums, treatments, sunscreens). No makeup,',
  '   haircare, fragrance, or gift sets.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    brands: {
      type: 'array',
      description: 'One entry per brand asked about, in the order given, even if products is empty.',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: 'The brand name exactly as given in the prompt.' },
          products: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Product name without the brand and without the size.',
                },
                size: {
                  type: 'string',
                  description: 'Package size as printed, e.g. "8 oz (236 mL)". Empty string if not recalled.',
                },
                barcode: {
                  type: 'string',
                  description: 'UPC-A (12) or EAN-13 (13) digits, exactly as printed. Digits only.',
                },
              },
              required: ['name', 'size', 'barcode'],
            },
          },
        },
        required: ['brand', 'products'],
      },
    },
  },
  required: ['brands'],
};

/**
 * Ask for one batch of brands. Returns the raw Gemini response object — the
 * caller persists it verbatim before any parsing, so a schema or policy change
 * can be replayed against what the model actually said without paying again.
 */
export async function harvestBatch(brands, { genai = null, perBrand = 50, onRetry = null } = {}) {
  if (!brands?.length) throw new Error('harvestBatch needs at least one brand');
  const ai = genai ?? client();

  const prompt = [
    `For each of the following ${brands.length} skincare brands, list up to ${perBrand} distinct`,
    'retail skincare products with the UPC or EAN barcode printed on the package.',
    '',
    ...brands.map((b, i) => `${i + 1}. ${b}`),
    '',
    'Include every brand in the output, with an empty product list where you have no',
    'package-level recall. Do not pad a list to reach the maximum.',
  ].join('\n');

  return withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseJsonSchema: SCHEMA,
          // Recall against a fixed list, not reasoning. Higher thinking levels
          // give the model room to reason its way toward a plausible-looking
          // number, which is the one thing this prompt is trying to prevent.
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    { onRetry },
  );
}

/** Raised when the model was cut off mid-JSON — recoverable by shrinking the batch. */
export class TruncatedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TruncatedError';
    this.truncated = true;
  }
}

/**
 * Pull candidates out of a raw response and apply the check digit.
 *
 * Split from `harvestBatch` so a cached response can be re-parsed after a
 * policy change with no network and no quota, exactly as `parseClassification`
 * is split from `classify`.
 *
 * Returns `{ candidates, rejected, brandsSeen }`. A rejected row is kept with
 * its reason rather than dropped, because the reject rate per brand is the only
 * cheap read on how much of this the model is making up.
 */
export function parseHarvest(response, { requested = [] } = {}) {
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`harvest blocked: ${blocked}`);

  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason;
  // MAX_TOKENS is the expected failure at large batch sizes and is the one
  // finish reason worth distinguishing: the fix is a smaller batch, not a
  // retry, because retrying the same request produces the same truncation.
  if (finish === 'MAX_TOKENS') {
    throw new TruncatedError('response hit the output token limit — retry with a smaller batch');
  }
  if (finish && finish !== 'STOP') throw new Error(`harvest did not complete: ${finish}`);

  const text = response.text;
  if (!text) throw new Error('no text in harvest response');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // Valid JSON is schema-enforced, so a parse failure here almost always
    // means the payload was cut off rather than malformed.
    throw new TruncatedError(`harvest response was not JSON (likely truncated): ${text.slice(-120)}`);
  }

  const candidates = [];
  const rejected = [];
  const brandsSeen = [];
  // Case-insensitive lookup back to the brand string we asked with, so the
  // stored record uses our spelling rather than the model's reformatting of it.
  const asked = new Map(requested.map((b) => [foldName(b), b]));
  const seenCodes = new Set();

  for (const entry of raw.brands ?? []) {
    const brandKey = foldName(entry?.brand);
    const brand = asked.get(brandKey) ?? entry?.brand ?? null;
    if (!brand) continue;
    brandsSeen.push(brand);

    for (const p of entry?.products ?? []) {
      const digits = String(p?.barcode ?? '').replace(/\D/g, '');
      const row = {
        brand,
        name: String(p?.name ?? '').trim() || null,
        size: String(p?.size ?? '').trim() || null,
        barcode: digits || null,
      };

      if (!row.name || !digits) {
        rejected.push({ ...row, reason: 'missing name or barcode' });
        continue;
      }
      if (!validGtin(digits)) {
        rejected.push({ ...row, reason: 'check digit failed' });
        continue;
      }
      // A repeated code inside one response means the model reused a number it
      // recalled for a different product — treat the duplicate as unreliable
      // rather than storing two names against one identity.
      if (seenCodes.has(digits)) {
        rejected.push({ ...row, reason: 'duplicate barcode within batch' });
        continue;
      }

      seenCodes.add(digits);
      candidates.push(row);
    }
  }

  return { candidates, rejected, brandsSeen };
}
