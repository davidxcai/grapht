/**
 * Small fuzzy matcher for search (ideas.md): tolerant of a typo and of partial
 * words, cheap enough to run over everything in memory. No index, no
 * dependency — the corpus is trials, products and handles, which is hundreds
 * of rows, not millions.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Damerau-ish edit distance, capped — we only care about "within 1 or 2". */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

/**
 * How well `query` matches `text`. 0 is no match; higher is better. Every
 * query token has to land somewhere — as a substring, a word prefix, or a
 * word within one edit (two for long tokens).
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query).trim();
  const t = normalize(text);
  if (!q) return 0;
  if (t.includes(q)) return 100 - Math.min(50, t.length - q.length);

  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  let total = 0;
  for (const token of q.split(/\s+/)) {
    let best = 0;
    for (const word of words) {
      if (word === token) best = Math.max(best, 20);
      else if (word.startsWith(token)) best = Math.max(best, 12);
      else if (word.includes(token)) best = Math.max(best, 8);
      else if (token.length >= 4) {
        const cap = token.length >= 7 ? 2 : 1;
        if (editDistance(token, word, cap) <= cap) best = Math.max(best, 6);
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Filter and rank a list by a query over each item's searchable text. */
export function fuzzyRank<T>(query: string, items: T[], textOf: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, textOf(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
