/**
 * Cross-device score correction.
 *
 * Camera hardware changes raw_score directly (see docs/measurements.md, Finding 2):
 * pore and texture differ by ~30-50 points between devices, several times any real
 * biological change. Acne is comparatively device-robust (~6-13 points) but is
 * still corrected here for consistency; the small offset just means it barely
 * moves.
 *
 * The offsets are not hardcoded. They are derived each run from the three
 * near-simultaneous cross-device captures in the reference dataset (gap small
 * enough that biological change is negligible, so any score difference is
 * hardware). iPhone XS and iPad Pro never have a *direct* pairing, so the iPad
 * offset is chained through XS -> iPad -> baseline.
 *
 * This is a thin correction from 3 data points, taken on faith that hardware
 * offset is roughly additive and stable over the device's usage window. It is
 * the best available evidence, not a precise instrument.
 */

import { groupSessions } from './sessions.mjs';

const PAIR_MAX_GAP_DAYS = 5;

const val = (r, metric) => r.concerns?.[metric]?.raw ?? null;

/** Mean raw_score for a metric across a session (burst), ignoring missing values. */
function sessionMean(session, metric) {
  const vals = session.map((r) => val(r, metric)).filter((v) => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Find consecutive sessions on different devices captured close enough together
 * (<= PAIR_MAX_GAP_DAYS) that any score difference is attributable to hardware,
 * not biology.
 */
export function findCalibrationPairs(records, metrics) {
  const sessions = groupSessions(records);
  const pairs = [];

  for (let i = 0; i < sessions.length - 1; i++) {
    const a = sessions[i];
    const b = sessions[i + 1];
    if (a.at(-1).device === b[0].device) continue;

    const gapDays = (Date.parse(b[0].capturedAt) - Date.parse(a.at(-1).capturedAt)) / 86400000;
    if (gapDays > PAIR_MAX_GAP_DAYS) continue;

    const deltas = {};
    for (const m of metrics) {
      const meanA = sessionMean(a, m);
      const meanB = sessionMean(b, m);
      deltas[m] = meanA === null || meanB === null ? null : meanB - meanA;
    }

    pairs.push({
      deviceA: a.at(-1).device,
      deviceB: b[0].device,
      dateA: a.at(-1).capturedAt,
      dateB: b[0].capturedAt,
      gapDays,
      deltas, // deltas[m] = mean(B) - mean(A), i.e. offset(A -> B) for this metric
    });
  }

  return pairs;
}

/**
 * Aggregate calibration pairs into per-metric offsets that convert any device's
 * raw_score into the baseline device's equivalent, chaining through intermediate
 * devices when no direct pairing exists (e.g. iPad Pro never overlaps directly
 * with iPhone 16e in this dataset).
 *
 * Returns { baseline, pairs, offsetToBaseline: { [device]: { [metric]: offset | null } } }.
 * `offset` is what to ADD to a raw_score from that device to bring it to the
 * baseline device's scale. Devices with no path to baseline get `null` (no
 * correction possible — treat as uncorrectable, do not plot against corrected
 * series).
 */
export function computeDeviceOffsets(records, { baseline, metrics }) {
  const pairs = findCalibrationPairs(records, metrics);

  // Directed graph: edge[A][B][metric] = mean offset(A -> B), averaged over
  // however many pairs observed that device transition.
  const edge = {};
  const addEdge = (a, b, m, delta) => {
    if (delta === null) return;
    edge[a] ??= {};
    edge[a][b] ??= {};
    edge[a][b][m] ??= [];
    edge[a][b][m].push(delta);
  };
  for (const p of pairs) {
    for (const m of metrics) {
      addEdge(p.deviceA, p.deviceB, m, p.deltas[m]);
      addEdge(p.deviceB, p.deviceA, m, p.deltas[m] === null ? null : -p.deltas[m]);
    }
  }
  const meanEdge = (a, b, m) => {
    const vals = edge[a]?.[b]?.[m];
    return vals?.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
  };

  const devices = new Set(records.map((r) => r.device));
  const offsetToBaseline = {};
  for (const d of devices) offsetToBaseline[d] = {};

  for (const m of metrics) {
    // BFS outward from baseline; offsetToBaseline[d][m] = offset(d -> baseline).
    offsetToBaseline[baseline][m] = 0;
    const known = new Set([baseline]);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const from of devices) {
        if (known.has(from)) continue;
        for (const to of Object.keys(edge[from] ?? {})) {
          if (!known.has(to)) continue;
          const step = meanEdge(from, to, m);
          if (step === null) continue;
          offsetToBaseline[from][m] = step + offsetToBaseline[to][m];
          known.add(from);
          progressed = true;
          break;
        }
      }
    }
    for (const d of devices) offsetToBaseline[d][m] ??= null;
  }

  return { baseline, pairs, offsetToBaseline };
}

/** Apply a computed offset table to a single raw_score. Passes through if uncorrectable. */
export function correctForDevice(raw, metric, device, offsets) {
  if (raw === null || raw === undefined) return raw;
  const o = offsets.offsetToBaseline[device]?.[metric];
  return o === null || o === undefined ? raw : raw + o;
}
