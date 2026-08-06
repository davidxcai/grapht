#!/usr/bin/env node
/**
 * Free schema discovery.
 *
 * Units are charged only when a task completes successfully, so deliberately
 * malformed task requests cost nothing and their 4xx bodies tend to name the
 * fields the server actually wanted. skin-simulation's request format is not
 * published anywhere, so this is how we recover it.
 *
 * Nothing here uploads an image or completes a task. Run cost: 0 units.
 */

import { clientFromEnv } from '../src/youcam.mjs';

process.loadEnvFile();

const client = clientFromEnv({ verbose: true });

function show(label, res) {
  console.log(`\n--- ${label}`);
  console.log(`    HTTP ${res.status}`);
  console.log(`    ${JSON.stringify(res.body)}`);
}

console.log('=== 1. authentication ===');
try {
  await client.authenticate();
  console.log(`OK  host = ${client.host}`);
} catch (err) {
  console.error('FAILED\n' + err.message);
  process.exit(1);
}

// Shapes worth trying. The docs show two different request styles for v1 vs v2,
// and we do not yet know which one v2.0 skin-analysis actually accepts.
const shapes = (fileId, actions) => [
  ['empty', {}],
  ['flat dst_actions', { src_file_id: fileId, dst_actions: actions }],
  [
    'nested payload',
    {
      request_id: 1,
      payload: { file_sets: { src_ids: [fileId] }, actions: [{ id: 0, params: { dst_actions: actions } }] },
    },
  ],
  ['src_ids only', { src_ids: [fileId], dst_actions: actions }],
];

console.log('\n=== 2. skin-analysis request shape ===');
for (const [label, payload] of shapes('probe-invalid-file-id', ['hd_acne'])) {
  try {
    show(label, await client.probeTask('skin-analysis', payload));
  } catch (err) {
    show(label, { status: err.status ?? '???', body: err.body ?? err.message });
  }
}

console.log('\n=== 3. skin-simulation request shape ===');
for (const [label, payload] of shapes('probe-invalid-file-id', ['acne'])) {
  try {
    show(label, await client.probeTask('skin-simulation', payload));
  } catch (err) {
    show(label, { status: err.status ?? '???', body: err.body ?? err.message });
  }
}

// The product depends on being able to render *worsening*, not just improvement.
// Every published description mentions improvement only, so probe the sign and
// the scale explicitly.
console.log('\n=== 4. skin-simulation intensity semantics ===');
const intensityTrials = [
  ['0-1 float', { severity: 0.5 }],
  ['0-100 int', { severity: 50 }],
  ['negative (worsening)', { severity: -50 }],
  ['per-concern map', { acne: 50, oiliness: 20 }],
  ['level key', { level: 3 }],
];
for (const [label, params] of intensityTrials) {
  const payload = {
    src_file_id: 'probe-invalid-file-id',
    dst_actions: ['acne'],
    ...params,
  };
  try {
    show(label, await client.probeTask('skin-simulation', payload));
  } catch (err) {
    show(label, { status: err.status ?? '???', body: err.body ?? err.message });
  }
}

console.log('\nDone. No units consumed (no task reached "success").');
