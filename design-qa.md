# Responsive density design QA

- Source visual truth: `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-b7a40a3a-665d-44e7-8566-32adc6b68317.png`
- Implementation screenshot: `/private/tmp/ai-workbench-density-1280.png`
- Combined comparison: `/private/tmp/ai-workbench-density-comparison.png`
- Viewport: `1280 × 730` CSS px, device pixel ratio `2`
- State: dark theme, dashboard overview, compact model and ranking lists

## Full-view comparison evidence

The source is the reported failure state: the app reflows to two columns while retaining desktop-sized typography, controls, cards and spacing. The implementation applies a common density scale to the full application surface and restores the three-column cockpit when the scaled layout has enough room. The complete cockpit and operation dock now fit above the fold without horizontal overflow.

## Focused region comparison evidence

The cockpit was inspected separately because it contains the densest combination of chart labels, app tabs, avatars and ranking rows. At `1280px`, all three cards remain readable after the `0.8` scale; chart labels remain distinct, app names do not overlap, and ranking values stay visible. A detail dialog was also opened to verify that overlay content remains usable under the same body-level density rule.

## Required fidelity surfaces

- Typography: hierarchy and weight are unchanged; all text scales together instead of using isolated smaller font overrides.
- Spacing and layout: gutters, card padding, controls, icons and text share one scale. Three columns are restored at notebook widths, two columns remain for narrower notebooks, and one column is reserved for tablet/mobile widths.
- Colors and tokens: no theme token or contrast changes.
- Image quality: existing SVG and raster logos/avatars remain unchanged and retain their aspect ratios.
- Copy and content: no copy or data behavior changes.
- Responsiveness: no document-level horizontal overflow at `1440`, `1280`, `1024`, `820` or `480` widths; the dashboard retains vertical scrolling.

## Comparison history

1. Initial implementation used responsive reflow only. P1: the interface remained visually oversized and moved the contribution ranking to a new row.
2. First density pass scaled only the dashboard and overcompensated its width. P1: the third column extended outside the viewport.
3. Final pass moved scaling to the complete application body, removed redundant width compensation and restored the three-column layout only where the scaled canvas can hold it. Post-fix evidence shows no horizontal overflow and a coordinated application-wide density.

## Findings

No actionable P0, P1 or P2 differences remain for the requested proportional-density correction.

P3: the density changes at explicit viewport bands rather than animating continuously. This avoids blurred fractional rendering and unpredictable dialog geometry; the steps are acceptable at the tested breakpoints.

The density bands are intentionally tied to the effective CSS viewport rather than the monitor's physical pixel count. This makes a Retina/HiDPI window at `1280` CSS pixels use the compact density even when the underlying display has many more physical pixels.

## Primary interactions checked

- Time-range and display controls remain visible.
- Contribution detail dialog opens and fits the viewport.
- Dashboard vertical scrolling remains available.
- No new browser console error was introduced by the responsive CSS.

final result: passed
