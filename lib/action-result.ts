/**
 * What every server action returns, and the two ways they fail.
 *
 * Actions never throw at the client: a form has to be able to print the reason
 * next to the button that caused it, so a thrown error would only reach the
 * user as Next's generic digest. Every action therefore ends in an
 * `ActionResult`, and the `catch` arms all read the same — a sentence the user
 * can act on, then the underlying message after an em dash.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** The message an unknown `catch` value is worth showing. */
export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A refusal the app itself decided on — no exception behind it. */
export function failed(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** `failedBecause('Could not save the note', e)` → "Could not save the note — …". */
export function failedBecause(context: string, cause: unknown): { ok: false; error: string } {
  return { ok: false, error: `${context} — ${causeMessage(cause)}` };
}
