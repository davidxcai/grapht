/**
 * Where the face sits in a normalised frame, and how far off it may be.
 *
 * Split out of `face.mjs` so the live camera can import it: `face.mjs` pulls in
 * `sharp` and `@tensorflow/tfjs` at module scope, and neither belongs in a
 * browser bundle. These four numbers are the entire shared vocabulary between
 * the capture guide and the server-side cropper, and they have to agree — an
 * overlay drawn to different numbers than `computeCropBox()` uses would produce
 * captures that then get re-cropped, which is the one thing the guide exists to
 * avoid (`docs/capture-quality.md` §5).
 */

/**
 * Face height as a fraction of output height.
 *
 * Empirically the analysis API rejects anything near 0.45 with
 * `error_src_face_too_small` — at that size roughly a third of our photos failed,
 * deterministically, varying with head pose rather than randomly. 0.55 was
 * verified to pass on a frame that 0.45 rejected, so the floor is well
 * understood; there is no equivalent measured ceiling.
 *
 * Raised from 0.55 to 0.80 on 2026-08-09 — the on-screen guide at 0.55 read as
 * too small to feel like a real framing target. This has not been re-verified
 * against scripts/test-face-fraction.mjs (that script only walks upward
 * looking for the first *accepted* fraction, so it has nothing to say about an
 * upper bound); if live captures start coming back oddly cropped or the API
 * starts rejecting close-up frames, that script is where to check first.
 * Changing this value invalidates every cached analysis, since face scale
 * drives texture and pore, and it is also the default `targetFraction` for the
 * offline reference-series cropper in `src/face.mjs` — that pipeline's own
 * cached crops were produced at 0.55 and are unaffected by this default
 * changing, but a future run without an explicit override would silently stop
 * matching them (CLAUDE.md rule 3).
 */
export const TARGET_FACE_FRACTION = 0.8;

/** Face centre sits above the middle so neck and upper chest stay in shot. */
export const FACE_CENTER_Y = 0.42;

/** Matches the API's own internal working resolution. */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 2560;

/**
 * How far off `TARGET_FACE_FRACTION` a capture may land.
 *
 * The band matters as much as the target. Face scale drives pixels-per-cm of
 * skin and therefore texture and pore (CLAUDE.md rule 3), so it is a
 * measurement constraint, not framing preference — but pinning it exactly
 * would be unsatisfiable by a human holding a phone.
 *
 * Tightened from 0.15 to 0.10 alongside the 2026-08-09 target change above, so
 * the accepted band (0.70–0.90) sits close to the new target rather than
 * ballooning outward with it. This band is now snugger than the discarded
 * Camera Kit's own 0.75–1.0 floor-only range — watch for the same "hard to
 * satisfy" complaint that got Camera Kit removed if users report the shutter
 * rarely unlocking.
 */
export const FACE_FRACTION_TOLERANCE = 0.1;
