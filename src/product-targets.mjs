/**
 * Map a product onto a ranked subset of the 14 analysis concerns, using Gemini.
 *
 * This is constrained classification into a fixed vocabulary with a human in the
 * loop — never open generation. The model picks from a schema `enum`; it cannot
 * invent a concern name, and anything that somehow escapes the enum is dropped
 * by src/concerns.mjs on the way out.
 *
 * The single most important behaviour here is that it **biases narrow**, and the
 * reason is in the attribution table (docs/trial-model.md). Over-broad targets
 * do not merely add noise, they destroy the output: if every intervention
 * targets eight concerns, `|T| > 1` fires on nearly every metric, every result
 * comes back "shared, unsplittable", and nothing is ever attributable to
 * anything. Sparse targets fail the other way — real effects surface in the
 * `unexplained` row, where they are visible and the user can correct them.
 *
 * So the classifier returns everything it considered, ranked, and only the top
 * few are pre-ticked. The rest are offered as suggestions.
 *
 * Two calls, deliberately separate:
 *   lookupInciByName()  Google-Search-grounded retrieval of a published INCI list
 *   classify()          structured-output classification (no tools, no search)
 * Gemini 3 does allow grounding and structured output in one call, but keeping
 * them apart means the classification step stays pure, cacheable, and
 * schema-constrained, and the messy retrieval step can fail without taking it
 * down. It also keeps a hallucinated ingredient list from flowing straight into
 * a cache record without a human seeing the source URL first.
 */

import { readFile } from 'node:fs/promises';
import { client, MODEL, withRetry } from './gemini.mjs';
import { ANALYSIS_CONCERNS, normalizeConcerns } from './concerns.mjs';

/**
 * Bump this whenever the prompt, schema, or model below changes in a way that
 * could move the output. It is stamped onto every cache record so stale
 * derivations are identifiable rather than silently mixed in with current ones
 * — the same discipline as the `hd_f055_*` analysis cache key.
 */
export const PROMPT_VERSION = '2026-08-04.2-gemini';

export const CLASSIFIER = { model: MODEL, promptVersion: PROMPT_VERSION };

/** How many concerns get pre-ticked, at most. See the narrow-bias note above. */
export const MAX_PRETICKED = 3;

const SYSTEM = `You classify skincare products against a fixed vocabulary of 14 skin-analysis metrics.

The metrics are measured from standardised daily selfies. A product "targets" a metric if using it would plausibly change what that metric measures — in EITHER direction. A comedogenic oil targets acne just as a salicylic acid does; a drying retinoid targets moisture. Direction is not your concern, only whether the metric is in play.

Rank strictly. Your output feeds an attribution engine that can only name a single product per metric when exactly one product targets it. If you list eight metrics for a moisturiser, every metric in the trial becomes "credit shared, cannot be split" and the user learns nothing. Err toward too few.

Use confidence honestly:
- "high" — this is what the product is FOR. A BHA exfoliant and texture. A hyaluronic serum and moisture. Usually one or two metrics, occasionally none if the product is a bland cleanser.
- "medium" — a well-established secondary effect, not the product's purpose.
- "low" — plausible, weak, or true of almost any product in this category. Listing "moisture" for every cream that contains glycerin belongs here.

Do not pad the list to seem thorough. A plain gentle cleanser may legitimately have zero high-confidence metrics; say so rather than reaching.

For "because", give the specific reason in under 15 words — name the active or mechanism, not a restatement of the metric.`;

/**
 * Structured-output schema. The `enum` is the vocabulary guard — it is what
 * makes this classification rather than generation.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    productType: {
      type: 'string',
      description: 'Short category, e.g. "BHA exfoliant", "ceramide moisturiser", "oral retinoid".',
    },
    ranked: {
      type: 'array',
      description: 'Every metric plausibly in play, most confident first. May be empty.',
      items: {
        type: 'object',
        properties: {
          concern: { type: 'string', enum: ANALYSIS_CONCERNS },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          because: { type: 'string' },
        },
        required: ['concern', 'confidence', 'because'],
      },
    },
    durationClaimDays: {
      type: ['integer', 'null'],
      description:
        'If the label makes a time-bound claim ("results in 4 weeks"), that many days. Otherwise null. Do not invent one.',
    },
  },
  required: ['productType', 'ranked', 'durationClaimDays'],
};

/** Build the request parts from whatever identity we happen to have. */
async function buildParts({ brand, name, inci, signals, labelImagePath }) {
  const parts = [];

  if (labelImagePath) {
    const bytes = await readFile(labelImagePath);
    const mimeType = labelImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: bytes.toString('base64') } });
  }

  const text = [];
  if (brand || name) text.push(`Product: ${[brand, name].filter(Boolean).join(' — ')}`);
  if (inci?.length) text.push(`Ingredients (INCI, concentration order):\n${inci.join(', ')}`);

  // The deterministic lexicon's read of the ingredient data, offered as
  // corroboration rather than instruction. The model is told it may disagree,
  // because the lexicon is coarse and regex-driven — treating it as ground
  // truth would just launder its false positives through a more confident voice.
  if (signals?.length) {
    text.push(
      `An ingredient-database pass suggested these, from keyword matching alone. It is coarse and often over-broad. Treat it as one weak opinion, not as instruction — disagree freely:\n${signals
        .map((s) => `- ${s.concern} (${s.weight}): ${s.because}`)
        .join('\n')}`,
    );
  }
  if (labelImagePath) {
    text.push('A photo of the product is attached. Read the label and ingredient panel if visible.');
  }
  if (!text.length) throw new Error('classify() needs at least a name, an INCI list, or a photo');

  parts.push({ text: text.join('\n\n') });
  return parts;
}

