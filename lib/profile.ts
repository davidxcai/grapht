/**
 * Types and constants only — **no Node built-ins and no database in this file.**
 *
 * The profile form is a client component and imports `SKIN_TYPES` from here.
 * Reading and writing the row lives in `lib/profile-store.ts`, which is marked
 * `server-only`; the same split as `lib/trials.ts` and `lib/trial-store.ts`, and
 * for the same reason.
 */

/**
 * Fitzpatrick is more clinically precise, but most people don't know their
 * number and it answers a UV question this product isn't asking
 * (docs/app-ui.md §2).
 */
export const SKIN_TYPES = ['oily', 'dry', 'combination', 'normal', 'sensitive'] as const;
export type SkinType = (typeof SKIN_TYPES)[number];

/**
 * Collected at onboarding and editable on `/profile`. Stored, not yet
 * enforced — nothing in the community surfaces (search, `/products`, comments)
 * reads it. It exists so the field isn't asked for twice once that gating is
 * built.
 */
export const PROFILE_VISIBILITIES = ['public', 'private'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/**
 * The half of an account Clerk has no opinion about.
 *
 * Clerk owns email, password, Google and the avatar. This owns the username,
 * skin type and birthday — and, by existing at all, the fact that an account
 * finished signing up. A signed-in user with no row is sent to `/welcome`.
 *
 * **None of it enters the measurement path.** Skin type and birthday can shape
 * who a reader compares themselves to and at most a sentence of framing; they
 * may never adjust, weight, or normalise a score (§2).
 */
export interface Profile {
  userId: string;
  username: string;
  skinType: SkinType;
  /** YYYY-MM-DD. A plain calendar date — no instant, no timezone. */
  birthday: string;
  visibility: ProfileVisibility;
}

export interface ProfileInput {
  username: string;
  skinType: SkinType;
  birthday: string;
  visibility: ProfileVisibility;
}
