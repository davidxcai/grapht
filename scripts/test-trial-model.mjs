#!/usr/bin/env node
/**
 * The trial model and the detail page's maths (`lib/trials.ts`,
 * `lib/trial-detail.ts`). Offline, deterministic, free — no database, no
 * fixture on disk, no API key.
 *
 * These two modules had no tests at all, and they are where the app decides
 * what it claims: which day a trial is on, how many of its photos were ever
 * analysed, whether a metric moved further than the camera's own wobble, and
 * whether a finished trial is allowed to say anything at all. Every case below
 * pins a rule that is written down in CLAUDE.md or docs/trial-model.md rather
 * than a shape the current implementation happens to return.
 *
 *   node scripts/test-trial-model.mjs
 *   node scripts/test-trial-model.mjs wobble   # only matching cases
 *
 * Node <23.6 needs `--experimental-strip-types` to import the `.ts` modules
 * under test, exactly as `scripts/test-capture-guide.mjs` does.
 */

import { register } from 'node:module';

// `lib/trials.ts` and `lib/trial-detail.ts` are imported by client components
// and use the `@/` alias throughout; the hook resolves it (and the JSON import
// of the device-offset table) the way the bundler does. Registered before the
// dynamic imports below, which is why they are dynamic.
register('./alias-hook.mjs', import.meta.url);

const {
  analyzedCaptureCount,
  baselineNames,
  baselineTargets,
  captureRole,
  hoursLabel,
  interventionLabel,
  interventionTargets,
  isInconclusive,
  timeSinceApplied,
  toCardData,
} = await import('../lib/trials.ts');

const { WOBBLE, directionOf, logRecord, metricChanges, readingAtCapture, trackedConcerns } =
  await import('../lib/trial-detail.ts');

const offsets = (await import('../fixtures/device-offsets.json')).default;

/* ---------- tiny harness, same shape as test-attribution.mjs ---------- */

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let passed = 0;
let failed = 0;

function test(name, fn) {
  if (filters.length && !filters.some((f) => name.toLowerCase().includes(f.toLowerCase()))) return;
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').join('\n       ')}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}\n  expected: ${e}\n  actual:   ${a}`);
}

