/**
 * Where a swallowed error goes.
 *
 * Several reads here degrade rather than throw on purpose — nothing that
 * renders the fixture may require the database (CLAUDE.md, "The web app"), a
 * Clerk outage costs a session and never a page, a lost view is not worth an
 * error. That posture is deliberate and stays. What was not deliberate is that
 * every one of those catches was also *silent*: an empty community feed, a
 * dashboard with no trials, a product page 404 and a genuinely empty database
 * all rendered identically, with nothing in the server log to tell them apart.
 *
 * `degraded()` is the one place a caught-and-absorbed failure is recorded. It
 * never rethrows and never changes what the caller returns; it exists so the
 * degradation is visible to whoever is reading the logs. Pass the function or
 * surface as `scope` so the line says which read gave up.
 */
export function degraded(scope: string, error: unknown, note?: string): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[degraded] ${scope}${note ? ` — ${note}` : ''}: ${message}`);
}
