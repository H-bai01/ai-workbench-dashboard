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

---

# Sparse cockpit adaptive-height QA

- Source visual truth:
  - `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-acc1237c-ba79-411e-8369-0fa6f02257af.png`
  - `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-7040d872-0922-4c45-afac-f2fb15c3fb1b.png`
  - `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-1fb2cf58-733b-4e56-900e-b3be4019ed22.png`
- Same-viewport implementation screenshot: `/private/tmp/ai-workbench-adaptive-same-viewport.png`
- Expanded-state implementation screenshot: `/private/tmp/ai-workbench-adaptive-expanded.png`
- Viewport comparison: `1686 × 828` CSS px, dark theme, `上个月`, collapsed lists
- Additional responsive checks: `1660 × 640` and `1400 × 850`, collapsed and synchronized expanded states

## Comparison evidence

The source captures show fixed-height cockpit cards retaining several hundred pixels of empty space when only two model rows, one Agent, or a short ranking list is available. The three cards also end at visibly different vertical positions, while the narrow left card lets the percentage column crowd the cost value.

The same-viewport implementation removes the fixed desktop card height. Each list now derives its visible height from the number of rows actually rendered, the CSS grid row stretches the three siblings to one shared height, and all three card bottoms align exactly. At the tested sparse `7 天` state the shared card height contracts to `379.16px`; at denser `30 天` and `上个月` states it grows to `411.56px`. The maximum measured bottom-edge difference is `0px`.

The expanded-state capture verifies that both list scrollbars remain visible, expansion still grows the shared row, and cards remain aligned. At `1400px`, every model row stays inside the left card; no name, token, cost, or percentage child crosses its row boundary.

## Findings

No actionable P0, P1, P2 or P3 visual issue remains for the requested adaptive contraction and alignment behavior.

## Primary interactions checked

- Switching between `7 天`, `30 天` and `上个月` updates content density without restoring a fixed blank area.
- Expanding and collapsing the contribution list keeps model and ranking states synchronized.
- Expanded lists retain visible scrollbars and can reveal the remaining rows.
- Sparse and dense states keep all three cockpit card bottoms aligned.
- Narrow left-card model values remain contained and readable.

final result: passed

---

# Model-row and chart-width alignment QA

- Source visual truth: `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-1fb2cf58-733b-4e56-900e-b3be4019ed22.png`
- Implementation screenshot: `/private/tmp/ai-workbench-model-row-width-aligned.png`
- Viewport: `1664 × 641` CSS px, dark theme, `7 天`, collapsed lists

## Comparison evidence

The reported mismatch is inside the left cost card: the collapsed model rows ended early because the model list permanently reserved a scrollbar gutter, while the chart used the full content width. The implementation removes that gutter when the list is collapsed, so the left and right edges of every model row now match the chart card. The gutter is restored only in expanded mode where the visible scrollbar needs clearance.

## Findings

No actionable P0, P1, P2 or P3 visual issue remains for the requested internal width alignment.

final result: passed

---

# Cost chart and leaderboard alignment QA

- Source visual truth: `/var/folders/6j/yplkbbr50h56qlnp5f7zv_7h0000gn/T/codex-clipboard-308bfe38-a0f3-4cf1-8003-6e64039a996c.png`
- Implementation screenshot: `/private/tmp/ai-workbench-cost-card-aligned.png`
- Combined comparison: `/private/tmp/ai-workbench-cost-card-comparison.png`
- Viewport: `1693 × 630` CSS px, dashboard density scale `0.9`
- State: dark theme, 30-day range, model and ranking lists collapsed

## Comparison evidence

The requested visual baseline is the bottom edge of the cost chart and the bottom edge of the leaderboard's fifth row. Before the correction, the chart ended `36px` lower than the fifth row at the tested viewport. After the correction, the measured difference is `0.16px`, which is the expected subpixel rounding from the responsive density scale.

The model summary still displays three rows, the leaderboard still displays seven rows, and the shared expand/collapse behavior remains unchanged. The adjustment is restricted to desktop three-column layouts; stacked tablet and mobile layouts retain their existing flexible chart sizing.

## Findings

No actionable P0, P1, P2 or P3 difference remains for the requested alignment.

final result: passed
