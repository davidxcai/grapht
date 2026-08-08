#!/usr/bin/env node
// The capture guide's geometry and thresholds. Offline, free, no camera.
//
// Worth having as a script rather than trusting the render loop: every number in
// `lib/capture-guide.ts` is a measurement constraint, and the cost of getting one
// wrong is a series of photos that look fine and are not comparable. The
// reference cases below come from docs/capture-quality.md §5 and src/face.mjs.

import assert from 'node:assert/strict';

import {
  cropWindow,
  gradeFrame,
  guideOval,
  isAnalysable,
  rollDegrees,
  yawRatio,
  describeLighting,
} from '../lib/capture-guide.ts';
import { FACE_CENTER_Y, TARGET_FACE_FRACTION } from '../src/face-geometry.mjs';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

/** A face box sitting exactly where the guide wants it, in a WxH window. */
function perfectFace(window) {
  const height = window.height * TARGET_FACE_FRACTION;
  const width = height * 0.78;
  return {
    x: window.width / 2 - width / 2,
    y: window.height * FACE_CENTER_Y - height / 2,
    width,
    height,
    // Eyes level, nose centred: roll 0, yaw 0.
    landmarks: [
      [window.width / 2 - width * 0.2, window.height * FACE_CENTER_Y - height * 0.1],
      [window.width / 2 + width * 0.2, window.height * FACE_CENTER_Y - height * 0.1],
      [window.width / 2, window.height * FACE_CENTER_Y],
      [window.width / 2, window.height * FACE_CENTER_Y + height * 0.2],
      [window.width / 2 - width * 0.5, window.height * FACE_CENTER_Y],
      [window.width / 2 + width * 0.5, window.height * FACE_CENTER_Y],
    ],
  };
}

const WINDOW = { x: 0, y: 0, width: 288, height: 384 };

console.log('\ncrop window — the frame is fixed, the user moves');

check('landscape 2560x1920 yields the tallest 3:4 window', () => {
  assert.deepEqual(cropWindow(2560, 1920), { x: 560, y: 0, width: 1440, height: 1920 });
});

check('portrait 1920x2560 is already 3:4 and is used whole', () => {
  assert.deepEqual(cropWindow(1920, 2560), { x: 0, y: 0, width: 1920, height: 2560 });
});

check('1440x1920 and 1920x2560 both clear the 1080px HD short side', () => {
  assert.equal(isAnalysable(cropWindow(2560, 1920)), true);
  assert.equal(isAnalysable(cropWindow(1920, 2560)), true);
});

check('1920x1080 does not — 810px across is below what HD accepts', () => {
  assert.deepEqual(cropWindow(1920, 1080), { x: 555, y: 0, width: 810, height: 1080 });
  assert.equal(isAnalysable(cropWindow(1920, 1080)), false);
});

check('the guide oval is drawn at the same numbers the cropper uses', () => {
  const oval = guideOval({ x: 0, y: 0, width: 300, height: 400 });
  assert.equal(oval.cy, 400 * FACE_CENTER_Y);
  assert.equal(oval.ry * 2, 400 * TARGET_FACE_FRACTION);
});

console.log('\npose — thresholds from docs/capture-quality.md §5');

check('roll reads off the eye line', () => {
  assert.equal(Math.round(rollDegrees([[0, 0], [100, 0]])), 0);
  assert.equal(Math.round(rollDegrees([[0, 0], [100, 100]])), 45);
  assert.equal(Math.round(rollDegrees([[0, 100], [100, 0]])), -45);
});

check('yaw is the nose offset in eye-widths', () => {
  assert.equal(yawRatio([[0, 0], [100, 0], [50, 0]]), 0);
  assert.equal(yawRatio([[0, 0], [100, 0], [65, 0]]), 0.15);
});

