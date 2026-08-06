/**
 * Group photo records into capture sessions (bursts): consecutive shots on the
 * same device within a short gap. A session is the natural unit for both noise
 * measurement (spread within a session is measurement noise, not biology) and
 * regression fitting (a 6-shot burst should count as one data point, not six).
 */

export const DEFAULT_SESSION_GAP_SECONDS = 300;

/** Split time-sorted records into sessions. Input need not be pre-sorted. */
export function groupSessions(records, { gapSeconds = DEFAULT_SESSION_GAP_SECONDS } = {}) {
  const sorted = [...records].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const sessions = [];
  for (const r of sorted) {
    const last = sessions.at(-1);
    const near =
      last &&
      last.at(-1).device === r.device &&
      (Date.parse(r.capturedAt) - Date.parse(last.at(-1).capturedAt)) / 1000 <= gapSeconds;
    if (near) last.push(r);
    else sessions.push([r]);
  }
  return sessions;
}
