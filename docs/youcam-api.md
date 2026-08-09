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

SD and HD are the same fourteen names, HD prefixed with `hd_`. **SD and HD cannot
be mixed in one request** — the task is rejected.

```
wrinkle  droopy_upper_eyelid  droopy_lower_eyelid  firmness  acne  moisture
eye_bag  dark_circle_v2  age_spot  radiance  redness  oiliness  pore  texture
```

Measured on one image, **SD and HD return bit-identical `raw_score` for
`redness`, `oiliness`, and `age_spot`** — same model, different label, no benefit
from HD. Only `acne`, `texture`, and `pore` differ, and only those return zonal
breakdowns. HD is still the right default because it is a strict superset.

**`dark_circle_v2` is the one name that isn't symmetric.** In `dst_actions`,
`hd_dark_circle_v2` is rejected — `"0 is not one of the accepted values."`
alone, or `"9 is not one of the accepted values."` (its array index) inside
the full 14-concern list. `hd_dark_circle` (no `_v2`) is accepted; every other
name round-trips through a plain `hd_` prefix. Confirmed by probe 2026-08-08
with an invalid `src_file_id`, so it cost 0 units — see `toRequestAction` in
`src/concerns.mjs`. Not yet confirmed: which name a *successful* response
echoes back for this concern; `src/results.mjs::normalizeScores` remaps
`dark_circle` to `dark_circle_v2` defensively either way. The first live 14-
concern capture will settle it — worth a quick check of `data/analysis/`
or a captured trial's raw scores next time one completes.

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

`src/face.mjs` therefore targets 0.55. Do not lower it without re-running
`scripts/test-face-fraction.mjs`.

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