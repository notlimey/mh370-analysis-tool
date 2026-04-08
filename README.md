# MH370 Analysis Tool

> If you found this searching for MH370 analysis tools — you're in the right place. See the [disclaimer](#honest-disclaimer--read-this-first) before drawing any conclusions from the output.

An open-source tool for visualising and exploring the public data around the disappearance of Malaysia Airlines Flight MH370. Built with Tauri (Rust + TypeScript) and Mapbox GL.

**New here?** Start with [docs/START-HERE.md](docs/START-HERE.md) — a plain-language introduction to the case and the tool.

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
- The DSTG statistical framework (Davey et al. 2016)
- Holland 2017 BFO decomposition paper
- Published peer-reviewed papers cited throughout the codebase

**I have not independently verified any of the underlying science.** I have implemented what those sources describe, as faithfully as I could. If something is wrong it is most likely an implementation error on my part, not a flaw in the underlying research.

If you are a domain expert and see something wrong — please open an issue. That is the entire point of making this public.

---

## What the tool does

Takes all the public Inmarsat BTO/BFO satellite data, implements the physics models from published research, and lets you adjust every assumption to see how the conclusions change.

Specifically:

- **BTO arc rings** — converts burst timing offsets to distance rings from Inmarsat-3F1, with satellite drift correction from interpolated ephemeris
- **BFO Doppler model** — implements the full Holland/DSTG five-component Doppler decomposition (satellite motion, aircraft motion, satellite oscillator drift, aircraft oscillator bias, Earth rotation). Achieves ~4 Hz RMS residual on level-flight arcs.
- **Beam search path solver** — samples candidate flight paths through arcs 2-7, scoring by BTO consistency, BFO residual, fuel feasibility, and speed continuity
- **Path density heatmap** — shows where scored paths cluster along the 7th arc. This is beam search scoring output, not a Bayesian posterior.
- **End-of-flight scenarios** — models what happens after the final satellite contact, from spiral dive (~15 NM from arc) to controlled glide (~76 NM)
- **Debris drift simulation** — reverse drift using OSCAR surface currents + ERA5 monthly wind, testing whether candidate impact zones are consistent with where debris actually washed ashore
- **Sonar coverage overlay** — derived polygons showing the actual scanned seafloor, not just bounding boxes
- **BFO stepthrough panel** — shows all 5 Doppler components per arc for any selected path, making the math transparent

**Key design choice:** every assumption the official searches hardcoded is a configurable parameter here — cruise speed, satellite drift correction, fuel burn rate, BFO noise sigma, descent scenario. You can move the sliders and watch the probable endpoint shift. The goal is to make the sensitivity of the conclusions to their assumptions visually obvious.

### Layers

| Layer | Description |
|---|---|
| Known Flight Path | Confirmed radar track from takeoff to last radar contact at 18:22 UTC |
| Radar Track | Military primary radar returns across the Malay Peninsula and Malacca Strait |
| North Route | Northern corridor possibility (ruled out by BFO analysis) |
| BTO Arc Rings | Distance rings from Inmarsat-3F1 satellite at each handshake timestamp |
| Candidate Paths | Sampled flight paths that satisfy BTO/BFO constraints, coloured by path family |
| Best Path | Highest-scoring candidate path from the beam search |
| Path Density Heatmap | Scored path density distribution along the 7th arc |
| EOF Comparison | End-of-flight scenario overlay — spiral dive vs ghost flight vs active glide |
| Drift Clouds | ERA5 wind + OSCAR current particle simulation results |
| Sonar Coverage (derived) | Polygons extracted from WMS showing actual scanned vs unscanned territory |
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

| Parameter | Default | Source |
|---|---|---|
| Speed range | 375-500 kts | Physically reachable arc crossings |
| Satellite drift correction | On | Actual I3F1 orbital position from interpolated ephemeris |
| Fuel at arc 1 | ~27,800 kg | Post-MEKAR segment starting fuel |
| Fuel burn baseline | ~5,400 kg/hr | Scales with speed, no atmospheric correction |
| BFO bias | 150 Hz | Holland 2017 (Ashton 2014 used 152.5 Hz) |
| BFO noise sigma | 4.3 Hz | DSTG Table 5.1 (configurable; DSTG used 7 Hz for accident flight) |
| Descent scenario | Spiral dive | Spiral dive / ghost flight / active glide |
| Glide ratio | 15:1 | Conservative B777 unpowered |
| Post-arc-7 continuation | Scenario-dependent | How far the plane could have flown after the final ping |
| Debris drift latitude weighting | On | Soft weight toward debris-consistent latitudes |
| Path sampler density | 5000 | Number of candidate paths to generate |

