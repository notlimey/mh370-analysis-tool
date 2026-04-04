---
name: project_state
description: Codebase state after first full review pass — known bugs, confirmed-correct implementations, and architectural notes
type: project
---

## First full review completed: 2026-04-04

### Architecture
- Rust backend (src-tauri/src/mh370/): arcs, satellite, bfo, paths, probability, data, drift, anomalies, geometry, export, airspaces
- TypeScript frontend (src/): layers, model/config, constants, model/evidence, model/airspaces
- Dataset loaded from a user-configured JSON file at runtime

### Known bugs found in review

**CRITICAL**
- `bfo.rs` line 61: `BFO_GROUND = 142.0` is labeled as the "16:00 UTC ground" calibration value, but the 16:00:13 logon handshake has BFO=88.0. The 142.0 value belongs to the 16:42:04 takeoff ack. The calibration point at time_s=0 uses the wrong BFO constant. This will bias all BFO predictions. (BFO scoring not yet used as a weight — see AGENTS.md — so no arc position impact yet, but will matter when BFO scoring is activated.)

**MAJOR**
- `bfo.rs` lines 201-202: The 16:41 calibration point (BFO=175, time_s=2460) does not correspond to a real Inmarsat handshake. It is an unattributed estimate. Should be documented as such or replaced with a real data point.
- `satellite.rs`/`data.rs`: The config field `satellite_drift_end_lat_offset_deg` is named as if it is the satellite latitude at arc 7 end time, but `sat_position_approx()` uses `abs(value)` as the PEAK AMPLITUDE of the sinusoidal oscillation. The name is misleading. At arc7 (~24.32 hours in the extended UTC scale), the model actually places the satellite at ~+0.49 degrees, not -1.6 as the field name implies.
- `bfo.rs` vs `satellite.rs`: Two independent satellite position models that produce different results. `bfo.rs` uses a fixed inclination-based model (SAT_INCLINATION_DEG=1.65); `satellite.rs` uses a sinusoidal approximation with amplitude from config. Neither is yet the real ATSB Table 3 ephemeris.
- `src/constants.ts` SEARCHED_2014_2017: Northern latitude extent is -20S. Correct value is ~-33S (ATSB Phase 2 searched 39.4S to 33S). The polygon as drawn is 13 degrees too wide, greatly overstating searched coverage.
- `src/constants.ts` SEARCHED_2018: Northern extent is -28S. Correct value is ~-24.7S (OI 2018 searched 36S to 24.7S). 3.3 degrees too narrow.
- `src-tauri/src/mh370/data.rs` line 5 and `src/model/config.ts` line 36: Default dataset path is `/Users/entropy/Downloads/mh370_data.json` — hardcoded absolute path will fail on any other machine.
- `src-tauri/src/mh370/airspaces.rs` line 4: Airspaces GeoJSON path is `/Users/entropy/Documents/repos/personal/mh370/src/data/airspaces_2014.geojson` — hardcoded absolute path.

**MINOR**
- `bfo.rs` `score_7th_arc_point()`: Heading scan goes 150..249 (0..100 range exclusive). Misses 250 degrees exactly. Comment says "150–250°".
- `drift.rs` `approx_days_since_2014_03_08()`: Uses 30-day months; ~2-3 day error per item, ~34-51 km reverse-drift position error. Acceptable for visualization but should be documented.
- `anomalies.rs` `cocos_island_seismometer`: Correctly discusses the public seismometer signal but does not mention that the infrasound array data from the same station is withheld (restricted CTBTO data). The airspaces GeoJSON cocos_keeling_sector note does correctly distinguish these. The two are not conflated, but the anomaly detail is incomplete.
- `src/layers/flightpath.ts`: `SDU reboot (Arc 1)` probable waypoint at [96.5, 6.3] is approximately 130 km west of the last radar contact (97.7E, 6.8N). At realistic speeds that's physically feasible in 3 minutes only at ~1500+ kts. Plausible as an illustrative point but should note it is illustrative, not calculated.

### Confirmed correct
- BTO formula: `(bto - offset) * 1e-6 * c / 2` — correct round-trip to one-way conversion
- BTO offset calibration: empirically derived from known-position pre-departure pings, not hardcoded to 495,679
- Slant range to surface distance: correct law-of-cosines implementation
- Handshake filtering: 18:25:34 CRITICAL_ANOMALY correctly excluded; 18:25:27 UNRELIABLE_BFO included for BTO only
- 00:19:37 null-BTO partial excluded from arc calculations (filtered by bto_us.is_some())
- Speed constraint: 350-520 kts enforced between consecutive arcs
- Great-circle distance used (haversine), not Euclidean
- Path starts from LAST_RADAR: 6.8N, 97.7E — correct per spec
- Fuel model starts from arc1 (33,500 kg) — correct per spec
- Fuel speed scaling: power-law with exponent 1.35 — reasonable
- Coordinate order: [lon, lat] GeoJSON order maintained throughout Rust and TypeScript pipeline
- Anomaly coordinates: Java (8.36S, 107.92E), MODIS (39.47S, 90.45E), Cocos Keeling (-12.188S, 96.829E) all correct
- Debris barnacle data: flaperon temp=27°C correct, withheld largest specimens documented
- FIR detection statuses: WMFC=TRACKED, VTBB=TRACKED NOT REPORTED, WIIF=UNKNOWN, VVTS=PARTIAL — all correct
- Diego Garcia: labeled "OFFICIALLY NO DETECTION — but sensor capabilities make this contested" — correct per spec
- Satellite peak northerly: 19.5 hours from epoch = 19:30 UTC — correct
- Satellite equatorial crossing: 25.5 hours from epoch = 01:30 UTC — correct
- KLIA coordinates: 2.75N, 101.71E — correct within tolerance
- IGARI waypoint: 103.59E, 6.93N — correct within tolerance
- Ephemeris interpolation: linear (lerp) between ECEF points — correct (not nearest-neighbor)

**Why:** First full codebase review on 2026-04-04. BFO module is not yet wired into path scoring weights (per AGENTS.md), so the BFO_GROUND error has no current impact on arc positions — but will matter when BFO scoring is activated.
