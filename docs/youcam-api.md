# YouCam / Perfect Corp API — working notes

Most of this is **not in the published documentation**. The reference site at
`docs.perfectcorp.com` is a JavaScript SPA that serves empty shells to any
non-browser client, and the skin-simulation request schema is not documented
anywhere public. Everything below marked *verified* was established by calling
the live API on 2026-08-03; everything marked *unverified* is from Perfect Corp's
own prose and has not been exercised in code.

Re-run `scripts/probe.mjs` and `scripts/probe-intensity.mjs` if calls start
failing with `InvalidParameters` — both are free.

---

## Billing model

**Units are charged only when a task reaches `task_status: "success"`.** Verified
repeatedly: seven tasks failed with `error_src_face_too_small` and one failed
with `Engine task timeout`, and none were billed.

This makes several things free, and they should be used aggressively:

| Operation | Cost |
|---|---|
| Authentication | free |
| File upload | free |
| Task polling | free |
| A task that fails for any reason | **free** |
| Malformed requests (schema discovery) | **free** |
| A task that succeeds | charged |

Measured prices (HD, verified against the account's transaction log):

| Call | Concerns | Units |
|---|---|---|
| `skin-analysis` SD | 6 | **12** |
| `skin-analysis` HD | 6 | **16** |
| `skin-analysis` HD | 7 | **16** |
| `skin-simulation` | — | **unknown, not yet run** |

Documented SD tiers are 1–4 → 9 units, 5–7 → 12 units. HD appears to tier the
same way: 6 and 7 concerns both cost 16, so the seventh concern was free. Adding
an eighth would likely cross into the next tier.

---

## Authentication — *verified*

```
POST https://yce-api-01.perfectcorp.com/s2s/v1.0/client/auth
Content-Type: application/json

{ "client_id": "<YOUCAM_API_KEY>", "id_token": "<see below>" }
```

`id_token` is the literal string `client_id=<id>&timestamp=<ms>`, RSA-encrypted
and base64-encoded. The critical and unobvious part: **`YOUCAM_SECRET_KEY` is not
a shared secret — it is a base64-encoded X.509 (SPKI) *public key*.** You encrypt
with it; you never sign with it.

```js
const publicKey = crypto.createPublicKey({
  key: Buffer.from(secretKey, 'base64'), format: 'der', type: 'spki',
});
const idToken = crypto.publicEncrypt(
  { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
  Buffer.from(`client_id=${apiKey}&timestamp=${Date.now()}`),
).toString('base64');
```

Response is `{ status: 200, result: { access_token } }`. The token lasts 2 hours;
`src/youcam.mjs` expires it at 100 minutes so a long batch cannot die mid-flight.

`yce-api-01.makeupar.com` also appears in Perfect Corp's docs as a base host. It
has not been tested — `perfectcorp.com` answered first and is used throughout.

---

## Skin Analysis — *verified*

### 1. Request an upload slot

```
POST /s2s/v2.0/file/skin-analysis
Authorization: Bearer <access_token>

{ "files": [{ "content_type": "image/jpeg", "file_name": "x.jpg", "file_size": 1720828 }] }
```

Response nests **two levels down** — `data.files`, not `result.files`:

```json
{ "status": 200, "data": { "files": [{
  "file_id": "...",
  "requests": [{ "method": "PUT", "url": "https://yce-us.s3-accelerate.amazonaws.com/...",
                 "headers": { "Content-Length": "1720828", "Content-Type": "image/jpeg" } }]
}] } }
```

### 2. Upload

`PUT` the raw bytes to that URL. The presigned signature covers
`content-length;content-type;host`, so those headers must be echoed back exactly
as given. Note `headers` arrives as a **plain object** here, though Perfect Corp's
docs show a `{key, value}` array format elsewhere — handle both.

### 3. Create the task

```
POST /s2s/v2.0/task/skin-analysis

{ "src_file_id": "<file_id>", "dst_actions": ["hd_acne", "hd_texture", ...] }
```

**Use the flat form.** The nested `payload.file_sets.src_ids` / `actions[].params`
shape documented for v1.0 is rejected by v2.0 with *"src_file_id is required but
wasn't included in your request"*. `src_file_url` may be substituted for
`src_file_id` when the image is publicly reachable.

**`hd_dark_circle_v2` is rejected outright — send `hd_dark_circle`.** Confirmed
by probe 2026-08-09: an invalid `dst_actions` entry fails with `"<n> is not one
of the accepted values."`, where `<n>` is that entry's array index (`"0"` when
it is the only entry, `"9"` when it was the 10th of 14). `hd_dark_circle` (no
`_v2`) passes the same probe. `toRequestAction()` in `src/concerns.mjs` applies
this rename; the canonical analysis name stays `dark_circle_v2` because that is
what the response echoes (see "Score shape" below). This is the only one of the
fifteen where the request-side name differs from the response-side name.

