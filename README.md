# MH370 Analysis Tool

> If you found this searching for MH370 analysis tools — you're in the right place. See the [disclaimer](#honest-disclaimer--read-this-first) before drawing any conclusions from the output.

An open-source tool for visualising and exploring the public data around the disappearance of Malaysia Airlines Flight MH370. Built with Tauri (Rust + TypeScript) and Mapbox GL.

![MH370 Analysis Tool screenshot](assets/app-overview.png)

![License](https://img.shields.io/badge/license-MIT-blue)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8D8)
![Data](https://img.shields.io/badge/data-public%20sources%20only-green)

---

## Honest disclaimer — read this first

I am not a researcher, aviation expert, satellite communications engineer, or oceanographer. I have no domain expertise in any of the fields this touches.

What I am: a developer who found this case fascinating and spent time building a tool to visualise the public data in a way that makes the uncertainty legible.

**The physics and math in this tool came from:**
- The ATSB operational search reports (public)
- The Inmarsat satellite data release (public)
- The Independent Group's published analyses — particularly Victor Iannello, Bobby Ulich, Richard Godfrey, and Duncan Steel
- Published peer-reviewed papers cited throughout the codebase

**I have not independently verified any of the underlying science.** I have implemented what those sources describe, as faithfully as I could. If something is wrong it is most likely an implementation error on my part, not a flaw in the underlying research.

If you are a domain expert and see something wrong — please open an issue. That is the entire point of making this public.

---

## What the tool does

Visualises the public Inmarsat BTO/BFO data as arc rings, samples candidate flight paths through those rings, scores them on BTO consistency and fuel feasibility, and produces a probability distribution along the 7th arc.

**Key design choice:** every assumption the official searches hardcoded is a configurable parameter here — cruise speed, satellite drift correction, fuel burn rate, post-arc-7 continuation time. You can move the sliders and watch the probable endpoint shift. The goal is to make the sensitivity of the conclusions to their assumptions visually obvious.

### Layers

| Layer | Description |
|---|---|
| Known Flight Path | Confirmed radar track from takeoff to last radar contact at 18:22 UTC |
| BTO Arc Rings | Distance rings from Inmarsat-3F1 satellite at each handshake timestamp |
| Candidate Paths | Sampled flight paths that satisfy BTO constraints, coloured by path family |
| Probability Heatmap | Normalised probability distribution along the 7th arc |
| Searched Areas | ATSB Phase 1/2 and Ocean Infinity 2018/2025-2026 coverage |
| Data Holidays | Areas inside the searched zone with missing or poor-quality sonar data |
| Priority Gaps | Derived layer — high-probability zones that overlap with data holidays |
| AUV Sonar | Live 5m resolution AUV sidescan sonar from Geoscience Australia WMS |
| Deep Tow Sonar | Live 5m deep tow sidescan sonar from Geoscience Australia WMS |
| EMAG2 Magnetic | Seabed magnetic anomaly — identifies terrain where magnetometer search would be productive |
| 2014 Airspaces | FIR boundaries frozen to March 8 2014 — shows airspace the pilot was navigating around |
| Anomaly Markers | Untapped/underanalysed data sources — hydroacoustic events, satellite imagery anomalies, barnacle evidence |
| Debris & Drift | All 43 confirmed and suspected debris finds with reverse drift corridors |
| Key Points | KLIA departure, last radar contact, satellite position |

### Configurable model parameters

- Speed range (knots) — affects which arc crossings are physically reachable
- Satellite drift correction — applies actual I3F1 orbital position instead of nominal 64.5°E
- Fuel at arc 1 (kg) — starting fuel for the post-MEKAR segment
- Fuel burn baseline (kg/hr) — scales with speed
- Post-arc-7 continuation — how far the plane could have flown after the final ping
- Debris drift latitude weighting — soft weight toward debris-consistent latitudes
- Path sampler density — number of candidate paths to generate

---

## What the tool does not do

- Produce authoritative conclusions
- Incorporate BFO heading analysis fully (next major analytical step; not yet used for scoring)
- Account for wind and atmospheric effects on fuel burn
- Model anything beyond the publicly available data
- Replace actual investigation by qualified experts

---

## Why the arc 6 / arc 7 anomaly matters

Both the 6th arc (00:10:58 UTC) and 7th arc (00:19:29 UTC) have identical BTO values of 18,400 microseconds. At cruise speed, the aircraft should have moved roughly 67 nautical miles in that 8.5 minutes — the BTO should have changed measurably. This anomaly implies either the aircraft slowed dramatically, changed heading to fly nearly tangentially to the satellite, or there is a quantization ceiling in the measurement. The tool detects this and labels candidate paths accordingly:

- **Slow** — aircraft reduced speed significantly before the final ping
- **Perpendicular** — aircraft heading was nearly tangential to the satellite direction
- **Mixed** — combination of both
- **Other** — unclassified

Each family implies a different distance from the 7th arc at impact, which is why the two major search campaigns may have been looking in the right zone but the wrong width band.

---

## Data sources

All data is public. Full attribution is in the source files.

| Dataset | Source | License |
|---|---|---|
| Inmarsat BTO/BFO handshake data | Malaysian government release, May 2014 | Public |
| Satellite ephemeris (I3F1) | ATSB Definition of Underwater Search Areas, Table 3 | Public |
| Sonar coverage (WMS) | Geoscience Australia / ATSB | CC BY 4.0 |
| Bathymetry | Geoscience Australia / ATSB | CC BY 4.0 |
| Magnetic anomaly (EMAG2v3) | NOAA National Centers for Environmental Information | Public domain |
| FIR boundaries | ICAO, manually encoded, frozen to 8 March 2014 | Public |
| Debris locations | ATSB Operational Search Report 2017 | Public |
| Data holidays | ATSB 2022 Data Review Report | Public |
| Searched zone boundaries | ATSB / Geoscience Australia | CC BY 4.0 |

Sonar data is streamed live from the Geoscience Australia WMS server — no download required, but an internet connection is needed for those layers.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) for your OS
- A [Mapbox](https://mapbox.com) account (free tier is sufficient)

### Setup

```bash
git clone https://github.com/notlimey/mh370-analysis-tool
cd mh370-analysis-tool
cp .env.example .env
# Add your Mapbox token to .env
pnpm install
pnpm tauri dev
```

For a production frontend build:

```bash
pnpm build
```

### Environment variables

```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

---

## Architecture

Built on [Tauri 2](https://tauri.app) with a Rust backend for all calculations and a TypeScript/Mapbox GL frontend for visualisation.

```
src-tauri/src/mh370/
├── data.rs          # Inmarsat handshake records
├── geometry.rs      # Haversine, great-circle, arc math
├── arcs.rs          # BTO → distance rings with satellite drift correction
├── satellite.rs     # I3F1 ephemeris interpolation
├── paths.rs         # Candidate path sampling and scoring
├── probability.rs   # Bayesian heatmap along 7th arc
└── drift.rs         # Debris reverse drift model

src/layers/
├── arcs.ts          # BTO arc ring rendering
├── paths.ts         # Path family coloured rendering
├── heatmap.ts       # Probability heatmap
├── sonar.ts         # AusSeabed WMS sonar layers
├── magnetic.ts      # EMAG2 raster overlay
├── holidays.ts      # Data holiday polygons
├── priority.ts      # Priority gap derived layer
├── debris.ts        # Debris markers and drift lines
└── airspaces.ts     # 2014 FIR boundary layer
```

See [AGENTS.md](AGENTS.md) for full architecture documentation and [ANOMALY_DRIFT_NOTES.md](ANOMALY_DRIFT_NOTES.md) for the research roadmap.

---

## Built with AI assistance

This project was built with significant AI assistance (Claude by Anthropic). The AI helped with:

- Identifying relevant data sources and published research
- Implementing the satellite geometry and BTO calibration math
- Understanding the arc 6/7 anomaly and its implications
- Suggesting the path family classification approach
- Architecture decisions throughout

The judgement calls — what to build, what assumptions to expose, what the tool should communicate — were mine.

---

## For researchers

If this tool is useful to you, or if you see errors in the implementation, please open an issue or PR. The codebase is documented with sources throughout.

The most valuable thing a domain expert could contribute is verifying whether these are implemented correctly:

- **BTO calibration** — empirical offset derived from pre-departure known-position pings (`src-tauri/src/mh370/arcs.rs`)
- **Satellite ephemeris handling** — external ephemeris file support with fallback approximation in `src-tauri/src/mh370/satellite.rs`
- **Fuel model** — linear burn rate scaled by speed, no atmospheric correction (`src-tauri/src/mh370/paths.rs`)
- **BFO scoring** — not yet integrated as a soft weight; needs expert review before being used analytically

The Independent Group researchers whose published work this tool is built on:
- Victor Iannello — [mh370.radiantphysics.com](https://mh370.radiantphysics.com)
- Richard Godfrey — [mh370search.com](https://mh370search.com)
- Duncan Steel — [duncansteel.com](https://duncansteel.com)
- Ed Anderson — [370location.org](https://370location.org)

---

## Contributing

Issues and PRs welcome. Please read [AGENTS.md](AGENTS.md) before contributing code — it describes the architecture, data sources, and the reasoning behind key design decisions.

If you are a domain expert (satellite communications, oceanography, aviation performance, fluid dynamics) your review of the implementation is especially valuable. Please be explicit about which parts you have and haven't verified.

---

## License

MIT — use this freely. If you build something on top of it, a link back would be appreciated but is not required.

Attribution for the underlying data belongs to the sources listed above, not to this project.

---

## Keywords

MH370 · Malaysia Airlines Flight 370 · MH370 search · Inmarsat BTO BFO · 7th arc · southern Indian Ocean · MH370 flight path · satellite ping analysis · Geoscience Australia sonar · MH370 probability · underwater search · MH370 data visualization · MH370 open source · Independent Group MH370 · Inmarsat-3F1 · burst timing offset · burst frequency offset · MH370 arc rings · MH370 candidate paths · MH370 path families
