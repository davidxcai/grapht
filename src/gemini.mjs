/**
 * Shared Gemini plumbing: one client constructor, one retry policy.
 *
 * The LLM here is Gemini, not Claude — see CLAUDE.md. This module holds only
 * what every caller needs, so `product-targets.mjs` (classification) and
 * `barcode-harvest.mjs` (catalog seeding) share a single backoff policy rather
 * than drifting apart.
 *
 * Nothing in here can cost a YouCam unit. The two quotas are unrelated.
 */

import { GoogleGenAI } from '@google/genai';

export const MODEL = 'gemini-3.6-flash';

export function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenAI({ apiKey });
}

/**
 * Retry on 429 and 5xx with exponential backoff.
 *
 * The free tier's per-minute quota is small enough that a handful of calls back
 * to back will hit it, and grounded search burns it faster still. A rate limit
 * is a wait, not a failure, so it should not surface as a stack trace — but it
 * is also not worth retrying forever, because an exhausted *daily* quota
 * returns the same 429 and no amount of backoff fixes it.
 */
export async function withRetry(fn, { attempts = 4, baseDelayMs = 5000, onRetry = null } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status;
      if (status !== 429 && !(status >= 500 && status < 600)) throw err;
      lastError = err;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * 2 ** i;
      onRetry?.({ attempt: i + 1, delayMs: delay, status });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const kind = lastError?.status === 429 ? 'rate limit / quota' : 'server error';
  const err = new Error(
    `Gemini ${kind} persisted after ${attempts} attempts. If this is a free-tier daily quota, ` +
      `backoff will not help — check https://ai.dev/rate-limit.`,
  );
  err.status = lastError?.status;
  err.cause = lastError;
  throw err;
}