**Two more valid `dst_actions` values were found the same way, by probing a
real sample payload from Perfect Corp's own docs:** `hd_tear_trough` and
`hd_skin_type`. `tear_trough` is a fifteenth ordinary concern (0–100
`raw_score`, added to `ANALYSIS_CONCERNS`). `hd_skin_type` is **not** — it
returns a category, not a score (see "Concerns" below) — and is deliberately
excluded from the analysis vocabulary until it gets its own code path.

### 4. Poll

```
GET /s2s/v2.0/task/skin-analysis/<task_id>
```

`task_status` is `running`, `success`, or `error`. Perfect Corp's docs warn that
a *"task will lose if no polling in 10 seconds"*, so poll tightly — `src/youcam.mjs`
uses a fixed 2s interval and does not back off.

If the client gives up but the task later completes, **you are still billed**.
`scripts/repoll.mjs` re-polls a task id to recover the result for free rather than
paying to run it again.

### 5. Results are a ZIP, not JSON

`results.url` is a presigned S3 link with `X-Amz-Expires=7199` — **about two
hours**, despite the docs claiming 24-hour retention. Download and unpack
immediately; letting it expire means paying for the analysis again.

```
skinanalysisResult/
  score_info.json
  resize_image.jpg          <- the model's own normalised input, always 1920x2560
  hd_acne_output.png        <- per-concern mask overlays, free, same 1920x2560
  hd_pore_output_cheek.png
  ...
```

The mask PNGs come at no extra cost and align to `resize_image.jpg`, **not** to
your original upload — scale them before overlaying.

### Score shape — inconsistent within a single response

```jsonc
{
  "hd_redness": { "raw_score": 83.58, "ui_score": 82 },      // flat
  "hd_acne":    { "whole": { "raw_score": 70.75, ... } },     // nested
  "hd_pore":    { "forehead": {...}, "nose": {...},           // nested, zoned
                  "cheek": {...}, "whole": {...} },
  "all": { "score": 78.83 },
  "skin_age": 31
}
```

`src/results.mjs::normalizeScores` flattens all three shapes.

- **Scores run 0–100 where HIGHER IS HEALTHIER.** "Acne got worse" means the
  score went *down*. Get this wrong and every chart and forecast inverts.
- `raw_score` is the clinical output; `ui_score` is a non-linear consumer-facing
  compression (it pulls 90.8 down to 81 but pushes 57.6 up to 71). **Fit
  regressions on `raw_score`, display `ui_score`.**
- `skin_age` and `all.score` arrive free whether or not you ask for them.

### Concerns

SD and HD are the same fifteen names, HD prefixed with `hd_` (`dark_circle_v2`
excepted — its HD request action is `hd_dark_circle`, see above). **SD and HD
cannot be mixed in one request** — the task is rejected.

```
wrinkle  droopy_upper_eyelid  droopy_lower_eyelid  firmness  acne  moisture
eye_bag  dark_circle_v2  age_spot  radiance  redness  oiliness  pore  texture
tear_trough
```

**`skin_type` is a sixteenth `dst_actions` value that is not in this list on
purpose.** It is confirmed categorical, not scored: `whole` / `t_zone` /
`u_zone` subcategories, each one of Normal, Oily, Dry, Combination, Redness, or
a compound of Redness with one of the other four (e.g. "Oily & Redness").
There is no `raw_score` and no higher-is-healthier direction, so it does not
fit `ANALYSIS_TO_SIMULATION` or anything downstream that assumes a 0–100
concern score. Treat it as a distinct, unbuilt feature rather than the
fifteenth analysis concern.

