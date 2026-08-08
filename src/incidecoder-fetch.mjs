/**
 * Shared HTTP fetch/backoff/self-throttle contract for incidecoder.com, used
 * by both the bulk crawler (scripts/scrape-incidecoder.mjs) and the daily
 * incremental sync (scripts/sync-catalog.mjs) — one implementation of the
 * politeness rules rather than two that could quietly drift apart.
 *
 * Extracted from scrape-incidecoder.mjs unchanged in behavior: each fetcher
 * paces its own requests `delayMs` apart, but every fetcher created against
 * the same `breaker` object shares one circuit: the instant any of them sees
 * a 429, every fetcher's next request waits out the backoff (Retry-After if
 * sent, else 60s) AND `breaker.concurrency` permanently drops to 1 for the
 * rest of the run — back to the one setting already proven safe, rather than
 * probing for the actual edge. It does not climb back up once tripped.
 */

export const INCIDECODER_BASE = 'https://incidecoder.com';

// Identifies the script and its pacing so a human looking at server logs
// doesn't have to guess why one IP is making slow, steady GETs.
export const INCIDECODER_UA =
  'grapht-research-bot/1.0 (+personal research project; throttled with backoff on 429; contact via incidecoder account natashag)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `breaker` is `{ pausedUntil, concurrency }`, shared by reference across
 * every fetcher a caller creates — plain numbers can't be shared across
 * closures like this, which is why it's an object rather than two arguments.
 * `onRateLimited(backoffMs, { concurrencyDropped })` fires on every 429, so
 * the caller can log it; `concurrencyDropped` is true only the moment
 * concurrency actually drops (not on every subsequent 429 while already at
 * 1), matching the two distinct log lines the original inline version printed.
 *
 * Returns HTML text, or `null` for a 404.
 */
export function createFetcher({ delayMs, breaker, onRateLimited }) {
  let lastRequestAt = 0;
  return async function fetchPage(url) {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(delayMs - (Date.now() - lastRequestAt), breaker.pausedUntil - Date.now());
      if (wait > 0) await sleep(wait);

      lastRequestAt = Date.now();
      let res;
      try {
        res = await fetch(url, { headers: { 'User-Agent': INCIDECODER_UA, 'Accept-Language': 'en-US,en;q=0.9' } });
      } catch (err) {
        if (attempt >= 3) throw new Error(`network error after 3 attempts: ${err.message}`);
        await sleep(5000);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60000;
        breaker.pausedUntil = Math.max(breaker.pausedUntil, Date.now() + backoffMs);
        const concurrencyDropped = breaker.concurrency > 1;
        if (concurrencyDropped) breaker.concurrency = 1;
        onRateLimited?.(backoffMs, { concurrencyDropped }, url);
        continue; // retry the same URL once the shared pause clears
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        if (attempt >= 3) throw new Error(`HTTP ${res.status} after 3 attempts`);
        await sleep(5000);
        continue;
      }

      return res.text();
    }
  };
}