function close(actual, expected, what, tolerance = 1e-6) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${what}\n  expected: ${expected} (±${tolerance})\n  actual:   ${actual}`);
  }
}

/* ---------- fixtures ---------- */

const BASELINE_DEVICE = offsets.baseline;
/** The one device in the table with large, known, non-zero offsets. */
const OTHER_DEVICE = 'iPad Pro (12.9-inch) (6th generation)';

function capture(id, capturedAt, concerns = null, device = BASELINE_DEVICE) {
  return { id, capturedAt, device, concerns };
}

/** A concern map: `{ acne: 50 }` becomes the measured shape the app reads. */
function scores(values, { synthetic = [] } = {}) {
  return Object.fromEntries(
    Object.entries(values).map(([concern, raw]) => [
      concern,
      { raw, ui: null, ...(synthetic.includes(concern) ? { synthetic: true } : {}) },
    ]),
  );
}

function routineSnapshot(name, items) {
  return {
    routineId: `routine_${name}`,
    routineName: name,
    items: items.map((i) => ({ brand: null, name: i.name, targets: i.targets, catalogProductId: null })),
    coverage: items.flatMap((i) => i.targets),
    frozenAt: '2026-08-01T00:00:00.000Z',
  };
}

function trial(overrides = {}) {
  return {
    id: 'trial_1',
    name: 'Retinol',
    status: 'active',
    visibility: 'private',
    window: { startDate: '2026-08-01', endDate: '2026-08-30', endDateSource: 'user-chosen' },
    timeOfDay: 'am',
    frequency: { kind: 'daily' },
    routine: { baseline: [], interventions: [] },
    captures: [],
    ...overrides,
  };
}

/* ---------- time since applied ---------- */

console.log('\ntime since applied — a measured gap, or an admitted guess');

test('no check-in ever pressed means there is nothing to report', () => {
  eq(timeSinceApplied(undefined, '2026-08-02T07:00:00.000Z'), null, 'null, not zero');
  eq(timeSinceApplied([], '2026-08-02T07:00:00.000Z'), null, 'null on an empty list');
});

test('the nearest check-in at or before the capture wins', () => {
  const result = timeSinceApplied(
    ['2026-08-01T22:00:00.000Z', '2026-08-02T06:00:00.000Z'],
    '2026-08-02T07:00:00.000Z',
  );
  eq(result, { hours: 1, assumed: false }, 'one hour, measured');
});

test('check-ins after the capture are not evidence about it', () => {
  const result = timeSinceApplied(
    ['2026-08-02T06:00:00.000Z', '2026-08-02T20:00:00.000Z'],
    '2026-08-02T07:00:00.000Z',
  );
  eq(result, { hours: 1, assumed: false }, 'the later check-in is ignored');
});

test('exactly 24 hours is still measured, not assumed', () => {
  const result = timeSinceApplied(['2026-08-01T07:00:00.000Z'], '2026-08-02T07:00:00.000Z');
  eq(result, { hours: 24, assumed: false }, 'the boundary belongs to measured');
});

test('a stale check-in projects its clock time forward and says so', () => {
  // Pressed at 22:00 two days earlier; a 07:00 photo reads as 9 hours, flagged.
  const result = timeSinceApplied(['2026-07-31T22:00:00.000Z'], '2026-08-02T07:00:00.000Z');
  close(result.hours, 9, 'nine hours since the projected 22:00');
  eq(result.assumed, true, 'flagged as assumed rather than passing as measured');
});

test('unparseable check-ins are dropped rather than poisoning the gap', () => {
  const result = timeSinceApplied(['not a date', '2026-08-02T06:00:00.000Z'], '2026-08-02T07:00:00.000Z');
  eq(result, { hours: 1, assumed: false }, 'the good one still wins');
});

test('hours read to the half hour, which is as fine as anyone can claim', () => {
  eq(hoursLabel(8), '8 h', 'whole hours carry no decimal');
  eq(hoursLabel(3.4), '3.5 h', 'rounded to the nearest half');
  eq(hoursLabel(3.2), '3 h', 'and back to whole when that is nearest');
});

/* ---------- the dashboard card ---------- */

console.log('\nthe card — the day number advances whether or not you log');

test('a fixed window has a denominator and the day number is 1-indexed', () => {
  const card = toCardData(trial(), new Date('2026-08-01T09:00:00'));
  eq(card.totalDays, 30, '1 Aug to 30 Aug inclusive');
  eq(card.dayNumber, 1, 'a trial that exists is on at least day 1');
  eq([card.daysLogged, card.loggedToday], [0, false], 'nothing logged yet');
});

test('an open-ended trial has no denominator and keeps counting', () => {
  const open = trial({ window: { startDate: '2026-08-01', endDate: null, endDateSource: null } });
  const card = toCardData(open, new Date('2026-09-10T09:00:00'));
  eq(card.totalDays, null, 'the absent denominator is the signal');
  eq(card.dayNumber, 41, 'past any 30-day marker, because there is none');
});

test('a fixed window clamps the day number instead of overrunning it', () => {
  const card = toCardData(trial(), new Date('2026-09-15T09:00:00'));
  eq(card.dayNumber, 30, 'never day 46 of 30');
});

test('a completed trial reads as its full window, not the day it is viewed on', () => {
  const done = trial({ status: 'completed' });
  eq(toCardData(done, new Date('2026-08-10T09:00:00')).dayNumber, 30, 'pinned to the window');
});

test('days logged counts distinct days and never resets on a miss', () => {
  const logged = trial({
    captures: [
      capture('c1', '2026-08-01T09:00:00'),
      capture('c2', '2026-08-01T21:00:00'),
      capture('c3', '2026-08-04T09:00:00'),
    ],
  });
  const card = toCardData(logged, new Date('2026-08-04T22:00:00'));
  eq([card.daysLogged, card.loggedToday], [2, true], 'two days, one of them today');
});

/* ---------- the routine ---------- */

console.log('\nthe routine — what a trial can attribute, and what it can only confound');

test('removals are first-class in the label', () => {
  eq(interventionLabel({ direction: 'add', name: 'Retinol' }), '+ Retinol', 'an addition');
  eq(interventionLabel({ direction: 'remove', name: 'Vitamin C' }), '− Vitamin C', 'a removal');
});

test('baseline names cover both typed products and snapshotted routines', () => {
  const t = trial({
    routine: {
      baseline: ['Cetaphil cleanser', routineSnapshot('AM', [{ name: 'Niacinamide', targets: ['pore'] }])],
      interventions: [],
    },
  });
  eq(baselineNames(t), ['Cetaphil cleanser', 'Niacinamide'], 'flattened in order');
});

test('a hand-typed baseline confounds nothing — that is the gap routines close', () => {
  const typed = trial({ routine: { baseline: ['Some serum'], interventions: [] } });
  eq(baselineTargets(typed), [], 'a bare string carries no targets');

  const saved = trial({
    routine: {
      baseline: [routineSnapshot('AM', [{ name: 'Niacinamide', targets: ['pore', 'acne'] }])],
      interventions: [],
    },
  });
  eq(baselineTargets(saved), ['acne', 'pore'], 'canonical order, not the order typed');
});

test('intervention targets are a deduplicated union in canonical order', () => {
  const t = trial({
    routine: {
      baseline: [],
      interventions: [
        { direction: 'add', name: 'A', startedOn: '2026-08-01', targets: ['pore', 'acne'] },
        { direction: 'add', name: 'B', startedOn: '2026-08-01', targets: ['acne'] },
      ],
    },
  });
  eq(interventionTargets(t), ['acne', 'pore'], 'a union, never a count');
});

/* ---------- what was actually analysed ---------- */

console.log('\nanalysed captures — at most two per trial, and the cost of only one');

test('only scored captures count as analysed', () => {
  const t = trial({
    captures: [
      capture('c1', '2026-08-01T09:00:00', scores({ acne: 50 })),
      capture('c2', '2026-08-02T09:00:00'),
      capture('c3', '2026-08-03T09:00:00', scores({ acne: 60 })),
    ],
  });
  eq(analyzedCaptureCount(t), 2, 'the unscored daily log is not one of them');
});

test('a finished trial with one analysed photo is inconclusive', () => {
  const t = trial({
    status: 'completed',
    captures: [capture('c1', '2026-08-01T09:00:00', scores({ acne: 50 })), capture('c2', '2026-08-05T09:00:00')],
  });
  eq(isInconclusive(t), true, 'nothing to compare the initial photo against');
});

test('inconclusive is derived, so a final photo flips it with no flag to update', () => {
  const t = trial({
    status: 'completed',
    captures: [
      capture('c1', '2026-08-01T09:00:00', scores({ acne: 50 })),
      capture('c2', '2026-08-05T09:00:00', scores({ acne: 60 })),
    ],
  });
  eq(isInconclusive(t), false, 'two analysed photos is a comparison');
});

test('a running trial is never inconclusive, however little it has analysed', () => {
  const t = trial({ captures: [capture('c1', '2026-08-01T09:00:00', scores({ acne: 50 }))] });
  eq(isInconclusive(t), false, 'the verdict only applies once it has ended');
});

test('capture roles read initial, final and plain log apart', () => {
  const t = trial({
    captures: [
      capture('c2', '2026-08-03T09:00:00'),
      capture('c1', '2026-08-01T09:00:00', scores({ acne: 50 })),
      capture('c3', '2026-08-05T09:00:00', scores({ acne: 60 })),
    ],
  });
  eq(captureRole(t, 'c1'), 'initial', 'the earliest capture, not the first in the array');
  eq(captureRole(t, 'c2'), 'log', 'stored, unscored, costs nothing');
  eq(captureRole(t, 'c3'), 'final', 'scored and later');
});

/* ---------- the direction gate ---------- */

console.log('\ndirection — a statement about the camera, never a verdict on the product');

test('movement within the wobble is no measurable change', () => {
  eq(directionOf(13.9, WOBBLE.acne), 'flat', 'acne wobbles 14 points');
  eq(directionOf(-13.9, WOBBLE.acne), 'flat', 'in either direction');
});

test('the wobble itself is not enough — the boundary is flat', () => {
  eq(directionOf(WOBBLE.acne, WOBBLE.acne), 'flat', 'exactly at the floor stays flat');
});

test('past the wobble, the sign of the change names the direction', () => {
  // Rule 1: scores run 0-100 and higher is healthier, for every metric.
  eq(directionOf(20, WOBBLE.acne), 'improved', 'up is healthier');
  eq(directionOf(-20, WOBBLE.acne), 'declined', 'down is worse');
});

test('every concern in the vocabulary has a wobble, including the synthesised ones', () => {
  eq(WOBBLE.tear_trough, 5, 'the generic placeholder, made explicit');
  eq(Object.keys(WOBBLE).length, 15, 'fifteen concerns, not fourteen');
});

/* ---------- metric changes ---------- */

console.log('\nmetric changes — today minus day one, device-corrected');

const twoCaptures = trial({
  routine: {
    baseline: [routineSnapshot('AM', [{ name: 'Niacinamide', targets: ['pore'] }])],
    interventions: [{ direction: 'add', name: 'Retinol', startedOn: '2026-08-01', targets: ['acne'] }],
  },
  captures: [
    capture('c1', '2026-08-01T09:00:00', scores({ acne: 40, pore: 30 })),
    capture('c2', '2026-08-15T09:00:00', scores({ acne: 70, pore: 33 })),
  ],
});

test('the headline number is latest minus first, not a fitted slope', () => {
  const acne = metricChanges(twoCaptures).find((m) => m.concern === 'acne');
  eq([acne.first, acne.latest, acne.change], [40, 70, 30], 'two points, one subtraction');
  eq(acne.direction, 'improved', '30 points clears acne’s 14-point wobble');
});

test('tracked and confounded come from the trial’s own routine', () => {
  const changes = metricChanges(twoCaptures);
  const acne = changes.find((m) => m.concern === 'acne');
  const pore = changes.find((m) => m.concern === 'pore');
  eq([acne.tracked, acne.confounded], [true, false], 'the intervention names acne');
  eq([pore.tracked, pore.confounded], [false, true], 'the background routine already covers pore');
  eq(pore.direction, 'flat', '3 points is well inside pore’s 20-point wobble');
});

test('metrics come back in canonical order and only when measured', () => {
  eq(
    metricChanges(twoCaptures).map((m) => m.concern),
    ['acne', 'pore'],
    'the thirteen unmeasured concerns are absent, not zero',
  );
});

test('a trial with no captures has nothing to say', () => {
  eq(metricChanges(trial()), [], 'an empty list, not a row of zeroes');
});

test('one capture is a starting point, never a flat result', () => {
  const single = trial({ captures: [capture('c1', '2026-08-01T09:00:00', scores({ acne: 40 }))] });
  const [acne] = metricChanges(single);
  eq([acne.change, acne.direction], [0, 'flat'], 'no change has been asked for yet');
  eq(acne.series.length, 1, 'the single point still plots');
});

test('a camera change is corrected additively and not clamped to 0-100', () => {
  // Rule 6/7: pore is 87 points apart between these two devices, and corrected
  // pore legitimately goes negative in the reference data.
  const poreOffset = offsets.offsetToBaseline[OTHER_DEVICE].pore;
  const switched = trial({
    captures: [
      capture('c1', '2026-08-01T09:00:00', scores({ pore: 30 })),
      capture('c2', '2026-08-15T09:00:00', scores({ pore: 30 }), OTHER_DEVICE),
    ],
  });
  const [pore] = metricChanges(switched);
  close(pore.latest, 30 + poreOffset, 'the raw score plus the device offset');
  if (!(pore.latest < 0)) throw new Error('corrected pore must be free to go negative');
  eq(pore.direction, 'declined', 'the same raw number on another camera is not the same measurement');
});

test('a concern with no measured offset passes through the correction unchanged', () => {
  const uncorrectable = trial({
    captures: [capture('c1', '2026-08-01T09:00:00', scores({ moisture: 55 }), OTHER_DEVICE)],
  });
  const [moisture] = metricChanges(uncorrectable);
  eq(moisture.first, 55, 'no offset in the table means no correction');
});

test('the synthetic flag survives into the metric row', () => {
  const seeded = trial({
    captures: [
      capture('c1', '2026-08-01T09:00:00', scores({ acne: 40, eye_bag: 50 }, { synthetic: ['eye_bag'] })),
      capture('c2', '2026-08-15T09:00:00', scores({ acne: 70, eye_bag: 65 }, { synthetic: ['eye_bag'] })),
    ],
  });
  const changes = metricChanges(seeded);
  eq(changes.find((m) => m.concern === 'acne').synthetic, false, 'a measured concern');
  eq(changes.find((m) => m.concern === 'eye_bag').synthetic, true, 'never strip the flag');
});

test('captures are ordered by time, not by array position', () => {
  const shuffled = trial({
    captures: [
      capture('c2', '2026-08-15T09:00:00', scores({ acne: 70 })),
      capture('c1', '2026-08-01T09:00:00', scores({ acne: 40 })),
    ],
  });
  const [acne] = metricChanges(shuffled);
  eq([acne.first, acne.latest], [40, 70], 'day one is the earliest photo');
  eq(acne.series.map((p) => p.day), [0, 14], 'days counted from the window start');
});

test('tracked concerns come back in canonical order', () => {
  const t = trial({
    routine: {
      baseline: [],
      interventions: [
        { direction: 'add', name: 'A', startedOn: '2026-08-01', targets: ['pore'] },
        { direction: 'add', name: 'B', startedOn: '2026-08-01', targets: ['acne'] },
      ],
    },
  });
  eq(trackedConcerns(t), ['acne', 'pore'], 'display order is never the input order');
});

/* ---------- the per-photo overlay ---------- */

console.log('\nthe overlay — the value at the photo being looked at');

const threeCaptures = trial({
  captures: [
    capture('c1', '2026-08-01T09:00:00', scores({ acne: 40 })),
    capture('c2', '2026-08-08T09:00:00', scores({ acne: 50 })),
    capture('c3', '2026-08-15T09:00:00', scores({ acne: 70 })),
  ],
});

test('the baseline photo has no change to show', () => {
  const [acne] = metricChanges(threeCaptures);
  const reading = readingAtCapture(acne, 'c1');
  eq(reading, { first: 40, value: 40, change: null, direction: 'flat' }, 'null, because 0 would imply otherwise');
});

test('a later photo reads against day one, not against the trial total', () => {
  const [acne] = metricChanges(threeCaptures);
  eq(readingAtCapture(acne, 'c2'), { first: 40, value: 50, change: 10, direction: 'flat' }, 'inside the wobble');
  eq(readingAtCapture(acne, 'c3').change, 30, 'and the last photo carries the whole change');
});

test('an unscored capture has no reading to overlay', () => {
  const [acne] = metricChanges(threeCaptures);
  eq(readingAtCapture(acne, 'c-unscored'), null, 'null rather than a fabricated zero');
});

/* ---------- the logging record ---------- */

console.log('\nthe record — the calendar shows every real photo');

test('the calendar spans the window and marks what is logged', () => {
  const t = trial({
    captures: [capture('c1', '2026-08-01T09:00:00'), capture('c2', '2026-08-03T09:00:00')],
  });
  const record = logRecord(t, new Date('2026-08-03T22:00:00'));
  eq(record.days.length, 30, '1 Aug to 30 Aug inclusive');
  eq([record.daysLogged, record.dayNumber, record.totalDays], [2, 3, 30], 'two of the first three days');
  eq(record.daysRemaining, 27, 'the marker to count toward');
  eq(record.loggedToday, true, 'today has a photo');
});

test('several photos on one day are one logged day, both kept', () => {
  const t = trial({
    captures: [capture('c1', '2026-08-02T08:00:00'), capture('c2', '2026-08-02T21:00:00')],
  });
  const record = logRecord(t, new Date('2026-08-02T23:00:00'));
  eq(record.daysLogged, 1, 'a day, not a count of photos');
  eq(record.days.find((d) => d.date === '2026-08-02').captures.length, 2, 'and neither photo is dropped');
});

test('a capture before the window is shown and marked out of window', () => {
  const t = trial({ captures: [capture('c0', '2026-07-30T22:00:00')] });
  const record = logRecord(t, new Date('2026-08-02T09:00:00'));
  const first = record.days[0];
  eq([first.date, first.inWindow], ['2026-07-30', false], 'never silently dropped');
  eq(record.days.some((d) => d.date === '2026-08-01' && d.inWindow), true, 'the window still starts on 1 Aug');
});

test('logging past your own end date extends the calendar', () => {
  const t = trial({ captures: [capture('c1', '2026-09-05T09:00:00')] });
  const record = logRecord(t, new Date('2026-09-05T22:00:00'));
  eq(record.days.at(-1).date, '2026-09-05', 'those captures are real data');
});

test('an open-ended or finished trial has no days remaining to report', () => {
  const open = trial({ window: { startDate: '2026-08-01', endDate: null, endDateSource: null } });
  eq(logRecord(open, new Date('2026-08-10T09:00:00')).daysRemaining, null, 'nothing to count toward');

  const done = trial({ status: 'completed' });
  eq(logRecord(done, new Date('2026-08-10T09:00:00')).daysRemaining, null, 'it is over');
});

test('days remaining never goes negative on an overrun trial', () => {
  const record = logRecord(trial(), new Date('2026-09-20T09:00:00'));
  eq(record.daysRemaining, 0, 'clamped at zero');
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
