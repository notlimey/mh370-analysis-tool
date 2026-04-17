import type { Component } from "solid-js";
import { lazy } from "solid-js";

export interface Chapter {
  id: string;
  title: string;
  component: Component<{ components?: Record<string, Component> }>;
}

export const chapters: Chapter[] = [
  {
    id: "satellite-geometry",
    title: "Satellite Geometry & BTO",
    component: lazy(() => import("./01-satellite-geometry.mdx")),
  },
  // Future chapters:
  // { id: "bfo-doppler", title: "BFO & Doppler Analysis", component: lazy(() => import("./02-bfo-doppler.mdx")) },
  // { id: "path-sampling", title: "Path Sampling", component: lazy(() => import("./03-path-sampling.mdx")) },
  // { id: "probability", title: "Probability Model", component: lazy(() => import("./04-probability.mdx")) },
  // { id: "drift", title: "Debris Drift", component: lazy(() => import("./05-drift.mdx")) },
];
