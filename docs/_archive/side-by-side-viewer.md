# Side-by-Side Magnified Comparison Viewer

## Overview

A synchronized dual-pane image viewer that displays current and forecasted skin side-by-side with linked zoom and pan controls. Enables pixel-level inspection of predicted changes, grounding the forecast in measurable detail rather than presenting it as a generic beautification.

## Purpose

Users often cannot perceive subtle daily skin changes. The side-by-side viewer serves two goals:

1. **Credibility**: By allowing users to zoom into the exact same facial region on both images and compare pixel-by-pixel, the forecast is presented as measured evidence, not marketing filter.
2. **Engagement**: Synchronized zoom creates an interactive way to explore how the forecast differs from the current state, focusing attention on specific problem areas.

## Viewer States

### Improvement Scenario (Score increasing)
- **Left pane**: Current photo (unmodified)
- **Right pane**: Forecasted photo (Skin Simulation rendered at computed intensity)
- **Zoom sync**: Pinch/scroll on either pane zooms both to the same level
- **Pan sync**: Panning on either pane pans both to show the same region
- **Highlight**: Small changes are marked (e.g., via subtle border, badge, or annotation) to acknowledge measurement resolution

### Worsening Scenario (Score decreasing)
- **Left pane**: Current photo (unmodified)
- **Right pane**: Current photo with problem-area masks + text warning
  - Mask overlay highlights regions where deterioration is forecasted (PNG masks from analysis)
  - Text indicates the direction and severity of change
- **Zoom sync**: Works the same way; masks zoom proportionally
- **Benefit**: Maintains credibility by refusing to synthesize an improved image that won't materialize

### Neutral Scenario (No meaningful change)
- Both panes show the current photo
- Viewer indicates "no significant change detected" or similar
- Reset button returns to full-frame view

## Interaction

### Mobile (Touch)

- **Pinch-zoom**: Two-finger pinch on either pane zooms both in/out symmetrically
- **Pan**: Single-finger drag on either pane pans both to the same location
- **Double-tap**: Quick reset to full-frame view
- **Visual indicator**: Shows current zoom level (e.g., "2.5x")

### Desktop (Mouse/Trackpad)

- **Scroll wheel / trackpad pinch**: Zoom in/out (centered on cursor)
- **Click-drag**: Pan both panes together
- **Keyboard**: Shortcuts (e.g., `+` / `-` to zoom, arrow keys to pan)
- **Reset button**: Click to return to full-frame

## Sync Behavior

**State to maintain across both panes:**
- Zoom level (same magnification factor on both)
- Pan offset (both show the same region relative to the image center)
- Rotation/orientation (if applicable; most use cases are frontal face photos)

**Implementation approach:**
- Use a shared transform state (zoom factor + pan x/y offset)
- Apply the same transform to both canvases/image containers
- Listen to touch/mouse events on either pane and update the shared state
- Redraw/reposition both on every update

## Edge Cases

### High-Resolution Images
If source images are very large (e.g., 2560px), rendering two canvases with full resolution can be memory-intensive. Consider:
- Tile-based rendering or level-of-detail (LOD) approach
- Lazy-load only the visible region at the current zoom level
- Cap max zoom to avoid loading 4x or 8x the necessary pixels

### Very Small Changes
If the forecast change is imperceptible (e.g., < 1 point on the 0–100 scale and below noise floor):
- Display both panes but mark them as "change below measurement resolution"
- Avoid rendering a simulation; instead, show both images identical with text indicating no detectable change
- This maintains honesty: don't render difference if none is reliably measured

### Device-Specific Rendering
Ensure the right-pane image (simulated future) is generated at the same resolution, orientation, and color profile as the left-pane current photo. Mismatched rendering can introduce optical illusions of change that don't exist.

### Aspect Ratio Mismatch
If the current and future photos differ slightly in aspect ratio (e.g., due to face reframing in Skin Simulation):
- Letterbox or crop to a common aspect ratio
- Make the decision consistent so users can focus on skin changes, not geometry changes

## Performance Notes

- **Rendering**: Use efficient canvas or WebGL rendering for large images to avoid jank during zoom/pan
- **Debounce events**: Throttle zoom/pan listeners to avoid excessive redraws
- **Preload images**: Fetch both current and future images before showing the viewer; do not load them lazily
- **Memory**: Monitor heap usage when handling high-res images; consider discarding out-of-focus tiles

## Accessibility

- Provide keyboard controls for zoom and pan (arrow keys, `+`/`-`)
- Announce zoom level changes to screen readers
- Ensure pinch/scroll gestures have keyboard equivalents
- Provide alt text or descriptions for the current and future photos
- Consider a "flip" button to swap left/right for users who prefer different layouts

## Relationship to Intensity Mapping

The visual differences users see in the right pane are directly driven by the forecast intensity computed from the score delta:

```
problem_current = (100 - current_score) / 100
problem_forecast = (100 - forecast_score) / 100
api_intensity = (problem_current - problem_forecast) / problem_current
```

By allowing pixel-level inspection, the viewer validates this mapping: the rendered change should be proportional to the forecast delta, not exaggerated or minimized.