---

## What the tool does not do

- Produce authoritative conclusions
- **Produce a Bayesian posterior** — the path density output is beam search scoring, not a formal probability distribution
- Account for wind and atmospheric effects on fuel burn
- **Model high-resolution ocean currents** — drift uses OSCAR at 1/3 degree with ERA5 monthly wind, not HYCOM
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

All data is public. Full attribution is in the source files. See [docs/DATA-GUIDE.md](docs/DATA-GUIDE.md) for the complete inventory.

| Dataset | Source | License |
|---|---|---|
| Inmarsat BTO/BFO handshake data | Malaysian government release, May 2014 | Public |
| BTO/BFO reference values | Inmarsat SU logs, cross-checked against Ashton et al. 2014 Table 6 and Holland 2017 Table III | Public |
| BFO model constants | DSTG Book (Davey et al. 2016), Holland 2017 | CC BY-NC 4.0 / Public |
| Satellite ephemeris (I3F1) | ATSB Definition of Underwater Search Areas, Table 3 | Public |
| Sonar coverage (WMS) | Geoscience Australia / ATSB | CC BY 4.0 |
| Sonar coverage polygons (derived) | Derived from Geoscience Australia WMS (AusSeabed) | CC BY 4.0 |
| Bathymetry | Geoscience Australia / ATSB | CC BY 4.0 |
| Magnetic anomaly (EMAG2v3) | NOAA National Centers for Environmental Information | Public domain |
| FIR boundaries | ICAO, manually encoded, frozen to 8 March 2014 | Public |
| ERA5 monthly wind | Copernicus Climate Data Store, Hersbach et al. 2020 | Copernicus License |
| OSCAR surface currents | NOAA/JPL PO.DAAC, Bonjean & Lagerloef 2002 | CC BY 4.0 |
| Debris locations | ATSB Operational Search Report 2017 | Public |
| Data holidays | ATSB 2022 Data Review Report | Public |
| Searched zone boundaries | ATSB / Geoscience Australia | CC BY 4.0 |
| Verified reference dataset | `knowledge/` — compiled and verified 2026-04-07 | CC BY 4.0 |

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
├── data.rs              # Inmarsat handshake records, verified reference values
├── geometry.rs          # Haversine, great-circle, arc math
├── arcs.rs              # BTO → distance rings with satellite drift correction
├── satellite.rs         # I3F1 ephemeris interpolation (cubic Hermite spline)
├── paths.rs             # Beam search path solver with BFO scoring
├── bfo.rs               # Holland/DSTG 5-component BFO decomposition
├── probability.rs       # Path density heatmap along 7th arc
├── drift.rs             # Debris reverse drift coordination
├── drift_transport.rs   # OSCAR + ERA5 particle transport
├── drift_beaching.rs    # Coastline intersection / beaching model
├── drift_scoring.rs     # Drift result scoring against actual debris finds
├── drift_validation.rs  # Drift validation framework
├── era5_wind.rs         # ERA5 monthly wind field loading
├── oscar.rs             # OSCAR surface current loading
├── debris_inversion.rs  # Joint debris origin inversion
├── sensitivity.rs       # Parameter sweep framework (BFO sigma, beam width, etc.)
├── performance.rs       # Fuel model and aircraft performance
├── config.rs            # AnalysisConfig definition
├── export.rs            # GeoJSON export for paths and probability
├── airspaces.rs         # FIR boundary data
├── anomalies.rs         # Anomaly/evidence markers
└── hycom_currents.rs    # HYCOM support (stub, not yet active)