Measured on one image, **SD and HD return bit-identical `raw_score` for
`redness`, `oiliness`, and `age_spot`** — same model, different label, no benefit
from HD. Only `acne`, `texture`, and `pore` differ, and only those return zonal
breakdowns. HD is still the right default because it is a strict superset.

### Image requirements

| | |
|---|---|
| Formats | jpg, jpeg, png |
| Max file size | 10 MB |
| Long side | ≤ 4096 px (but the model works at 1920×2560 — anything larger is discarded) |
| Short side | ≥ 1080 px for HD, ≥ 480 px for SD |
| Face size | see below — this is the one that actually bites |

**`error_src_face_too_small` is about the face's fraction of the frame, not the
image resolution.** Measured on a 1920×2560 upload:

- face height **0.45** of frame height → rejected on roughly a third of photos,
  deterministically, varying with head pose
- face height **0.55** → accepted on a frame that 0.45 had rejected

`src/face.mjs` therefore targets `TARGET_FACE_FRACTION`, raised from 0.55 to
0.80 on 2026-08-09 for the live guide (`docs/capture-quality.md` §5). Do not
lower it below this floor without re-running `scripts/test-face-fraction.mjs`
— and note that script only ever tested the floor by walking *up* from a
rejected fraction; it has never established an upper bound, which the 0.80
target now sits meaningfully closer to.

---

## Skin Simulation — *schema verified by probe, never successfully called*

The schema below is verified. What the intensities actually *do to the pixels* is
not, and probing cannot establish it — see
`docs/_archive/simulation-constraints.md`, "Open question: what does intensity
mean visually?", before building anything that maps a slope onto an intensity
value.

Note that Skin Simulation is **not part of the current product** — the schema is
documented here because it was recovered at real cost, not because anything
calls it. See `docs/_archive/README.md`.

```
POST /s2s/v2.0/task/skin-simulation

{ "src_file_id": "<file_id>", "acne": 0.6, "texture": 0.3 }
```

Intensities are **top-level per-concern keys**, not a nested object and not a
single severity value.

### Intensity range — verified

| Value | Response |
|---|---|
| `-0.01` | `below the allowed minimum` |
| `0` | `Simulation intensity cannot be all zero` |
| `0.01` – `1.0` | accepted |
| `1.01` | `above the allowed maximum` |

**Range is [0.0, 1.0], and negative values are rejected outright.** The renderer
cannot be asked to make skin look *worse* — intensity means "how much correction
to apply," and there is no other direction.

The product consequence: the warning/abandonment branch of the forecast cannot be
synthesised. It has to be anchored on a real earlier photograph instead, which is
more credible anyway. See the slider design in the project notes.

### The ten renderable concerns — verified

Naming is **inconsistent with the analysis API**, and inconsistently pluralised:

| Analysis | Simulation |
|---|---|
| `acne` `texture` `redness` `oiliness` `radiance` `wrinkle` | unchanged |
| `pore` | `pores` |
| `age_spot` | `spots` |
| `eye_bag` | `eye_bags` |
| `dark_circle_v2` | `dark_circle` |
| `moisture` `firmness` `droopy_upper_eyelid` `droopy_lower_eyelid` | **not renderable** |

Rejected variants, for the record: `spot`, `spot_v2`, `age_spot_v2`, `eyebag`,
`eyebags`, `dark_circles`, `darkcircle`, `wrinkles`, `blemish`, `dullness`,
`acne_scar`, `skin_tone`, and any `hd_`-prefixed name.

> **The dangerous failure mode.** An unrecognised concern key is *silently
> ignored*, not rejected. Typo `wrinkles` for `wrinkle` and the request does not
> fail with a bad-name error — it fails with `Simulation intensity cannot be all
> zero`, which reads like a completely different bug. Always route through
> `src/concerns.mjs`.

---

## JS Camera Kit v2.5 — *retired 2026-08-08, contract kept*

