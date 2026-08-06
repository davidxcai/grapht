# Archive — the forecasting design

These documents describe the project's **previous direction**: "DermaCast AI," a
predictive skincare trajectory engine that fitted a regression to a metric
history, projected it 14–60 days forward, and rendered the projected face with
the YouCam Skin Simulation API.

That direction was retired. Not on taste — on measurement:

- The detection horizon is **100–200 days** of daily logging before a trend
  clears its own noise (`../measurements.md`, Finding 5). A forward 14-day
  forecast on this dataset contains nothing resolvable.
- A real forecast slope maps to a simulation intensity of **~0.02–0.04**, which
  renders as no visible change at all (`simulation-constraints.md`).
- Simulation intensity is clamped to **[0.0, 1.0]**, so the "abandonment
  trajectory" — skin getting worse — could never have been rendered.

The current design is [`../../PRODUCT.md`](../../PRODUCT.md): retrospective
trials with an explicit detection gate. Nothing here is authoritative anymore.

## Why these are kept rather than deleted

Everything below is measured, hard-won, and easy to accidentally redo.
`simulation-constraints.md` in particular contains the only empirical knowledge
anywhere of what a Skin Simulation intensity actually *means* — recovered by
probing, at real unit cost, and absent from Perfect Corp's public docs.

If the project ever renders a face again, start here rather than from scratch.

| File | Still worth reading for |
|---|---|
| `IDEA.md` | The original product brief. Historical context for `PRODUCT.md` §8. |
| `forecast-design.md` | The Kalman/OLS blend derivation, the 500-draw window sweep, and the full synthetic-scenario taxonomy. The surviving parts are carried into `../trial-analysis.md`. |
| `simulation-constraints.md` | What a simulation intensity means (`Δscore / (100 − score_now)`), verified at the endpoints. Renderer constraints and costs. |
| `skin-sim.md` | Perfect Corp's own Skin Simulation documentation, verbatim. Note its ≥60%-of-image-**width** face requirement, which none of our normalized photos meet. |
| `side-by-side-viewer.md` | Before/after comparison viewer design. Largely reusable — a retrospective trial has a real "before" and a real "after," which is a *better* fit for this component than the synthesised future face it was designed against. |

Safe to delete wholesale (`rm -rf docs/_archive`) if the history isn't wanted.