/**
 * Classify a product. Returns `{ productType, ranked, targets, suggestions,
 * durationClaimDays, rejected, classifier }` where `targets` is the pre-ticked
 * subset and `ranked` is everything considered.
 */
export async function classify(
  { brand = null, name = null, inci = null, signals = null, labelImagePath = null } = {},
  { genai = null, maxPreticked = MAX_PRETICKED, onRetry = null } = {},
) {
  const ai = genai ?? client();
  const parts = await buildParts({ brand, name, inci, signals, labelImagePath });

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseJsonSchema: SCHEMA,
          // Classification against a fixed vocabulary does not need deep
          // reasoning, and higher levels measurably encourage the model to
          // justify a longer list — the exact failure this module exists to
          // avoid.
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    { onRetry },
  );

  return parseClassification(response, { maxPreticked });
}

/**
 * Pull the structured payload out of a response and apply the pre-tick policy.
 *
 * Split out from `classify` so tests can drive it from a fixture with no
 * network, and so a cached raw response can be re-parsed after a policy change
 * without paying for the call again.
 */
export function parseClassification(response, { maxPreticked = MAX_PRETICKED } = {}) {
  // Gemini surfaces a block two ways: the whole prompt rejected up front
  // (promptFeedback.blockReason), or a candidate stopped mid-flight with a
  // non-STOP finishReason. Neither is an exception, so both must be checked
  // explicitly — otherwise a blocked request parses as "no targets found",
  // which is indistinguishable from a legitimate bland cleanser.
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`classification blocked: ${blocked}`);

  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') {
    throw new Error(`classification did not complete: ${finish}`);
  }

  const text = response.text;
  if (!text) throw new Error('no text in classification response');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`classification response was not JSON: ${text.slice(0, 200)}`);
  }

  // The schema enum should make this a no-op. It is here anyway because rule 5
  // in CLAUDE.md says every concern name routes through concerns.mjs, and
  // because `drop` is the right behaviour for model output specifically — one
  // bad suggestion should cost that suggestion, not the whole product.
  const { concerns: valid, rejected } = normalizeConcerns(
    (raw.ranked ?? []).map((r) => r.concern),
    { drop: true },
  );

  const ranked = (raw.ranked ?? [])
    .map((r) => ({
      concern: normalizeConcerns([r.concern], { drop: true }).concerns[0] ?? null,
      confidence: r.confidence,
      because: r.because,
    }))
    .filter((r) => r.concern !== null && valid.includes(r.concern));

  // Pre-tick high confidence only, capped. Medium and low are surfaced as
  // suggestions the user can add — visible, but not accepted by default, which
  // is what keeps an eight-metric ingredient story from becoming an
  // eight-metric intervention.
  const targets = ranked
    .filter((r) => r.confidence === 'high')
    .slice(0, maxPreticked)
    .map((r) => r.concern);

  return {
    productType: raw.productType ?? null,
    ranked,
    targets,
    suggestions: ranked.filter((r) => !targets.includes(r.concern)).map((r) => r.concern),
    durationClaimDays: raw.durationClaimDays ?? null,
    rejected,
    classifier: CLASSIFIER,
  };
}

/**
 * Read the INCI list off a photo of a product's ingredient panel.
 *
 * This is the most reliable enrichment path in the whole design and, on a free
 * Gemini tier, the *only* automatic one: `lookupInciByName()` needs Google
 * Search grounding, which is paid-tier only (429 on free), whereas vision is
 * not. It also works on products no database has ever heard of, which is most
 * of them.
 *
 * Transcription only — the model is explicitly told not to complete, correct,
 * or infer ingredients it cannot read, because a plausible-looking invented
 * ingredient is indistinguishable from a real one downstream and would be
 * cached and used to attribute measured skin changes. `legible: false` means
 * show it to the user before trusting it.
 */