> **Not used any more.** The camera is ours: `getUserMedia` plus BlazeFace, in
> `components/camera-capture.tsx` and `lib/capture-guide.ts`, to the design in
> `docs/capture-quality.md` §5. The kit ran for one day and worked, once the
> memory bug below was found. It went because it was slow to load, hard to
> satisfy (STRICT wants the face at 0.75 of frame), gave the user no shutter, and
> looked nothing like the rest of the app — for pose tracking we can do from six
> landmarks `detectFace()` was already computing and throwing away. It also
> capped the capture at 1080×1920, where ours gets 1440×1920 or better.
>
> Kept in full rather than archived: none of it is published anywhere, the crash
> analysis cost a day, and it is the reference if any Perfect Corp browser SDK is
> picked up again. Nothing below is live code.

The browser capture SDK. The published
page is the usual empty SPA shell; the contract below came out of
`/page-data/reference/ai_skin_analysis/section/overview/js-camera-kit/data.json`,
which is how any other unresolved `{% partial %}` can be recovered.

CDN only — no npm package, no types, no API key in the documented `init`
signature. Installs a global `YMK`, calls the async-init callback **once** on
first load, and renders into a mandatory `<div id="YMK-module">`. HTTPS required
except on localhost.

**The callback is `window.ymkAsyncInit` — lowercase — not the documented
`YMKAsyncInit`.** The shipped bundle checks `typeof window.ymkAsyncInit` and
silently does nothing when it is absent; the capitalised spelling appears
nowhere in it. Define both. Two other facts from the bundle: it polls for
`window.YMK` for ~5s and then fires the callback regardless, so check the
global inside it; and it carries a hardcoded hostname allowlist (`localhost`,
`127.0.0.1`, perfectcorp domains) that is cosmetic — all lazy chunks audited
2026-08-07, and the only consumer is a UTM parameter on the "powered by" link.
A LAN-IP origin is fine.

Two more facts from that audit: `videoQuality` becomes an **exact** getUserMedia
constraint (`min`=`ideal`=`max`, so 2560×1920 for `1920p` and 1920×1080 for
`1080p`) — iOS satisfies it by scaling, but a laptop webcam below the width
rejects with `OverconstrainedError`, which the kit treats as fatal unless
`disableCameraResolutionCheck` is set. And
on iOS the kit attaches the stream (`playsinline`, `srcObject`) but defers
`play()` to its obfuscated controller — a session that hangs on the kit's
background image with the camera light on died between those two steps.

```
https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js
```

`init()` args we set while it was live, and why: `faceDetectionMode: 'skincare'`
rather than `hdskincare`, which demands a webcam reporting 2560px on the long
side and excludes most laptops for a frame of the same size.
`qualityLevel: 'strict'`, `imageFormat: 'blob'`, `videoQuality: '1920p'`, and
`width`/`height` at exactly 9:16 — see below.

### The frame's aspect ratio decides the capture, and the crash

`webenvcheckercontrollerv2` — the controller loaded for `skincare`, `hdskincare`,
`comprehensive` and `teethwhiten` — sizes its RGBA working buffer from the
**camera stream** on mobile and from the **display** on desktop:

| | `camera_width` × `camera_height` |
|---|---|
| `_resize4Mobile` | `display_width / display_height × videoHeight` × `videoHeight` |
| `_resize4Desktop` | both from `display_height × resizeRatio` |

That buffer is also exactly what `faceDetectionCaptured` hands back — the capture
is `getImageData(0, 0, camera_width, camera_height)` and nothing rescales it. So
on a phone the frame's **aspect ratio**, not its pixel size, sets the capture
resolution. iOS grants 1920p's exact 2560×1920, so:

| frame | buffer / capture | heap |
|---|---|---|
| 3:4 | 1441×1920 | 10.6MB |
| 9:16 | 1080×1920 | 7.9MB |
| 1:1 | 1920×1920 | 14.1MB |

9:16 is the narrowest frame whose short side still clears the 1080px HD floor
above. Below it the analysis rejects the photo; above it the buffer grows to hold
background.

**Suspected: 1920p at 3:4 crashes the kit on any phone (2026-08-07).** The heap
cannot grow — `TOTAL_MEMORY || 0x2000000` is 32MB, statics and `TOTAL_STACK` take
5.3MB, and `_emscripten_resize_heap` is literally `function(){ return false }`. A
failed `_malloc` is not reported: `_AllocateFrameBuffer` wraps the null pointer in
`new Uint8Array(HEAPU8.buffer, 0, size)` and passes it to `doTracking`, which
walks off the heap. The console signature is `abort(). Build with -s ASSERTIONS=1
for more info.` thrown from `_prerender` and caught by the kit's own handler, then
`BindingError: Cannot use deleted val. handle = 0` from `freeResources` as the
teardown walks already-dead embind handles. None of the kit's own events fire, so
the frame hangs.

