import type { Chapter } from "../stores/report";

/**
 * Interactive report chapters.
 *
 * Layer groups available for chapter mapState.layers:
 *   arcs            — BTO arc rings (white dashed, labeled with arc # + UTC time)
 *   paths           — 120 solver candidate paths, colored by family (orange/blue/purple/gray)
 *   best-path       — Top-scoring path (bold white + glow) with red Arc 7 crossing marker
 *   heatmap         — Probability density heatmap along Arc 7
 *   flightpath      — Known flight path waypoints (yellow confirmed / orange military / pink probable)
 *   radar-track     — Animated version of known flight path (Ch 0 intro only)
 *   north-route     — Northern arc halves + ghost path (red, faded — "ruled out by BFO")
 *   points          — Key reference markers (KLIA, Last Radar, Inmarsat-3F1 satellite)
 *   searched        — Searched area polygons (red ATSB / orange OI 2018 / purple OI 2025)
 *   debris          — Debris find locations (green markers) + drift lines (green dashed)
 *   airspaces       — FIR boundaries and airspace sectors
 *   drift-clouds    — Drift simulation particle clouds (Tauri desktop only)
 *   eof-compare     — End-of-flight scenario comparison (Tauri desktop only)
 *
 * Coordinates as [lon, lat] per Mapbox convention.
 */

