import type { ZxcvbnResult } from '@zxcvbn-ts/core';

/**
 * Same engine and dictionary Clerk's own hosted UI scores passwords with
 * (`@clerk/shared`'s internal `loadZxcvbn`), so a score shown here matches
 * what `signUp.password()` will actually accept — this project's Clerk
 * instance enforces `min_zxcvbn_strength: 2` and no fixed character-class
 * rules (checked via the Frontend API's `/v1/environment`), so a static
 * "needs an uppercase letter" checklist would be fiction.
 */
type Scorer = (password: string, userInputs?: (string | number)[]) => ZxcvbnResult;

let scorerPromise: Promise<Scorer> | null = null;

function loadScorer(): Promise<Scorer> {
  if (!scorerPromise) {
    scorerPromise = Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
    ])
      .then(([{ ZxcvbnFactory }, { dictionary, adjacencyGraphs }]) => {
        const zxcvbn = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });
        return (password: string, userInputs?: (string | number)[]) =>
          zxcvbn.check(password, userInputs);
      })
      .catch((cause: unknown) => {
        // The cache must not hold a rejection: the dictionary is a lazy chunk
        // over the network, and caching the failed load would leave the meter
        // permanently unable to score for the rest of the page's life, with no
        // way for the next keystroke to retry.
        scorerPromise = null;
        throw cause;
      });
  }
  return scorerPromise;
}

export async function scorePassword(
  password: string,
  userInputs?: (string | number)[],
): Promise<ZxcvbnResult> {
  const check = await loadScorer();
  return check(password, userInputs);
}

/** Clerk's own pass/fail line, drawn at this instance's `min_zxcvbn_strength`. */
export const MIN_ZXCVBN_STRENGTH = 2;

export type { ZxcvbnResult };