src/layers/
├── arcs.ts              # BTO arc ring rendering
├── paths.ts             # Path family coloured rendering
├── best-path.ts         # Highest-scoring path highlight
├── heatmap.ts           # Path density heatmap
├── eof-comparison.ts    # End-of-flight scenario overlay
├── drift-clouds.ts      # Drift particle simulation results
├── sonar-coverage.ts    # Derived sonar coverage polygons
├── sonar.ts             # AusSeabed WMS sonar layers
├── magnetic.ts          # EMAG2 raster overlay
├── holidays.ts          # Data holiday polygons
├── priority.ts          # Priority gap derived layer
├── debris.ts            # Debris markers and drift lines
├── debris-inversion.ts  # Debris origin inversion results
├── flightpath.ts        # Known flight path
├── radar-track.ts       # Military radar track
├── north-route.ts       # Northern corridor (ruled out)
├── airspaces.ts         # 2014 FIR boundary layer
├── anomalies.ts         # Evidence/anomaly markers
├── points.ts            # Key reference points
└── pins.ts              # User-placed pins
```

---

## Built with AI assistance

This project was built with significant AI assistance (Claude by Anthropic). Approximately 95% of the codebase was LLM-generated. Four critical path calculations have been independently verified by hand against source equations: BTO arc geometry, BFO residual sign and magnitude, glide range arithmetic, and drift seed coordinates. The full codebase has not been independently reviewed — it is open-source for this reason.

The judgement calls — what to build, what assumptions to expose, what the tool should communicate — were mine.

---

## Verification status

Key results from the verification process (2026-04-07):

| Item | Status | Detail |
|---|---|---|
| AES compensation altitude | Verified | 36,210 km = 35,788 + 422 km (DSTG Book Ch.5) |
| BFO bias | Verified | 150 Hz (Holland 2017). Code and docs now consistent. |
| BFO noise sigma | Verified | 4.3 Hz (DSTG Table 5.1). DSTG used 7 Hz for accident flight. |
| Input BTO/BFO values | Verified | Cross-checked against 3 independent sources |
| 17:07 BFO residual | Resolved | Was -12.8 Hz with wrong position; +1.1 Hz with ACARS position |
| BFO sigma sensitivity | Resolved | 4.3 to 7.0 Hz shifts peak <0.3 deg; does not explain DSTG latitude gap |
| Sonar coverage at arc crossing | Under review | Arc crossing may fall within existing bathymetry coverage |
| OI 2025-2026 search extent | Approximate | Boundaries are from OI disclosures, not verified against scan data |

Full verification log: `knowledge/mh370_reference_data.xlsx`

---

## For researchers

If this tool is useful to you, or if you see errors in the implementation, please open an issue or PR. The codebase is documented with sources throughout.

**Verified reference data:** The `knowledge/` directory contains digitized and source-attributed datasets compiled for this project. Every BTO/BFO value, model constant, and satellite state vector has been cross-checked against primary sources (Inmarsat SU logs, Ashton et al. 2014, Holland 2017, DSTG Book). A verification log tracks what has been confirmed and what remains open. See [docs/DATA-GUIDE.md](docs/DATA-GUIDE.md) for the complete inventory.

The most valuable thing a domain expert could contribute is verifying whether these are implemented correctly:

- **BTO calibration** — empirical offset derived from pre-departure known-position pings (`src-tauri/src/mh370/arcs.rs`)
- **BFO Doppler model** — Holland/DSTG 5-component decomposition in `src-tauri/src/mh370/bfo.rs`
- **Satellite ephemeris handling** — cubic Hermite spline interpolation in `src-tauri/src/mh370/satellite.rs`
- **Fuel model** — linear burn rate scaled by speed, no atmospheric correction (`src-tauri/src/mh370/performance.rs`)
- **Drift model** — OSCAR + ERA5 particle transport in `src-tauri/src/mh370/drift_transport.rs`

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

MH370 · Malaysia Airlines Flight 370 · MH370 search · Inmarsat BTO BFO · 7th arc · southern Indian Ocean · MH370 flight path · satellite ping analysis · Geoscience Australia sonar · MH370 probability · underwater search · MH370 data visualization · MH370 open source · Independent Group MH370 · Inmarsat-3F1 · burst timing offset · burst frequency offset · MH370 arc rings · MH370 candidate paths · MH370 path families · BFO Doppler decomposition · Holland DSTG · debris drift analysis · OSCAR ERA5
