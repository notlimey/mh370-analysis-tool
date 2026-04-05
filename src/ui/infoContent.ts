export interface InfoSection {
  heading: string;
  body: string;
}

export interface InfoContent {
  title: string;
  subtitle: string;
  summary: string;
  sections: InfoSection[];
}

export const INFO_CONTENT: Record<string, InfoContent> = {
  "section:layers": {
    title: "Layers",
    subtitle: "Map overlays and interpretation aids",
    summary: "These toggles control what is drawn on the map. The analytical layers are best read in combinations, not all at once.",
    sections: [
      { heading: "How to use", body: "Start with Probability Heatmap, Priority Gaps, and Searched Areas. Then add Candidate Paths or BTO Arc Rings only when you want to understand why a zone appears." },
      { heading: "What changes visually", body: "Each layer group can add fills, outlines, labels, or markers. Dense combinations can obscure the main search picture, which is why the focus presets exist." },
    ],
  },
  "layer:flightpath": {
    title: "Known Flight Path",
    subtitle: "Radar-confirmed and inferred aircraft track",
    summary: "Shows the accepted early route from departure through the last radar observations, plus inferred continuation where the public record becomes uncertain.",
    sections: [
      { heading: "What it means", body: "This is the historical baseline, not the final search solution. It explains where the aircraft was known to be before Inmarsat-only reasoning takes over." },
      { heading: "Why it matters", body: "Use it to understand the transition from radar evidence to BTO/BFO-based search geometry." },
    ],
  },
  "layer:anomalies": {
    title: "Anomaly Markers",
    subtitle: "Unresolved clues and contradictions",
    summary: "Shows evidence leads that are interesting because they support, contradict, or complicate the current search narrative.",
    sections: [
      { heading: "What it shows", body: "Hydroacoustic events, satellite interpretations, drift clues, and signal-processing anomalies." },
      { heading: "How to read it", body: "Click a marker to open the right panel and inspect the claim, confidence, conflicts, and search implications." },
    ],
  },
  "layer:airspaces": {
    title: "2014 Airspaces",
    subtitle: "Historic FIR boundaries",
    summary: "Shows the flight information regions that existed on 8 March 2014, useful for understanding route behavior and possible navigation intent.",
    sections: [
      { heading: "Why it matters", body: "Some candidate routes interact with FIR edges in ways that can look deliberate rather than random." },
      { heading: "What it does not do", body: "It does not prove intent by itself; it is a context layer for route interpretation." },
    ],
  },
  "layer:magnetic": {
    title: "EMAG2 Magnetic",
    subtitle: "Seabed magnetic context",
    summary: "Displays magnetic anomaly structure in the seabed. This helps identify terrain where magnetometer-based search methods could be more or less informative.",
    sections: [
      { heading: "Visual meaning", body: "High contrast regions indicate stronger magnetic variation in crustal structure." },
      { heading: "Operational use", body: "This is search-context information, not a crash-location probability layer." },
    ],
  },
  "layer:arcs": {
    title: "BTO Arc Rings",
    subtitle: "Handshake distance constraints",
    summary: "Each arc is the set of positions consistent with one measured burst timing offset after satellite calibration and geometry are applied.",
    sections: [
      { heading: "Core idea", body: "BTO constrains range to the satellite, so each handshake becomes a ring rather than a single point." },
      { heading: "Why it matters", body: "These arcs are the strongest geometric constraints in the tool." },
    ],
  },
  "layer:heatmap": {
    title: "Probability Heatmap",
    subtitle: "Satellite-driven search preference along the 7th arc",
    summary: "Shows the model's normalized preference over the 7th arc after combining path density, fuel plausibility, and other active weighting terms.",
    sections: [
      { heading: "How to read colors", body: "Brighter areas are more favored by the current model assumptions. It is comparative, not an absolute probability of wreck location." },
      { heading: "Best use", body: "Use it first, then compare against searched zones, priority gaps, or debris inversion output." },
    ],
  },
  "layer:paths": {
    title: "Candidate Paths",
    subtitle: "Feasible routes that survive the current model filters",
    summary: "These are sampled trajectories that match the BTO geometry and scoring assumptions well enough to remain in the candidate set.",
    sections: [
      { heading: "What the colors mean", body: "Colors correspond to path-family classifications such as slow, perpendicular, mixed, and other." },
      { heading: "How to use them", body: "Turn this on when you want to understand why certain arc sectors receive higher probability." },
    ],
  },
  "layer:debris": {
    title: "Debris & Drift",
    subtitle: "Recovered debris and reverse-drift context",
    summary: "Shows known debris finds and simple reverse-drift corridors used as a qualitative comparison layer.",
    sections: [
      { heading: "What it is", body: "This layer is descriptive. It is not the new joint inversion result by itself." },
      { heading: "How it helps", body: "It shows where debris was found and how those finds relate broadly to plausible source regions." },
    ],
  },
  "layer:holidays": {
    title: "Data Holidays",
    subtitle: "Coverage with quality caveats",
    summary: "Marks areas where search coverage exists on paper but the data quality or completeness is not strong enough to treat as fully cleared with confidence.",
    sections: [
      { heading: "Why it matters", body: "A searched area is not always equivalent to a well-searched area. Data holidays capture that distinction." },
      { heading: "How to combine it", body: "Compare with Priority Gaps and Searched Areas to see whether a high-interest zone may still deserve attention." },
    ],
  },
  "layer:priority": {
    title: "Priority Gaps",
    subtitle: "High-probability areas outside searched zones",
    summary: "Highlights the strongest-looking heatmap cells that sit outside the searched polygons, making them easier to inspect as next-search candidates.",
    sections: [
      { heading: "What it is now", body: "This layer now means exactly what its name suggests: unsearched high-probability sectors." },
      { heading: "Best reading mode", body: "Use it with Searched Areas and optionally the heatmap, not with every analytical layer at once." },
    ],
  },
  "layer:points": {
    title: "Key Points",
    subtitle: "Reference locations",
    summary: "Shows anchor locations such as KLIA, the last radar fix, and the satellite position so you can orient the rest of the analysis.",
    sections: [
      { heading: "Why it helps", body: "These markers keep the geometry legible when you are zoomed out or switching between evidence layers." },
      { heading: "Interpretation", body: "They are reference markers, not weighted evidence." },
    ],
  },
  "layer:searched": {
    title: "Searched Areas",
    subtitle: "Historic underwater search coverage",
    summary: "Shows the approximate polygons for ATSB and Ocean Infinity search zones, used to compare model output with what has already been covered.",
    sections: [
      { heading: "What it means", body: "If a favored model zone sits inside these polygons, the case for it has to explain why the wreck was missed." },
      { heading: "Limitations", body: "These are simplified polygons, not exact track-level search footprints." },
    ],
  },
  "section:search": {
    title: "Search Coverage",
    subtitle: "Sonar layers and visibility",
    summary: "This section controls the live sonar and search-coverage context layers used to compare predicted zones with where people have already looked.",
    sections: [
      { heading: "Opacity control", body: "Use sonar opacity when you want bathymetry or search swaths visible without overpowering the analytical overlays." },
      { heading: "Best use", body: "Keep search coverage context visible when evaluating priority gaps or debris/satellite agreement." },
    ],
  },
  "sonar:auv": {
    title: "AUV Sonar",
    subtitle: "Autonomous vehicle sidescan sonar",
    summary: "Displays live AUV sidescan sonar imagery where available, useful for examining what has already been visually scanned at high resolution.",
    sections: [
      { heading: "What you see", body: "This is a base imagery layer, not a probability result." },
      { heading: "Why it matters", body: "It helps separate genuinely new target zones from areas already seen in detail." },
    ],
  },
  "sonar:deep-tow": {
    title: "Deep Tow Sonar",
    subtitle: "Towed sidescan coverage",
    summary: "Shows deep tow sonar imagery from historical search campaigns, useful for contextualizing older search effort.",
    sections: [
      { heading: "Interpretation", body: "Use it to understand legacy search visibility, especially where terrain or coverage quality may have varied." },
      { heading: "Comparison", body: "It complements the searched polygons by showing actual imagery where available." },
    ],
  },
  "control:sonar-opacity": {
    title: "Sonar Opacity",
    subtitle: "Blend search imagery with analysis overlays",
    summary: "Changes how strongly the live sonar imagery appears beneath the analytical layers.",
    sections: [
      { heading: "Lower opacity", body: "Better when you want heatmap, gaps, or inversion overlays to dominate." },
      { heading: "Higher opacity", body: "Better when inspecting actual seabed imagery and search coverage detail." },
    ],
  },
  "section:model": {
    title: "Model",
    subtitle: "Analysis assumptions and rerun controls",
    summary: "This section controls the main analytical assumptions that shape the candidate paths and heatmap.",
    sections: [
      { heading: "Important idea", body: "Small assumption changes can move the preferred zone a long way, so this section is for sensitivity testing rather than cosmetic tuning." },
      { heading: "Workflow", body: "Change one thing at a time, rerun, and compare how the preferred arc sectors move." },
    ],
  },
  "config:min_speed_kts": {
    title: "Min Speed",
    subtitle: "Lower bound for sampled cruise speed",
    summary: "Sets the slowest speed allowed when generating candidate paths after the last radar contact.",
    sections: [
      { heading: "Effect", body: "Lower values allow slower path families and can broaden the feasible arc intersections." },
      { heading: "Use carefully", body: "Unrealistically low speeds may create paths that are mathematically possible but operationally weak." },
    ],
  },
  "config:max_speed_kts": {
    title: "Max Speed",
    subtitle: "Upper bound for sampled cruise speed",
    summary: "Sets the fastest speed allowed for candidate path generation.",
    sections: [
      { heading: "Effect", body: "Higher values can open faster families and shift where arcs can be crossed plausibly." },
      { heading: "Tradeoff", body: "Very high speeds may increase geometric reach but worsen fuel plausibility." },
    ],
  },
  "config:beam_width": {
    title: "Beam Width",
    subtitle: "Path sampling density across arc sectors",
    summary: "Controls how densely the model samples candidate sectors or endpoints.",
    sections: [
      { heading: "Higher values", body: "Give a smoother, denser result but take more computation." },
      { heading: "Lower values", body: "Run faster but can miss narrow features or look blocky." },
    ],
  },
  "config:ring_sample_step": {
    title: "Ring Sample Step",
    subtitle: "Spacing between sampled points on each arc",
    summary: "Controls how coarsely each BTO arc is sampled internally during path generation.",
    sections: [
      { heading: "Lower step", body: "Higher geometric fidelity, more computation." },
      { heading: "Higher step", body: "Faster, but can smooth over local structure." },
    ],
  },
  "config:satellite_drift_amplitude_deg": {
    title: "Sat Drift Amplitude",
    subtitle: "North-south satellite motion amplitude",
    summary: "Controls the fallback sinusoidal satellite drift amplitude when operating outside the embedded ephemeris range.",
    sections: [
      { heading: "Current state", body: "Inside the ATSB ephemeris time range, the real embedded ephemeris dominates." },
      { heading: "Why exposed", body: "It still matters for fallback behavior and sensitivity work." },
    ],
  },
  "config:fuel_remaining_at_arc1_kg": {
    title: "Fuel At Arc 1",
    subtitle: "Starting fuel for post-radar modeling",
    summary: "Defines how much fuel remains when the first relevant handshake arc is reached in the model.",
    sections: [
      { heading: "Effect", body: "Higher fuel allows more southern reach or more post-arc-7 continuation." },
      { heading: "Use", body: "This is one of the strongest non-satellite sensitivity controls." },
    ],
  },
  "config:fuel_baseline_kg_per_hr": {
    title: "Fuel Burn Baseline",
    subtitle: "Reference cruise fuel flow",
    summary: "Sets the baseline hourly fuel burn before speed and altitude adjustments are applied.",
    sections: [
      { heading: "Effect", body: "Higher burn penalizes long or fast solutions more strongly." },
      { heading: "Interpretation", body: "This is a modeling assumption, not a directly observed quantity." },
    ],
  },
  "config:max_post_arc7_minutes": {
    title: "Post-Arc 7 Minutes",
    subtitle: "Allowed continuation after the final handshake",
    summary: "Defines how long the aircraft could continue after the last handshake before fuel exhaustion in the model.",
    sections: [
      { heading: "Effect", body: "Longer continuation widens the set of endpoints that remain fuel-feasible." },
      { heading: "Use", body: "Keep this tied to your fuel assumptions so the model remains internally consistent." },
    ],
  },
  "config:debris_weight_min_lat": {
    title: "Debris Min Lat",
    subtitle: "Lower edge of debris weighting band",
    summary: "Controls the lower latitude boundary for the existing debris-weight preference used in the main heatmap model.",
    sections: [
      { heading: "What it does", body: "This does not run the new inversion. It only affects the older debris-weight shaping inside the heatmap model." },
      { heading: "When to change", body: "Only when comparing how strongly the main heatmap should favor a debris-consistent corridor." },
    ],
  },
  "config:debris_weight_max_lat": {
    title: "Debris Max Lat",
    subtitle: "Upper edge of debris weighting band",
    summary: "Controls the upper latitude boundary for the older debris-weight preference inside the main heatmap model.",
    sections: [
      { heading: "How to use", body: "Adjust with the minimum bound as a pair if you are testing debris corridor sensitivity." },
      { heading: "Keep in mind", body: "This is separate from the new joint inversion result shown in the inversion section." },
    ],
  },
  "action:run-model": {
    title: "Run Model",
    subtitle: "Recompute path and heatmap outputs",
    summary: "Applies the current assumptions and reloads the analytical layers from fresh backend results.",
    sections: [
      { heading: "What updates", body: "Candidate paths, heatmap, priority gaps, and summary displays." },
      { heading: "Best practice", body: "Change a small number of assumptions, rerun, then compare the resulting peak zone." },
    ],
  },
  "action:reset-model": {
    title: "Reset",
    subtitle: "Restore default assumptions",
    summary: "Returns the configurable model parameters to their default values.",
    sections: [
      { heading: "Use case", body: "Helpful after exploratory tuning when you want to get back to the baseline model quickly." },
      { heading: "What it does not do", body: "It does not automatically rerun the backend until you press Run Model." },
    ],
  },
  "action:export-heatmap": {
    title: "Export Heatmap",
    subtitle: "Write probability results to GeoJSON",
    summary: "Exports the current probability heatmap so you can inspect or reuse it outside the app.",
    sections: [
      { heading: "Output", body: "A GeoJSON file with per-point probability and model-weight fields." },
      { heading: "Use", body: "Helpful for archival comparison between parameter runs." },
    ],
  },
  "action:export-paths": {
    title: "Export Paths",
    subtitle: "Write candidate paths to GeoJSON",
    summary: "Exports the current candidate path set for further inspection outside the app.",
    sections: [
      { heading: "Output", body: "A GeoJSON line collection with family and fuel properties." },
      { heading: "Use", body: "Helpful when comparing families or sharing a particular run." },
    ],
  },
  "section:inversion": {
    title: "Inversion Analysis",
    subtitle: "Joint debris-origin estimation",
    summary: "This section runs the debris inversion and compares its preferred 7th-arc zone with the satellite-driven peak from the main model.",
    sections: [
      { heading: "What it is", body: "A display-only analysis layer. It does not hard-filter the main flight model." },
      { heading: "How to use", body: "Run it, then compare the debris peak, satellite peak, and their overlap zone." },
    ],
  },
  "inversion:result": {
    title: "Debris Inversion Result",
    subtitle: "Debris-only preferred zone",
    summary: "Shows the inversion probability along the 7th arc derived from the currently loaded debris dataset.",
    sections: [
      { heading: "What it shows", body: "A line along the 7th arc colored to indicate where the debris-only model concentrates probability." },
      { heading: "What it does not do", body: "It does not override the heatmap or remove any flight solutions. It is a comparison layer." },
    ],
  },
  "inversion:comparison": {
    title: "Satellite vs Debris Comparison",
    subtitle: "Agreement between methods",
    summary: "Shows where the main satellite-based peak and the debris-based peak agree or diverge along the 7th arc.",
    sections: [
      { heading: "Colors", body: "Blue is satellite-led, orange is debris-led, green is the overlap/intersection zone." },
      { heading: "Use", body: "This is the quickest way to see whether the two methods are broadly compatible." },
    ],
  },
  "action:run-inversion": {
    title: "Run Inversion",
    subtitle: "Compute the debris-origin comparison",
    summary: "Runs the debris inversion on demand. In desktop mode it computes live in Rust; in browser mode it loads the precomputed snapshot result.",
    sections: [
      { heading: "What updates", body: "The inversion line, comparison overlay, summary text, and bottom-left inversion summary panel." },
      { heading: "Caveat", body: "The result is only as strong as the loaded debris dataset and simplified drift assumptions." },
    ],
  },
  "section:path-families": {
    title: "Path Families",
    subtitle: "Route archetypes in the current sample set",
    summary: "Summarizes how the candidate path set clusters into families such as slow, perpendicular, mixed, and other.",
    sections: [
      { heading: "Why it matters", body: "Different families imply different heading and speed behavior near the last arcs." },
      { heading: "How to use", body: "Turn on Candidate Paths and compare the family legend with the geometry on the map." },
    ],
  },
  "section:legend": {
    title: "Flight Path Legend",
    subtitle: "Line style key",
    summary: "Explains the styling used in the main flight path trace.",
    sections: [
      { heading: "Confirmed", body: "Radar-backed segments with the strongest support." },
      { heading: "Probable", body: "Inferred continuation where the record becomes less direct." },
    ],
  },
  "section:info": {
    title: "Info",
    subtitle: "How to think about the tool",
    summary: "This panel explains the philosophy of the app: uncertainty first, BTO-led geometry, and inspectable assumptions.",
    sections: [
      { heading: "Main takeaway", body: "Treat the app as a structured reasoning workspace, not an oracle." },
      { heading: "Best workflow", body: "Focus on one analytical question at a time and compare layers deliberately." },
    ],
  },
};

export function getInfoContent(id: string): InfoContent | null {
  return INFO_CONTENT[id] ?? null;
}
