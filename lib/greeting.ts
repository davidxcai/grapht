/**
 * Plain module on purpose: the dashboard computes the first paint on the server
 * and `components/greeting.tsx` recomputes it on the client, so this cannot live
 * in either — an export of a `'use client'` module is a client reference the
 * server is not allowed to call.
 */
export function timeGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
