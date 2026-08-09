/**
 * Seed a *stored* trial for exercising daily capture and trial endings. Free —
 * Neon only.
 *
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs                    # active
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs --state inconclusive
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs --state conclusive
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs --user user_abc123
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs --clean
 *
 * Costs no YouCam units and makes no Gemini call. Nothing here is analysed;
 * the scores are lifted from the committed fixture so the metric list and the
 * photo overlay render against plausible numbers.
 *
 * It exists because the states below are otherwise slow or impossible to
 * reach through the app. Creating a trial through the app analyses its first
 * photo — ~20 units — and that trial is then logged for the day, so "No photo
 * for today" cannot appear until tomorrow. Reaching `endTrial()`'s two
 * branches (reuse-latest-photo, inconclusive) for real means actually running
 * them against a live account over several days. This writes the captures
 * backdated instead.
 *
 * **Development only.** It writes `captured_at` directly, which the app never
 * does and must never do: captures are timestamped server-side precisely so a
 * compliance record cannot be edited after the fact (`docs/app-ui.md` §5).
 * Seeding a fake history is a different act from logging one, and only this
 * script is allowed it.
 *
 * `blob_url` points at the fixture's own photos under gitignored
 * `public/captures/`, so the timeline renders if the pipeline has been run and
 * degrades to "photo isn't available locally" if it hasn't.
 *
 * Since the pivot away from analysing every daily log (only a trial's initial
 * and final capture ever carry scores), each state below seeds captures with
 * that in mind:
 *
 * - **active** (default): one analysed capture (day 1), then several
 *   unanalysed daily logs, none today — exercises "Logged — not scored" and
 *   the "No photo for today" slot together.
 * - **inconclusive**: only the initial analysed capture, trial closed. Lands
 *   directly in the state `endTrial()` reaches when nothing was ever logged
 *   past day one — the Summary tab's "add a final photo" prompt.
 * - **conclusive**: initial + final analysed captures with unanalysed logs in
 *   between, trial closed — the ordinary finished-trial state.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';

const STATES = ['active', 'inconclusive', 'conclusive'];
const stateFlag = process.argv.indexOf('--state');
const state = stateFlag !== -1 ? process.argv[stateFlag + 1] : 'active';
if (!STATES.includes(state)) {
  console.error(`--state must be one of: ${STATES.join(', ')}`);
  process.exit(1);
}

const NAMES = {
  active: 'Dev capture test',
  inconclusive: 'Dev capture test — inconclusive',
  conclusive: 'Dev capture test — conclusive',
};
const NAME = NAMES[state];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}
const sql = neon(url);

if (process.argv.includes('--clean')) {
  const gone = await sql`
    delete from trials where name = any(${Object.values(NAMES)}) returning id`;
  console.log(`removed ${gone.length} seeded trial${gone.length === 1 ? '' : 's'}`);
  process.exit(0);
}

/**
 * Who the seeded trial belongs to. A trial filed under the wrong owner is
 * invisible in the app, which looks exactly like the seed having failed.
 *
 * `--user` wins. Otherwise the single account, if there is exactly one — the
 * ordinary case on a dev database. With none, `'local'` reproduces what this
 * script wrote before accounts existed, and the first account to finish sign-up
 * will claim it.
 */
async function resolveOwner() {
  const flag = process.argv.indexOf('--user');
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];

  // No `profiles` table means migrate-profiles.mjs hasn't run, which is the
  // same situation as no accounts.
  const accounts = await sql`select user_id from profiles limit 2`.catch(() => []);
  if (accounts.length === 1) return accounts[0].user_id;

  if (accounts.length > 1) {
    console.error('More than one account exists — pass --user <clerk user id>.');
    process.exit(1);
  }
  return 'local';
}

const owner = await resolveOwner();

// The reference trial's captures — real measured scores, in order.
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/trials.json'), 'utf8'),
);
const source = fixture.find((t) => t.id === 'did-it-hold-2026') ?? fixture[0];

/** Both ends are inclusive, so the window spans one fewer day than it counts. */
const WINDOW_DAYS = 30;

// Every state starts with an analysed day-1 capture — every real trial does.
// `active` and `conclusive` add unanalysed logs after it, oldest first;
// `conclusive` closes with one more analysed capture at the end.
const OFFSETS = { active: [5, 4, 3, 2], inconclusive: [5], conclusive: [5, 4, 3, 2] }[state];

const captures = OFFSETS.map((daysAgo, i) => ({
  daysAgo,
  // Analysed: the first capture always, and (in `conclusive`) the last one —
  // the initial and final photo. Everything else is a daily log with no score.
  analysed: i === 0 || (state === 'conclusive' && i === OFFSETS.length - 1),
  concerns: source.captures[i]?.concerns ?? source.captures[0].concerns,
  photo: source.captures[i]?.photoUrl ?? null,
}));

const closed = state !== 'active';

await sql`delete from trials where name = ${NAME}`;

const [trial] = await sql`
  insert into trials (name, user_id, status, start_date, end_date, end_date_source)
  values (
    ${NAME},
    ${owner},
    ${closed ? 'completed' : 'active'}::trial_status,
    current_date - ${OFFSETS[0]}::int,
    current_date + ${WINDOW_DAYS - OFFSETS[0] - 1}::int,
    'user-chosen'
  )
  returning id`;

await sql.query(
  `insert into trial_interventions (trial_id, position, direction, name, started_on, targets)
   values ($1, 0, 'add', 'Test serum', current_date - $2::int, $3::analysis_concern[])`,
  [trial.id, OFFSETS[0], ['acne', 'texture']],
);

for (const capture of captures) {
  await sql.query(
    `insert into trial_captures (trial_id, captured_at, device, resolution, blob_url, concerns)
     values ($1, now() - ($2::int * interval '1 day'), 'seed-dev-trial', 'hd', $3, $4::jsonb)`,
    [trial.id, capture.daysAgo, capture.photo, capture.analysed ? JSON.stringify(capture.concerns) : null],
  );
}

const analysed = captures.filter((c) => c.analysed).length;
console.log(
  `seeded "${NAME}" (${state}) — ${captures.length} captures (${analysed} analysed), owner ${owner}`,
);
console.log(`  http://localhost:3000/trials/${trial.id}`);
console.log('  remove all seeded dev trials with: --clean');
