/**
 * Face detection and standardised cropping.
 *
 * Two jobs, both required before anything is sent to the analysis API:
 *
 *   1. Fix `error_src_face_too_small`. The API downscales to 1920x2560 before
 *      detecting, so a face that looks fine in a 4032px iPad photo can end up
 *      below the detector's threshold.
 *
 *   2. Normalise face scale. Pixels-per-cm-of-skin drives the texture and pore
 *      models, so a photo taken at arm's length and one taken close up score
 *      differently on identical skin. Cropping every image so the face occupies
 *      the same fraction of the frame removes that as a confound — which matters
 *      here because the four capture devices are partly correlated with time.
 *
 * BlazeFace runs on the pure-JS tfjs backend (no native build) and works
 * unchanged in the browser, so the live capture path can reuse this later.
 */

import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import sharp from 'sharp';

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
const FACE_CENTER_Y = 0.42;

/** Matches the API's own internal working resolution. */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 2560;

/** Detection runs on a downscaled copy; full resolution buys nothing here. */
const DETECT_WIDTH = 512;

let modelPromise = null;
export function loadModel() {
  modelPromise ??= blazeface.load();
  return modelPromise;
}

/** Detect the largest face. Returns pixel coords in the source image, or null. */
export async function detectFace(imagePath) {
  const model = await loadModel();
  const image = sharp(imagePath);
  const { width, height } = await image.metadata();

  const scale = DETECT_WIDTH / width;
  const detectHeight = Math.round(height * scale);

  const { data } = await image
    .resize(DETECT_WIDTH, detectHeight, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const input = tf.tensor3d(new Uint8Array(data), [detectHeight, DETECT_WIDTH, 3]);
  let predictions;
  try {
    predictions = await model.estimateFaces(input, false);
  } finally {
    input.dispose();
  }

  if (predictions.length === 0) return null;

  // Largest detection wins — reflections and background faces should not.
  const best = predictions
    .map((p) => {
      const [x1, y1] = p.topLeft;
      const [x2, y2] = p.bottomRight;
      return { x: x1 / scale, y: y1 / scale, width: (x2 - x1) / scale, height: (y2 - y1) / scale,
               probability: Array.isArray(p.probability) ? p.probability[0] : p.probability };
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  return { ...best, sourceWidth: width, sourceHeight: height };
}

/**
 * Compute a crop box placing the face at a fixed scale and position.
 *
 * When the ideal box runs past the image edge it is shifted back inside, and only
 * shrunk if it genuinely cannot fit. `faceFraction` reports what was actually
 * achieved so callers can flag photos that could not be normalised.
 */
export function computeCropBox(face, targetFraction = TARGET_FACE_FRACTION) {
  const { sourceWidth: W, sourceHeight: H } = face;
  const aspect = OUTPUT_WIDTH / OUTPUT_HEIGHT;

  let cropH = face.height / targetFraction;
  let cropW = cropH * aspect;

  // Cannot invent pixels that are not there.
  if (cropW > W) { cropW = W; cropH = cropW / aspect; }
  if (cropH > H) { cropH = H; cropW = cropH * aspect; }

  const faceCenterX = face.x + face.width / 2;
  const faceCenterY = face.y + face.height / 2;

  let left = Math.round(faceCenterX - cropW / 2);
  let top = Math.round(faceCenterY - cropH * FACE_CENTER_Y);

  left = Math.max(0, Math.min(left, W - Math.round(cropW)));
  top = Math.max(0, Math.min(top, H - Math.round(cropH)));

  const width = Math.round(cropW);
  const height = Math.round(cropH);

  return { left, top, width, height, faceFraction: face.height / height };
}

/** Detect, crop, and resize to the standard output size. */
export async function normalizeFace(inputPath, outputPath, { targetFraction = TARGET_FACE_FRACTION } = {}) {
  const face = await detectFace(inputPath);
  if (!face) return { ok: false, reason: 'no face detected' };

  const box = computeCropBox(face, targetFraction);

  await sharp(inputPath)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toFile(outputPath);

  return {
    ok: true,
    face,
    box,
    faceFraction: box.faceFraction,
    // Face height in output pixels — the number the API's detector actually sees.
    faceHeightOut: Math.round(box.faceFraction * OUTPUT_HEIGHT),
  };
}
