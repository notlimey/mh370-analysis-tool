# Sharing, Export & App Improvements

## Priority 1: Map State URL (Shareable Links)

Encode current view state into URL hash so copy-pasting the URL reproduces the same view.

**State to encode:**
- Map center (lat/lon), zoom level, bearing, pitch
- Active layers (comma-separated IDs)
- Selected scenario ID
- Selected drift origin index (if any)
- Config overrides (only non-default values, to keep URL short)

**Format:** `#lat=-34.2&lon=93.5&z=6&layers=heatmap,arcs,drift-clouds&scenario=drift_analysis&origin=3`

**Behavior:**
- On app load, parse hash and apply state
- Add "Copy Link" button to the icon rail footer or export panel
- Update hash on meaningful state changes (layer toggle, zoom, scenario change) — debounced
- Works in both Tauri and web snapshot mode

**Files likely involved:** `src/main.ts`, new `src/lib/urlState.ts`, `src/map.ts`, `src/ui/panels/exportPanel.ts`

---

## Priority 2: LLM-Friendly Context Export

"Copy Context for AI" button that generates a structured markdown summary of the current analysis state, optimized for pasting into an LLM conversation.

**Output format:**
```markdown
## MH370 Analysis State

### Configuration
- Speed range: 400–520 kts
- Beam width: 12
- Fuel at arc 1: 23,000 kg
- [only non-default values]

### Model Results
- Heatmap peak: 34.2°S, 93.5°E
- Best path family: slow (score: 0.87)
- Paths: 142, Heatmap points: 720
- BFO mean residual: 4.2 Hz

### Drift Simulation
- Selected origin: 34.8°S, 92.2°E
- Beaching: 1781 East Africa, 173 South Africa, 15 Réunion
- Fit: 3/100, Spatial: 7/100, Timing: 18/100
- Matched debris: Flap track Mozambique, Maputo panel

### Inversion
- Debris peak: 33.8°S
- 68% CI: [-35.2°, -32.1°]
- Intersection latitude: -34.0°S

### Viewport
- Bounds: [-38°S to -28°S, 80°E to 100°E]
- Active layers: heatmap, arcs, drift-clouds
- Pins: "Candidate A" at -33.5°S, 94.2°E

### Raw Data (JSON)
[fenced JSON block with candidate list, item contributions, config]
```

**Behavior:**
- Button in Export panel (and maybe a keyboard shortcut like Cmd+Shift+C)
- Copies to clipboard
- Pulls from cached state in model panel, drift panel, inversion module
- Include only sections that have data (skip empty sections)

**Files likely involved:** new `src/lib/contextExport.ts`, `src/ui/panels/exportPanel.ts`

---

## Priority 3: Screenshot Export

One-click PNG capture of the current map view with optional legend overlay.

**Behavior:**
- Use `map.getCanvas().toDataURL("image/png")`
- Optionally composite a legend strip (active layers, scale bar, timestamp) onto the canvas before export
- Save as file (Tauri) or trigger download (web)
- Button in Export panel

**Files likely involved:** new `src/lib/screenshot.ts`, `src/ui/panels/exportPanel.ts`

---

## Priority 4: Session Snapshot (Import/Export)

Export/import the full workspace state as a `.mh370-session.json` file.

**Contents:**
```json
{
  "version": 1,
  "timestamp": "2026-04-05T12:00:00Z",
  "config": { ...AnalysisConfig },
  "layerVisibility": { "heatmap": true, ... },
  "scenario": "drift_analysis",
  "viewport": { "center": [93.5, -34.2], "zoom": 6 },
  "pins": [ ... ],
  "driftResults": [ ...BeachingCloud[] ],
  "inversionResult": { ...InversionResult },
  "notes": "Investigating southern corridor..."
}
```

**Behavior:**
- "Export Session" / "Import Session" buttons in Export panel
- Export: serialize all state to JSON, save as file
- Import: parse JSON, apply config, restore layers, restore drift/inversion results without re-running
- This also solves the "last result store" request from earlier — auto-save session on close, auto-restore on open

**Files likely involved:** new `src/model/session.ts` (extend existing), `src/ui/panels/exportPanel.ts`, `src/main.ts`

---

## Priority 5: Area of Interest Annotations

Draw rectangles/polygons on the map to mark regions of interest.

**Behavior:**
- "Draw Region" button activates Mapbox draw mode
- User draws polygon, enters a name and optional notes
- Regions persist in localStorage alongside pins
- Regions render as semi-transparent overlays with labels
- Exportable as GeoJSON
- Useful for marking "re-search this zone" or "high interest area"

**Files likely involved:** new `src/model/regions.ts`, new `src/layers/regions.ts`, `src/ui/panels/layersPanel.ts`

---

## Other Ideas (Lower Priority)

### Parameter Sensitivity View
Run the model at N config variations automatically, show how heatmap peak shifts. Table or small multiples view. Helps answer "how sensitive is the result to speed range?"

### Overlay Comparison (A/B Slider)
Toggle between two saved runs' heatmaps with a horizontal slider on the map. Side-by-side visual comparison.

### Debris Timeline Animation
Animate debris finds appearing on the map in chronological order (Jul 2015 → 2018). Shows the discovery progression and how the evidence built up over time.

### Keyboard Shortcuts
- `1`–`5` for rail tabs
- `Space` to run model
- `[` / `]` to cycle drift origins
- `Cmd+Shift+C` for LLM context export
- `Cmd+S` for screenshot

### Right-Click Context Menu
"What's here?" on map right-click showing:
- Lat/lon coordinates
- Distance to nearest 7th arc point
- Nearest debris find and distance
- Whether this point is in a searched area
- Quick "Add Pin" option

### Minimap
Small inset map (bottom-left corner) showing the full Indian Ocean with a viewport rectangle. Helps orientation when zoomed in.