Held as suspected rather than confirmed: 10.6MB against ~26.7MB of usable heap is
not obviously fatal on its own, and the model weights loaded by
`initWebEnvCheckerTrackingManager` have not been measured. What is certain is that
mobile is the only path that sizes this buffer from the stream, which is why
desktop never saw it. If 9:16 does not clear it, the next measurement to take is
the model footprint — not another aspect ratio.

Events: `loaded`, `closed`, `cameraFailed` (`error_permission_denied`,
`error_resolution_unsupported`, `error_access_failed`), `unsupportedResolution`,
`faceQualityChanged` (`{ hasFace, position, frontal, lighting }`, continuous),
and `faceDetectionCaptured` — which fires **only after every check passes**, and
auto-fires after `countingDuration` (default 800ms). There is no shutter.

`qualityLevel` presets, with the numbers that matter to us:

| | RELAXED | MODERATE | STRICT |
|---|---|---|---|
| `face_ratio_lower_threshold` | 0.55 | 0.65 | 0.75 |
| `yaw` / `roll` | ±15° | ±10° | ±5° |
| `pitch` | −20…10° | −15…5° | −10…0° |
| `lighting_lower/upper` | 0.55–0.8 | 0.7–0.85 | 0.8–0.9 |
| `lighting_uneven_threshold` | 0.2 | 0.15 | 0.1 |

`lighting_uneven_threshold` is max luma difference between the eyes — the same
measure as check 2 in `docs/capture-quality.md`. Per-edge face boundaries are
also settable via `qualityOverrides`; an override may never be *less* restrictive
than RELAXED.

**`close()` returns long before the kit has closed, and reopening into the gap
kills it.** `close()` only fires an event; the controller behind it sleeps a
second, then frees its WASM heap allocations, destroys the filter and drops the
module. `open()` waits for that — but only while `isEngineLoaded` is true, and
the close event clears that flag synchronously, so a close followed by an open
reads as "nothing was running" and skips the wait. The new session is then built
on a module the old teardown frees underneath it, and the kit dies inside its
face-tracking WASM (`abort(16)`, or an out-of-bounds access) having fired none
of its own events. There is no teardown-complete event to wait on — the public
`closed` fires at the *start* of teardown — so `camera-capture.tsx` gates a
reopen behind a timer sized to the kit's own `sleep(1000)`.

**`face_ratio_upper_threshold` is fixed at 1.0 in every preset.** The kit floors
face scale and never pins it, so STRICT constrains the series to the band
[0.75, 1.0] rather than to a point. Rule 3 is therefore satisfied by the user
physically moving closer, not by cropping afterwards — cropping to hit a target
fraction discards the resolution the measurement depends on.

---

## Error codes seen in the wild

| Code | Meaning | Billed? |
|---|---|---|
| `InvalidParameters` (400) | missing/invalid field; message usually names it | no |
| `error_src_face_too_small` | face too small a fraction of the frame | no |
| `TaskTimeout` (500) | *"Engine task timeout"* — the engine gave up | no |
| `UNKNOWN_ERROR` | face found, feature extraction failed (reported by others) | unverified |

Documented rate limits (unverified): 100 requests / 5 min per IP, 100 / min per
token.

---

## Sources

Public material, all of it thinner than the notes above:

- [Quick start guide](https://docs.perfectcorp.com/develop/quick_start_guide)
- [API docs portal](https://yce.perfectcorp.com/document/index.html)
- [Skin analysis reference](https://docs.perfectcorp.com/reference/ai_skin_analysis)
- [Perfect Corp skincare app walkthrough](https://www.perfectcorp.com/business/blog/ai-skincare/skin-analysis-api-claude-mcp-integration)
- [nakamura196/zenn-youcam](https://github.com/nakamura196/zenn-youcam) — community
  reverse-engineering of 20 tasks; notably does **not** cover skin-simulation
