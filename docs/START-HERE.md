# Start Here — A Guide to MH370 and This Tool

This is for anyone who found this repository and wants to understand what they're looking at — no prior knowledge assumed.

---

## What happened to MH370?

On March 8, 2014, Malaysia Airlines Flight 370 — a Boeing 777-200ER carrying 239 people — departed Kuala Lumpur bound for Beijing. About 40 minutes into the flight, the aircraft's transponder stopped transmitting. Malaysian military radar tracked it turning west, crossing the Malay Peninsula, and flying northwest up the Malacca Strait. After that, radar lost contact.

But the plane didn't disappear entirely. An Inmarsat satellite — a communications relay orbiting 35,800 km above the Indian Ocean — kept exchanging automatic electronic "handshakes" with the aircraft's satellite data unit (SDU) for nearly six more hours. These handshakes weren't voice or data messages. They were the equivalent of a phone network pinging a device to see if it's still on. The plane answered each time.

Those handshakes are, essentially, all we have. No voice communication, no position reports, no radar returns. Just a series of timing and frequency measurements from a satellite link, recorded over six hours as the aircraft flew somewhere into the southern Indian Ocean.

---

## What do the satellite handshakes tell us?

Each handshake produced two measurements:

**BTO (Burst Timing Offset)** — how long the signal took to travel from the plane to the satellite and back. This tells us the distance between the aircraft and the satellite at that moment. Think of it like hearing an echo and counting seconds to know how far away the wall is. Since the satellite's position is known, this distance defines a ring on the Earth's surface. The plane was somewhere on that ring.

**BFO (Burst Frequency Offset)** — how much the signal's frequency was shifted by the Doppler effect. When you move toward a source of sound, the pitch rises; move away, it drops. The same happens with radio signals. The BFO tells us something about which direction the plane was moving relative to the satellite. Crucially, the BFO pattern confirmed the aircraft flew south into the Indian Ocean, not north.

Together, these measurements give us a series of arcs — one per handshake. The plane was somewhere on each arc at each timestamp. The 7th arc, from the final handshake at 00:19 UTC, is where the aircraft is believed to have ended its flight.

---

## What has been searched?

Three major underwater search campaigns have covered the southern Indian Ocean:

- **ATSB Phase 1 (2014-2015)** — Bathymetry survey mapping the seafloor terrain at 150m resolution, covering a wide area along the 7th arc
- **ATSB Phase 2 (2015-2017)** — High-resolution sonar search at 5m resolution using AUV, deep-tow, and synthetic aperture sonar. Focused between roughly 32S and 40S along the 7th arc. About 120,000 km2 of seafloor scanned.
- **Ocean Infinity (2018)** — Commercial search using autonomous underwater vehicles. Covered additional areas not reached by the ATSB search.
- **Ocean Infinity (2025-2026)** — New search campaign, boundaries approximate.

In total, roughly 200,000 km2 of seafloor has been scanned with sonar. Nothing has been found.

What *has* been found: 33 pieces of debris washed ashore on beaches in the western Indian Ocean, eastern Africa, and island nations like Reunion, Mauritius, Madagascar, and Mozambique. Several pieces were confirmed as coming from MH370. Their locations and timing provide additional constraints on where the aircraft entered the water.

---

## Why hasn't it been found?

Two main reasons:

**The ocean is enormous and the uncertainty is wide.** The 7th arc stretches thousands of kilometres. Even after applying speed constraints, fuel limits, and BFO analysis, the probable zone spans several degrees of latitude. At the ocean depths involved (3,000-5,000 metres), with rough volcanic terrain, a single aircraft is a tiny target.

**What happened after the final satellite contact matters enormously.** The last handshake at 00:19 UTC places the aircraft on the 7th arc. But where did it actually hit the water? If the engines flamed out and the plane entered an immediate spiral dive, it crashed within about 15 nautical miles of the arc. If it entered an unpowered glide — which a Boeing 777 can sustain for a significant distance — it could have travelled 76 nautical miles or more beyond the arc. That's a difference of over 100 km in a 4,000m-deep ocean with rough terrain. The search has to cover not just the arc but a wide band on either side, and the width of that band depends on an assumption about what the pilot did (or didn't do) in the final minutes.

---

## What does this tool do?

It takes all the public satellite data, implements the physics models from published research (BTO arc geometry, BFO Doppler decomposition, fuel burn, debris drift), and lets you adjust every assumption to see how the conclusions change.

You can:
- Adjust the aircraft speed and watch the arc rings and candidate paths change
- Toggle between "spiral dive," "ghost flight," and "active glide" to see how the impact zone shifts
- Turn on the sonar coverage layer to see exactly what has been scanned — not just bounding boxes, but the actual sonar scan footprints
- View the BFO breakdown for any candidate path — all five Doppler components, per arc
- Look at where debris washed ashore and whether drift simulations from candidate impact zones match
- Overlay the path density heatmap to see where the solver thinks the paths cluster

The goal is not to produce a single answer. It's to make the uncertainty — and the sensitivity of every conclusion to its assumptions — visually obvious.

---

## How to explore

- **Desktop app** (full solver access): Clone the repo and run with `pnpm install && pnpm tauri dev`. Requires Node.js, Rust, and a free Mapbox token. See [the README](../README.md) for setup.
- **Just want the data?** See [DATA-GUIDE.md](DATA-GUIDE.md) for a complete inventory of every data file, its source, and how to use it in your own work.

---

## What you can do

- Drag speed sliders and watch the arcs change
- Toggle between descent scenarios to see how the impact zone shifts
- Turn on the sonar coverage layer to see what's actually been scanned
- Switch on the drift clouds to see particle drift simulations from candidate impact points
- Look at where debris washed ashore and compare with drift model predictions
- Open the BFO panel to see the five-component Doppler breakdown for any path
- If you're a researcher: download the verified data files and run your own analysis

---

## A note on respect

239 people were on that plane. This tool exists because the case remains unsolved and public data can contribute to finding the answer. It is not entertainment.