check("the reference series' own range passes as good", () => {
  // roll −3.4°…+4.9°, yaw −0.08…+0.03 across all 20 reference photos.
  for (const [roll, yaw] of [[-3.4, -0.08], [4.9, 0.03], [0, 0]]) {
    const face = perfectFace(WINDOW);
    const r = (roll * Math.PI) / 180;
    const eye = WINDOW.width * 0.1;
    face.landmarks[0] = [WINDOW.width / 2 - eye, WINDOW.height * FACE_CENTER_Y - eye * Math.tan(r)];
    face.landmarks[1] = [WINDOW.width / 2 + eye, WINDOW.height * FACE_CENTER_Y + eye * Math.tan(r)];
    face.landmarks[2] = [WINDOW.width / 2 + yaw * eye * 2, WINDOW.height * FACE_CENTER_Y];
    const state = gradeFrame([face], WINDOW, null);
    assert.equal(state.hint, 'ready', `roll ${roll} yaw ${yaw} gave "${state.hint}"`);
  }
});

console.log('\nframing');

check('a face at the target is ready', () => {
  const state = gradeFrame([perfectFace(WINDOW)], WINDOW, null);
  assert.equal(state.ready, true);
  assert.equal(Math.abs(state.faceFraction - TARGET_FACE_FRACTION) < 1e-9, true);
});

check('±0.05 off target is still accepted, matching normalize-faces.mjs', () => {
  for (const fraction of [0.51, 0.55, 0.59]) {
    const face = perfectFace(WINDOW);
    const height = WINDOW.height * fraction;
    face.height = height;
    face.y = WINDOW.height * FACE_CENTER_Y - height / 2;
    assert.equal(gradeFrame([face], WINDOW, null).ready, true, `fraction ${fraction}`);
  }
});

check('too far and too close are named separately', () => {
  const far = perfectFace(WINDOW);
  far.height = WINDOW.height * 0.4;
  far.y = WINDOW.height * FACE_CENTER_Y - far.height / 2;
  assert.equal(gradeFrame([far], WINDOW, null).hint, 'move-closer');

  const near = perfectFace(WINDOW);
  near.height = WINDOW.height * 0.75;
  near.y = WINDOW.height * FACE_CENTER_Y - near.height / 2;
  assert.equal(gradeFrame([near], WINDOW, null).hint, 'move-back');
});

check('nothing in frame is a search, not an error', () => {
  assert.equal(gradeFrame([], WINDOW, null).hint, 'searching');
});

check('a second face of comparable size blocks; a small one does not', () => {
  const face = perfectFace(WINDOW);
  const rival = { ...perfectFace(WINDOW), x: 10 };
  assert.equal(gradeFrame([face, rival], WINDOW, null).hint, 'multiple-faces');

  const background = perfectFace(WINDOW);
  background.height *= 0.4;
  background.width *= 0.4;
  assert.equal(gradeFrame([face, background], WINDOW, null).ready, true);
});

check('scale is judged before position, so one hint shows at a time', () => {
  const face = perfectFace(WINDOW);
  face.height = WINDOW.height * 0.3;
  face.x = 0;
  assert.equal(gradeFrame([face], WINDOW, null).hint, 'move-closer');
});

console.log('\nlighting — reported, never blocking');

check('the controlled reference range stays quiet', () => {
  // docs/capture-quality.md §2: controlled photos ran 1.09–1.16.
  for (const ratio of [1.09, 1.12, 1.16]) {
    assert.equal(describeLighting({ ratio, level: 0.5 }), null, `ratio ${ratio}`);
  }
});

check("the varied burst's extremes are called out", () => {
  // Same table: the deliberately badly-lit burst ran 0.88–1.51.
  assert.notEqual(describeLighting({ ratio: 0.88, level: 0.5 }), null);
  assert.notEqual(describeLighting({ ratio: 1.51, level: 0.5 }), null);
});

check('a dark room is mentioned', () => {
  assert.notEqual(describeLighting({ ratio: 1.12, level: 0.1 }), null);
});

check('uneven light never blocks the shutter', () => {
  const state = gradeFrame([perfectFace(WINDOW)], WINDOW, { ratio: 1.51, level: 0.5 });
  assert.equal(state.ready, true);
});

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
