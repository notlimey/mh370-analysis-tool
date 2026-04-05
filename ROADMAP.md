# Roadmap

This roadmap is for turning the current MH370 app into a better research and collaboration tool.

It is biased toward:

- inspectability over polish
- explicit uncertainty over false precision
- reproducible runs over ad hoc tweaking
- communication fidelity over impressive-looking outputs

## Current State

The app already has:

- candidate path generation and family classification
- probability heatmap generation
- searched-area overlays and continuation summaries
- debris drift simulation and inversion layers
- shareable URL state
- AI-friendly context export
- stale-result warnings
- analyst notes
- session snapshot export/import
- a lightweight model config modal with reset-to-default support

The current bottleneck is not just modeling. It is being able to say, clearly and reproducibly:

- what the user is looking at
- what was actually run
- whether the visible result is still valid for the current assumptions
- why the model currently prefers one family over another

## Now

These are the highest-leverage tasks for the next phase.

### 1. Make workspace state easier to communicate

Goal:
Make pasted context and restored sessions trustworthy enough that a collaborator can reason from them without guessing.

Priority tasks:

- Auto-save and auto-restore the last session
- Report when a loaded result exists but its corresponding layer is hidden
- Report when drift results exist but no origin is selected
- Distinguish `selected scenario` from `workspace currently matches scenario`
- Include richer evidence selection context in AI export
- Add keyboard shortcuts for AI context export and session export

Success looks like:

- A pasted context block explains the visible state without ambiguity
- A session import/export round-trip restores the reasoning state, not just the viewport
- Contradictory state is called out explicitly

### 2. Make BFO fit and scoring inspectable

Goal:
Understand why a path is labeled "best", especially when BFO fit is poor.

Priority tasks:

- Add a BFO diagnostics panel
- Show per-arc residuals, skip reasons, and `used_count / total_count`
- Surface max residual and worst arc
- Export score decomposition for the best path/family
- Add weak-fit warnings when BFO residuals are high
- Add a quick BFO sensitivity rerun workflow

Success looks like:

- The app can distinguish `best available` from `good fit`
- A user can tell whether BFO is constraining the answer or being overwhelmed by other terms

### 3. Improve comparison workflows

Goal:
Make it easier to compare runs and understand sensitivity instead of tweaking blindly.

Priority tasks:

- Save current run with meaningful metadata
- Compare two saved runs side-by-side in text form
- Highlight config differences and result differences clearly
- Add a lightweight sensitivity workflow for a few key assumptions

Success looks like:

- A user can answer "what changed and why?" after a rerun

## Next

These are valuable, but less urgent than the work above.

### 4. Screenshot export

- One-click PNG export of current map state
- Optional legend/timestamp strip
- Best used alongside AI context export

### 5. Better run history and reporting

- Turn saved runs into a real workflow, not a placeholder
- Improve generated report quality
- Include warnings, freshness, and config provenance in reports

### 6. Area-of-interest annotations

- Draw polygons/regions of interest on the map
- Persist them locally
- Include them in export and session snapshots
- Useful for marking candidate search zones or questions to revisit

### 7. Small workflow shortcuts

- Keyboard shortcuts for common actions
- Better quick actions in the export panel
- Possibly a right-click "what's here?" map action later

## Later

These still matter, but they are not the main bottleneck today.

### 8. Externalized Rust-owned config

Goal:
Move all analysis parameters into a Rust-owned, inspectable config source with clear provenance.

Why later:

- This is still important infrastructure
- But it is no longer the most immediate product bottleneck
- Better communication and diagnostics will help define which config work matters most

Likely direction:

- `config/analysis.default.toml`
- `config/analysis.local.toml`
- resolved config returned from Rust with source metadata
- frontend reading resolved config instead of maintaining parallel defaults

### 9. Parameter sensitivity view

- Run a small set of config variations automatically
- Show how heatmap peak and family preference shift
- Better for structured exploration than manual tweaking

### 10. Overlay comparison and visual diff tools

- A/B heatmap comparison
- possibly slider-based or blink comparison
- useful after saved-run comparison is stronger

### 11. Timeline and evidence storytelling improvements

- debris timeline animation
- better evidence cross-linking
- more guided explanations of why a claim matters

## Shipped Recently

- Shareable URL hash state
- `Copy Link`
- `Copy Context for AI`
- Warnings for stale results and scenario drift
- Analyst notes
- Session snapshot export/import
- Model config modal
- Reset-to-default support in model config

## Decision Rule

When choosing between roadmap items, prefer the one that most improves this loop:

1. Change assumption
2. Run analysis
3. Understand why the result changed
4. Capture the state clearly
5. Share it without ambiguity

If a feature does not improve that loop, it is probably not a `Now` item.
