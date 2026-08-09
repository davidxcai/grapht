import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

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

/**
 * Screens that cannot render anything for a signed-out visitor. Everything else
 * is public, and deliberately so: `/` and `/trials/[id]` carry the reference
 * series, which is a published sample that reads without an account, and
 * `/routines/[id]` is the same shape now that a routine can be published
 * (`lib/routines.ts`'s `getPublicRoutine()`) — `/routines/new` stays gated
 * because creating one always needs an owner, but `/routines/(.*)` is
 * deliberately not listed so a public routine's link works signed out.
 *
 * This is an optimistic check and not the security boundary. It reads the
 * session cookie and redirects, nothing more — ownership is enforced in
 * `lib/routines.ts` and `lib/trial-store.ts`, where every query is scoped to an
 * owner passed in by the caller, and again in each server action. A proxy alone
 * would protect the navigation to a page and none of the writes behind it.
 */
const requiresAccount = createRouteMatcher([
  '/trials/new',
  '/routines/new',
  '/welcome',
  '/profile',
]);

const handler = clerkMiddleware(async (auth, request) => {
  if (!requiresAccount(request)) return;

  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL('/login', request.url));
});

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
