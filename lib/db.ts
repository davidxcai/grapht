import { neon } from '@neondatabase/serverless';

/**
 * Lazily-created Neon client.
 *
 * Deliberately not a module-level `neon(process.env.DATABASE_URL!)`: Next
 * evaluates top-level module code at build time, and `neon()` throws on a
 * missing URL, so an eager call turns "env var not pulled yet" into a failed
 * build rather than a failed request. Not a Proxy either — those break any
 * library that inspects the client object.
 */
let client: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
    }
    client = neon(url);
  }
  return client;
}
