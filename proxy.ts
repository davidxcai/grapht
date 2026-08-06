import { clerkMiddleware } from '@clerk/nextjs/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

/**
 * `middleware.ts` was renamed to `proxy.ts` in Next 16; the export must be the
 * single default function.
 *
 * Clerk throws at request time when its keys are absent, which would take the
 * fixture-only demo path down with it — and that path has to run with no keys
 * of any kind (BRIEF.md). Pass the request through instead: `getSession()`
 * degrades to signed-out and every fixture screen still renders. Read the env
 * here rather than importing the flag from `lib/auth.ts`, because proxy runs
 * separately from render code and must not rely on shared modules.
 */
const handler = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return;
  return handler(request, event);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets, unless it carries a
    // query string — a signed OAuth callback lands on a normal path.
    '/((?!_next|captures|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