export const CHAPTERS: Chapter[] = [
  // ── Chapter 0: What Happened ─────────────────────────────────────────────
  {
    id: "what-happened",
    title: "What Happened to MH370?",
    subtitle: "March 8, 2014",
    content: [
      "At 12:41 AM local time, Malaysia Airlines Flight 370 departed Kuala Lumpur International Airport bound for Beijing. On board were 227 passengers and 12 crew members.",
      "Thirty-nine minutes after takeoff, approaching the handoff between Malaysian and Vietnamese air traffic control, the aircraft's transponder stopped transmitting. The plane vanished from civilian radar.",
      "Malaysian military radar continued tracking an unidentified aircraft as it turned back across the Malay Peninsula, flew northwest past Penang, and disappeared beyond radar range over the Andaman Sea at 18:22 UTC. Then silence — for over an hour — until a satellite began receiving faint electronic handshakes from somewhere in the vast Indian Ocean.",
    ],
    mapState: {
      center: [101.71, 2.75],
      zoom: 7,
      pitch: 0,
      bearing: 0,
      layers: ["radar-track", "points"],
      animation: "fly_to",
      duration: 2000,
    },
    steps: [
      {
        // Zoom out to show the turn-back
        mapState: {
          center: [100.5, 5.0],
          zoom: 5.5,
          layers: ["radar-track", "points"],
          animation: "ease_to",
          duration: 4000,
        },
        delay: 5000,
      },
      {
        // Show full known flight path with airspace boundaries —
        // you can see it crossing Malaysian, Vietnamese, Thai control
        mapState: {
          center: [98, 4],
          zoom: 5,
          layers: ["radar-track", "flightpath", "airspaces", "points"],
          animation: "ease_to",
          duration: 3000,
        },
        delay: 3000,
      },
    ],
    interactives: ["radar-track-animation"],
  },

  // ── Chapter 1: The Satellite Handshakes ──────────────────────────────────
  {
    id: "satellite-handshakes",
    title: "The Satellite Handshakes",
    subtitle: "The only evidence",
    content: [
      "After the plane disappeared from radar, one link remained: a telecommunications satellite called Inmarsat-3F1, stationed 35,800 km above the Indian Ocean. Its ground position is the purple marker on the map at 64.5°E.",
      "Every hour or so, the satellite and the aircraft's communications unit exchanged electronic \"handshakes.\" The time delay tells us how far the aircraft was from the satellite at each ping. Each measurement defines a ring of possible positions — an arc — on the Earth's surface.",
      "You can see all seven arcs drawn across the Indian Ocean, each labeled with its UTC timestamp. The known flight path shows where the plane was last tracked. Somewhere on the final arc, the plane ran out of fuel.",
    ],
    mapState: {
      center: [82, -8],
      zoom: 3.8,
      pitch: 0,
      bearing: 0,
      layers: ["flightpath", "arcs", "points"],
      animation: "fly_to",
      duration: 3000,
    },
  },

  // ── Chapter 2: North or South? ───────────────────────────────────────────
  {
    id: "north-or-south",
    title: "North or South?",
    subtitle: "The BFO evidence",
    content: [
      "Each BTO arc is symmetric — the plane could have been equally far north or south of the satellite. The faded red arcs and dashed line in the northern hemisphere show what a northbound route would look like — crossing Central Asia toward China. The white arcs in the south show the alternative: deep into the Indian Ocean.",
      "The frequency shift of each handshake — the Burst Frequency Offset, or BFO — breaks the symmetry. When an aircraft moves toward or away from a satellite, the signal frequency shifts like a siren changing pitch as it passes. The measured BFO values are only consistent with sustained southward flight.",
      'The northern route is labeled "ruled out by BFO" on the map. This single piece of evidence eliminates the entire northern hemisphere. Flight 370 turned south and flew for six more hours until its fuel ran out.',
    ],
    mapState: {
      center: [75, 5],
      zoom: 3,
      pitch: 0,
      bearing: 0,
      layers: ["flightpath", "arcs", "north-route", "airspaces", "points"],
      animation: "fly_to",
      duration: 3000,
    },
  },

  // ── Chapter 3: Finding the Path ──────────────────────────────────────────
  {
    id: "finding-the-path",
    title: "Finding the Path",
    subtitle: "Thousands of possibilities",
    content: [
      "Knowing the plane flew south is not enough — the arcs span thousands of kilometers. To narrow the crash site, we need to find which paths through all seven arcs are consistent with the satellite data.",
      "Our solver tests thousands of candidate routes, varying speed and heading at each arc crossing. Each candidate is scored against the BFO measurements. Paths with large BFO residuals are discarded. The colored lines on the map are the surviving candidates — watch as they converge toward the 7th arc.",
      "The bold white line is the model's best-fit path — the trajectory most consistent with all satellite measurements. The red marker at its end shows where this path crosses the 7th arc — the last known position constraint, not the crash site itself.",
    ],
    mapState: {
      center: [88, -15],
      zoom: 3.5,
      pitch: 0,
      bearing: 0,
      layers: ["arcs", "paths", "best-path", "points"],
      animation: "fly_to",
      duration: 3000,
    },
    steps: [
      {
        // Zoom to where all paths converge at Arc 7
        mapState: {
          center: [92, -33],
          zoom: 5.5,
          layers: ["arcs", "paths", "best-path", "points"],
          animation: "ease_to",
          duration: 3500,
        },
        delay: 4000,
      },
    ],
  },

  // ── Chapter 4: The 7th Arc ───────────────────────────────────────────────
  {
    id: "seventh-arc",
    title: "The 7th Arc",
    subtitle: "The final signal",
    content: [
      "At 00:19 UTC on March 8, the aircraft's satellite data unit sent two final transmissions — a pattern consistent with engines flaming out from fuel exhaustion. This is the 7th arc: the last known position constraint.",
      "The heatmap glowing along the arc is our probability model — combining all surviving paths, weighted by BFO consistency, fuel feasibility, and speed plausibility. Brighter means higher probability. The red marker shows where the best-fit path crosses the arc — the aircraft's last satellite contact before fuel ran out.",
      "Now watch as the searched area boundaries appear. The red, orange, and purple rectangles show the three major underwater searches. Notice where the probability peak falls — west of every searched area.",
    ],
    mapState: {
      center: [93, -34],
      zoom: 6,
      pitch: 0,
      bearing: 0,
      layers: ["arcs", "heatmap", "best-path", "points"],
      animation: "fly_to",
      duration: 3000,
    },
    steps: [
      {
        // Reveal searched areas
        mapState: {
          center: [93, -34],
          zoom: 6,
          layers: ["arcs", "heatmap", "best-path", "searched", "points"],
          animation: "ease_to",
          duration: 500,
        },
        delay: 5000,
      },
    ],
  },

  // ── Chapter 5: Two Scenarios ─────────────────────────────────────────────
  {
    id: "end-of-flight",
    title: "What Happened Next?",
    subtitle: "Two scenarios",
    content: [
      "When the fuel ran out, the aircraft crossed the 7th arc at the red marker — approximately 34.8°S, 92.2°E. But the arc crossing is not the crash site. What happened in the next few minutes determines the actual impact point, and whether it has already been searched.",
      "In a spiral dive, the aircraft enters an uncontrolled descent almost immediately — impacting the ocean within about 15 nautical miles of the arc crossing. That puts it near the eastern edge of the heatmap, close to the red ATSB search zone. Some of this area has been scanned.",
      'In an unpowered glide, the aircraft could travel up to 100 nautical miles beyond the arc, shifting the impact zone westward — away from all searched areas. The difference is the difference between "already looked there" and "never looked there."',
    ],
    mapState: {
      center: [92, -35],
      zoom: 6.5,
      pitch: 0,
      bearing: 0,
      layers: ["arcs", "heatmap", "searched", "best-path", "paths", "points"],
      animation: "fly_to",
      duration: 2500,
    },
  },

  // ── Chapter 6: The Debris ────────────────────────────────────────────────
  {
    id: "debris-drift",
    title: "Where Did the Debris Drift?",
    subtitle: "508 days to Reunion",
    content: [
      "On July 29, 2015 — 508 days after the disappearance — a piece of aircraft wing washed ashore on Réunion Island, 4,000 km west of the search area. It was confirmed as MH370's right flaperon. You're looking at the find location now.",
      "Over the following years, more than 30 pieces of debris were recovered across the western Indian Ocean. The green markers show where each piece was found — from Mozambique to Madagascar to South Africa. The green dashed lines trace estimated drift paths back toward the eastern Indian Ocean.",
      "Each recovery constrains the possible origin: ocean currents had to carry the debris from the crash site to the find location in the observed timeframe. Watch as the map pulls back to reveal the connection between the debris trail and the probability heatmap in the east.",
    ],
    mapState: {
      // Start zoomed on Réunion — the first and most important find
      center: [55.5, -21],
      zoom: 8,
      pitch: 0,
      bearing: 0,
      layers: ["debris", "points"],
      animation: "fly_to",
      duration: 3000,
    },
    steps: [
      {
        // Pull back to show all debris finds across the western Indian Ocean
        mapState: {
          center: [45, -18],
          zoom: 4,
          layers: ["debris", "points"],
          animation: "ease_to",
          duration: 3000,
        },
        delay: 4000,
      },
      {
        // Full pullback: debris + heatmap + best path — the two lines of evidence converge
        mapState: {
          center: [72, -25],
          zoom: 3,
          layers: ["arcs", "debris", "heatmap", "best-path", "points"],
          animation: "ease_to",
          duration: 3000,
        },
        delay: 4000,
      },
    ],
  },

  // ── Chapter 7: What's Been Searched ──────────────────────────────────────
  {
    id: "searched-areas",
    title: "What's Been Searched",
    subtitle: "Over 230,000 km\u00B2 of seafloor",
    content: [
      "Three major underwater searches have covered more than 230,000 square kilometers of the Indian Ocean seafloor — an area larger than the United Kingdom.",
      "The red zone is the ATSB-led search (2014\u20132017): 120,000 km\u00B2 between 33°S and 39.4°S. The orange zone is Ocean Infinity's 2018 search: 112,000 km\u00B2 further north. The purple zone is the most recent Ocean Infinity campaign (2025\u20132026). All three focused east of 93°E.",
      "Now watch as the probability heatmap and the model's best-fit path appear. The red marker — the Arc 7 crossing — sits in a gap west of every searched boundary. The actual crash site lies somewhere between this crossing and up to 100 NM further west (if the aircraft glided). A focused search of approximately 10,000 km\u00B2 around 91\u201392°E at 34\u201336°S could cover this zone.",
    ],
    mapState: {
      center: [95, -32],
      zoom: 4.5,
      pitch: 0,
      bearing: 0,
      layers: ["arcs", "searched", "points"],
      animation: "fly_to",
      duration: 3000,
    },
    steps: [
      {
        // Add heatmap + best path to show the gap
        mapState: {
          center: [93, -34.5],
          zoom: 6,
          layers: ["arcs", "heatmap", "searched", "best-path", "points"],
          animation: "ease_to",
          duration: 3000,
        },
        delay: 4000,
      },
    ],
  },

  // ── Chapter 8: Open Questions ────────────────────────────────────────────
  {
    id: "open-questions",
    title: "Open Questions",
    subtitle: "What we still don't know",
    content: [
      "This analysis is not a claim to have solved MH370. The map shows the model's best-fit path with the red Arc 7 crossing marker, the probability heatmap, and the search boundaries. The crash site lies somewhere between the crossing point and up to 100 NM further west. Several important tensions remain.",
      "Barnacle growth analysis on the recovered flaperon suggests a crash latitude further north, around 28\u201333°S. Our model places it around 35°S. The end-of-flight scenario — spiral dive versus controlled glide — changes the crash longitude by over 100 km. Without cockpit voice recorder data, we cannot determine which occurred.",
      "What we can say: the satellite evidence, debris drift, and path modeling all converge on a region of the southern Indian Ocean that has not been fully searched. Watch as the map pulls back to show every piece of evidence together. The data is open. The tools are open. The question remains: where is MH370?",
    ],
    mapState: {
      // Start zoomed on the model's answer
      center: [92, -34.8],
      zoom: 6.5,
      pitch: 0,
      bearing: 0,
      layers: ["arcs", "heatmap", "best-path", "searched", "points"],
      animation: "fly_to",
      duration: 3000,
    },
    steps: [
      {
        // Full pullback: everything on the map
        mapState: {
          center: [82, -20],
          zoom: 3.5,
          layers: [
            "arcs",
            "paths",
            "heatmap",
            "searched",
            "debris",
            "best-path",
            "flightpath",
            "points",
            "radar-track",
          ],
          animation: "ease_to",
          duration: 4000,
        },
        delay: 5000,
      },
    ],
  },
];

export function getChapter(index: number): Chapter | undefined {
  return CHAPTERS[index];
}

export function getChapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}