export async function readInciFromPhoto(imagePath, { genai = null, onRetry = null } = {}) {
  const ai = genai ?? client();
  const bytes = await readFile(imagePath);
  const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: bytes.toString('base64') } },
              { text: 'Transcribe the ingredient panel in this photo.' },
            ],
          },
        ],
        config: {
          systemInstruction: `You transcribe cosmetic ingredient (INCI) panels from photographs.

Transcribe ONLY what is legibly printed, in the order printed. Concentration order is meaningful, so never reorder.

Do not complete a partially visible list, correct a misspelling into the ingredient you assume was meant, or add anything you expect to be present but cannot actually read. An invented ingredient cannot be distinguished from a real one later, and this list is used to attribute measured changes in someone's skin.

If part of the panel is cut off, blurred, or obscured, transcribe what you can and set legible to false.`,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: {
              inci: { type: 'array', items: { type: 'string' } },
              legible: { type: 'boolean' },
              note: {
                type: ['string', 'null'],
                description: 'What was unreadable, if anything. Null when the panel was fully legible.',
              },
            },
            required: ['inci', 'legible', 'note'],
          },
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    { onRetry },
  );

  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`panel transcription blocked: ${blocked}`);
  const finish = response.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') throw new Error(`panel transcription did not complete: ${finish}`);

  try {
    const parsed = JSON.parse(response.text ?? '');
    return {
      inci: Array.isArray(parsed.inci) ? parsed.inci : [],
      legible: parsed.legible === true,
      note: parsed.note ?? null,
    };
  } catch {
    return { inci: [], legible: false, note: 'response was not JSON' };
  }
}

/**
 * Find a published INCI list for a named product, using Google Search grounding.
 *
 * ⚠️ **Paid tier only.** Google Search grounding returns 429 on a free Gemini
 * key even when plain generation succeeds on the same key. On free tier, use
 * `readInciFromPhoto()` instead — see docs/product-identity.md.
 *
 * This is the "I googled it and the answer appeared" path, and it is the reason
 * a name→barcode bridge is optional: brands publish ingredient panels on their
 * own product pages, so a search-grounded model reaches an ingredient list in
 * one hop where name → barcode → ingredient list is two and fails wherever
 * cosmetics barcode coverage is thin.
 *
 * Returns `{ inci, sourceUrl, confident, groundingUrls }`. **Never trust it
 * silently**: an ingredient list is exactly the kind of thing a model will
 * produce a plausible-looking guess at, and a wrong one gets cached and then
 * used to attribute real measured skin changes. `confident: false` means show it
 * to the user before it becomes a record; `groundingUrls` are the pages actually
 * retrieved, so the claim can be checked against something.
 */
export async function lookupInciByName({ brand, name }, { genai = null, onRetry = null } = {}) {
  const ai = genai ?? client();
  const query = [brand, name].filter(Boolean).join(' ');
  if (!query) throw new Error('lookupInciByName needs a brand or name');

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `Ingredient list for: ${query}` }] }],
        config: {
          systemInstruction: `Find the published INCI ingredient list for a specific skincare product.

Prefer the brand's own product page, then a major retailer. Do NOT reconstruct a plausible ingredient list from memory or from a similar product — a wrong list is worse than no list, because it will be cached and used to attribute measured skin changes.

Reply with a single JSON object and nothing else:
{"inci": ["Ingredient", ...], "sourceUrl": "...", "confident": true|false}

Set confident to false if you could not find the exact product, found conflicting lists, or are extrapolating from a variant. If you found nothing usable, return an empty inci array.`,
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    { onRetry },
  );

  // Grounded responses are not JSON-mode (the search tool interleaves its own
  // content), so the payload is fished out of the text rather than parsed
  // wholesale. This is also why this call is kept separate from classify().
  const text = response.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);

  const groundingUrls = (
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  )
    .map((c) => c.web?.uri)
    .filter(Boolean);

  if (!match) return { inci: [], sourceUrl: null, confident: false, groundingUrls };

  try {
    const parsed = JSON.parse(match[0]);
    return {
      inci: Array.isArray(parsed.inci) ? parsed.inci : [],
      sourceUrl: parsed.sourceUrl ?? null,
      // A list with no retrieved page behind it is a memory reconstruction, not
      // a lookup, regardless of how confident the model claims to be.
      confident: parsed.confident === true && groundingUrls.length > 0,
      groundingUrls,
    };
  } catch {
    return { inci: [], sourceUrl: null, confident: false, groundingUrls };
  }
}
