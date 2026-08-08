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
 * verified to pass on a frame that 0.45 rejected. Do not lower this without
 * re-running scripts/test-face-fraction.mjs, and note that changing it
 * invalidates every cached analysis, since face scale drives texture and pore.
 */
export const TARGET_FACE_FRACTION = 0.55;

/** Face centre sits above the middle so neck and upper chest stay in shot. */
export const FACE_CENTER_Y = 0.42;

/** Matches the API's own internal working resolution. */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 2560;

/**
 * How far off `TARGET_FACE_FRACTION` a capture may land.
 *
 * Not a new number: `normalize-faces.mjs` has always reported a photo more than
 * 0.05 off target as `clamped`, meaning it could not be normalised to match the
 * others. Using the same figure live means the guide accepts exactly the frames
 * the cropper would have accepted, and the two cannot drift apart.
 *
 * The band matters as much as the target. Face scale drives pixels-per-cm of
 * skin and therefore texture and pore (CLAUDE.md rule 3), so it is a measurement
 * constraint, not framing preference — but pinning it exactly would be
 * unsatisfiable by a human holding a phone. 0.50–0.60 stays clear of the ~0.45
 * region where the API starts refusing, and is far tighter than the Camera Kit's
 * own 0.75–1.0, which had no upper bound worth the name.
 */
export const FACE_FRACTION_TOLERANCE = 0.05;
