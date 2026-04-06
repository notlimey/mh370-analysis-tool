import type { AnalysisConfig } from "./config";

export interface ScenarioPreset {
  id: string;
  name: string;
  shortDescription: string;
  narrative: string;
  configOverrides: Partial<AnalysisConfig>;
  layerVisibility: Record<string, boolean>;
  viewport: {
    center: [number, number];
    zoom: number;
  };
  relevantAnomalyIds: string[];
}

export const SCENARIOS: ScenarioPreset[] = [
  {
    id: "atsb_baseline",
    name: "ATSB Baseline",
    shortDescription: "Official search assumptions — 471 kts cruise, uncontrolled descent, narrow band around ~38\u00B0S.",
    narrative: `This scenario reproduces the assumptions used by the ATSB and DSTG in defining the primary underwater search area (2014\u20132017). The aircraft is assumed to have flown a roughly constant heading at cruise speed after the last radar contact, with fuel exhaustion leading to an uncontrolled descent near the 7th arc.

The ATSB search covered ~120,000 km\u00B2 along the 7th arc between 33\u00B0S and 39.4\u00B0S without locating the wreckage. This scenario is useful as a reference point — if the baseline assumptions were correct, the aircraft should have been found.

Key question: what assumptions would need to change to move the endpoint outside the searched zone?`,
    configOverrides: {
      min_speed_kts: 400,
      max_speed_kts: 500,
      fuel_remaining_at_arc1_kg: 33500,
      fuel_baseline_kg_per_hr: 6500,
      max_post_arc7_minutes: 15,
      debris_weight_min_lat: -40,
      debris_weight_max_lat: -32,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: false,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: false,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95.5, -36],
      zoom: 5,
    },
    relevantAnomalyIds: [],
  },
  {
    id: "eof_spiral_dive",
    name: "EOF Spiral / Dive",
    shortDescription: "High Arc 7 descent rate with near-immediate impact after fuel exhaustion.",
    narrative: `This scenario applies the end-of-flight spiral/dive assumptions from the new planning notes. The aircraft stays in normal cruise before Arc 7, then enters a steep descent at the final handshake, consistent with Holland's interpretation of the late BFO jump.

Model changes in this preset:
• Arc 7 vertical speed: 8,000 fpm
• Post-Arc-7 continuation: 0 minutes
• Expected behavior: impact remains very close to the 7th arc, favouring a tight high-energy endpoint cluster.`,
    configOverrides: {
      arc7_vertical_speed_fpm: 8000,
      max_post_arc7_minutes: 0,
      post_arc7_low_speed_kts: 250,
      debris_weight_min_lat: -38,
      debris_weight_max_lat: -32,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: false,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: false,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95.5, -35.5],
      zoom: 5,
    },
    relevantAnomalyIds: [],
  },
  {
    id: "eof_ghost_flight",
    name: "EOF Ghost Flight",
    shortDescription: "Modest Arc 7 descent with a short unpowered continuation beyond the 7th arc.",
    narrative: `This scenario keeps the pre-Arc-7 path close to a conventional autopilot cruise, then applies a smaller descent rate at Arc 7 and a limited continuation after fuel exhaustion.

Model changes in this preset:
• Arc 7 vertical speed: 2,000 fpm
• Post-Arc-7 continuation: 12 minutes at 300 kts
• Expected behavior: a moderate southward shift beyond the 7th arc without requiring a long controlled ditching glide.`,
    configOverrides: {
      arc7_vertical_speed_fpm: 2000,
      max_post_arc7_minutes: 12,
      post_arc7_low_speed_kts: 300,
      debris_weight_min_lat: -38,
      debris_weight_max_lat: -31,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: true,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: true,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95, -34.5],
      zoom: 5,
    },
    relevantAnomalyIds: ["barnacle_large_specimens"],
  },
  {
    id: "eof_active_glide",
    name: "EOF Active Glide",
    shortDescription: "Gentler Arc 7 descent with an extended post-fuel glide / ditching attempt.",
    narrative: `This scenario represents the controlled end-of-flight case from the new notes. The aircraft begins a relatively gentle descent at Arc 7, then continues well beyond the 7th arc at a lower speed.

Model changes in this preset:
• Arc 7 vertical speed: 1,500 fpm
• Post-Arc-7 continuation: 45 minutes at 250 kts
• Expected behavior: the impact zone shifts furthest beyond the 7th arc and becomes the strongest test of a pilot-controlled ditching hypothesis.`,
    configOverrides: {
      arc7_vertical_speed_fpm: 1500,
      max_post_arc7_minutes: 45,
      post_arc7_low_speed_kts: 250,
      debris_weight_min_lat: -38,
      debris_weight_max_lat: -30,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: true,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: true,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95, -33.5],
      zoom: 4.8,
    },
    relevantAnomalyIds: ["barnacle_large_specimens"],
  },
  {
    id: "controlled_ditching",
    name: "Controlled Ditching",
    shortDescription: "Extended glide after fuel exhaustion, lower-energy impact, wider debris scatter.",
    narrative: `This scenario explores the possibility that the aircraft was under control at the end of flight. After fuel exhaustion, a skilled pilot could glide a 777 for 100+ nautical miles, placing the wreckage significantly further from the 7th arc than the ATSB assumed.

The debris found so far — flaperon, flap sections, interior panels — shows damage patterns that some analysts argue are more consistent with a lower-energy water entry than a high-speed spiral dive. A ditching would:
\u2022 Scatter debris over a wider area (consistent with finds across the Indian Ocean)
\u2022 Sink the main fuselage more intact (harder to detect on sonar)
\u2022 Produce a weaker acoustic/seismic signature

This scenario maximises post-arc-7 continuation time and widens the speed range to include slower final approach speeds.`,
    configOverrides: {
      min_speed_kts: 350,
      max_speed_kts: 480,
      fuel_remaining_at_arc1_kg: 33500,
      fuel_baseline_kg_per_hr: 6500,
      max_post_arc7_minutes: 57,
      debris_weight_min_lat: -38,
      debris_weight_max_lat: -30,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: true,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: true,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95, -34],
      zoom: 5,
    },
    relevantAnomalyIds: ["barnacle_large_specimens"],
  },
  {
    id: "loiter_hold",
    name: "Loiter / Hold at Arc 6",
    shortDescription: "Aircraft slowed or circled before arc 7, explaining the identical BTO values.",
    narrative: `Arcs 6 and 7 both show a BTO of 18,400 \u00B5s despite being 8.5 minutes apart. At cruise speed the aircraft should have moved ~67 NM, producing a measurably different BTO. This scenario assumes the aircraft slowed dramatically or entered a holding pattern between those two pings.

If the aircraft was nearly stationary relative to the satellite, the impact point would be very close to the 7th arc itself — inside or just outside the primary search area, but potentially in a data holiday (gap in sonar coverage).

This is the "slow" family in the path classifier. The scenario drops the speed range to emphasise paths that produce near-zero radial movement between arcs 6 and 7, and enables the priority gap layer to show where slow-family endpoints overlap with unsearched zones.`,
    configOverrides: {
      min_speed_kts: 350,
      max_speed_kts: 420,
      fuel_remaining_at_arc1_kg: 33500,
      fuel_baseline_kg_per_hr: 6500,
      max_post_arc7_minutes: 10,
      slow_family_max_speed_kts: 420,
      debris_weight_min_lat: -38,
      debris_weight_max_lat: -32,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: true,
      holidays: true,
      priority: true,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: false,
      points: true,
      searched: true,
    },
    viewport: {
      center: [95, -35],
      zoom: 5.5,
    },
    relevantAnomalyIds: [],
  },
  {
    id: "hydroacoustic",
    name: "Hydroacoustic Signal",
    shortDescription: "Explores locations consistent with CTBTO underwater sound detections.",
    narrative: `Multiple CTBTO hydroacoustic stations recorded anomalous signals around the time of disappearance. The most discussed are detections at Cape Leeuwin (Australia) and Diego Garcia. These were largely dismissed because the energy didn't match expectations for a high-speed ocean impact — but that dismissal assumed a nosedive.

A controlled ditching or low-energy fuel-exhaustion entry would produce a much quieter acoustic signature, potentially consistent with the detected levels.

This scenario enables the anomaly layer and highlights the hydroacoustic detections. The config is left close to baseline — the value here is in overlaying the acoustic bearing lines against the probability heatmap to see if there's a plausible intersection.

The Java Anomaly is an uncatalogued hydroacoustic event near the 7th arc that has never been fully investigated.`,
    configOverrides: {
      min_speed_kts: 350,
      max_speed_kts: 500,
      fuel_remaining_at_arc1_kg: 33500,
      fuel_baseline_kg_per_hr: 6500,
      max_post_arc7_minutes: 30,
      debris_weight_min_lat: -40,
      debris_weight_max_lat: -28,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: true,
      airspaces: false,
      magnetic: false,
      sonar: false,
      holidays: false,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: false,
      points: true,
      searched: true,
    },
    viewport: {
      center: [92, -30],
      zoom: 4.5,
    },
    relevantAnomalyIds: ["java_anomaly", "cocos_island_seismometer"],
  },
  {
    id: "debris_weighted",
    name: "Debris-Weighted",
    shortDescription: "Lets debris drift evidence dominate over BTO-only analysis.",
    narrative: `43 pieces of confirmed and suspected MH370 debris have been found across the Indian Ocean — from R\u00E9union to Mozambique to South Africa. Reverse-drift modelling of these finds constrains the origin latitude independently of the satellite data.

This scenario narrows the debris latitude weighting window and enables both the debris layer and the heatmap, so you can see how the debris-derived origin compares to the satellite-derived probability peak.

The barnacle evidence is particularly interesting here: growth rings on the flaperon encode the water temperature history of the debris during its drift, potentially constraining not just where it started but what path it took. The largest barnacle specimens were withheld from the official French analysis — their age estimates could shift the drift timeline.

Watch for the gap between the satellite peak and debris peak — that tension is one of the most informative signals in the data.`,
    configOverrides: {
      min_speed_kts: 350,
      max_speed_kts: 520,
      fuel_remaining_at_arc1_kg: 33500,
      fuel_baseline_kg_per_hr: 6500,
      max_post_arc7_minutes: 30,
      debris_weight_min_lat: -36,
      debris_weight_max_lat: -30,
    },
    layerVisibility: {
      flightpath: true,
      anomalies: true,
      airspaces: false,
      magnetic: false,
      sonar: false,
      holidays: false,
      priority: false,
      arcs: true,
      paths: true,
      heatmap: true,
      debris: true,
      points: true,
      searched: true,
    },
    viewport: {
      center: [80, -25],
      zoom: 4,
    },
    relevantAnomalyIds: ["barnacle_large_specimens", "thermal_plume_aqua_modis"],
  },
  {
    id: "drift_analysis",
    name: "Drift Analysis",
    shortDescription: "Focused view on debris drift modelling \u2014 particle clouds, find locations, and reverse-drift corridors.",
    narrative: `This view strips away the satellite/BTO layers and focuses entirely on what the debris tells us.

The Monte Carlo drift model runs particle ensembles from candidate origin points along the 7th arc, simulating ocean currents and wind-driven leeway with randomised perturbations. Each particle cloud shows the probability envelope of where debris from that origin would end up after N days adrift.

What to look for:
\u2022 Do the particle clouds actually reach the debris find locations?
\u2022 Which origin latitudes produce clouds that best explain the full debris field (R\u00E9union, Mozambique, South Africa, Madagascar)?
\u2022 How sensitive is the result to the leeway coefficient \u2014 lightweight interior panels vs the heavy flaperon?

The inversion panel (bottom of sidebar) combines all debris items into a joint likelihood across origin points. Run it to see where the debris evidence alone points, independent of the satellite data.`,
    configOverrides: {
      min_speed_kts: 350,
      max_speed_kts: 520,
      max_post_arc7_minutes: 30,
      debris_weight_min_lat: -40,
      debris_weight_max_lat: -25,
    },
    layerVisibility: {
      flightpath: false,
      anomalies: false,
      airspaces: false,
      magnetic: false,
      sonar: false,
      holidays: false,
      priority: false,
      arcs: false,
      paths: false,
      heatmap: false,
      debris: true,
      points: false,
      searched: false,
      "drift-clouds": true,
    },
    viewport: {
      center: [70, -25],
      zoom: 3.5,
    },
    relevantAnomalyIds: ["barnacle_large_specimens"],
  },
];

export function getScenarioById(id: string): ScenarioPreset | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
