import { createSignal } from "solid-js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AppMode = "report" | "explore";

export type AnimationType = "fly_to" | "ease_to" | "jump";

/** Declarative map state for a chapter. The transition engine reads this. */
export interface ChapterMapState {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  /** Layer groups to show (all others hidden). If undefined, keep current. */
  layers?: string[];
  animation: AnimationType;
  /** Transition duration in ms */
  duration: number;
  /** Optional callback after map transition completes (for sequential animations) */
  onEnter?: () => void;
}

/** A single step in a chapter's map choreography. Chapters can have multiple steps. */
export interface ChapterStep {
  mapState: ChapterMapState;
  /** Delay before this step starts (ms from chapter entry or previous step) */
  delay?: number;
}

export interface Chapter {
  id: string;
  title: string;
  subtitle?: string;
  /** Narrative content paragraphs (plain text or minimal HTML) */
  content: string[];
  /** Primary map state when entering this chapter */
  mapState: ChapterMapState;
  /** Optional multi-step choreography (executed sequentially after mapState) */
  steps?: ChapterStep[];
  /** Interactive elements this chapter supports */
  interactives?: string[];
}

// ─── State ──────────────────────────────────────────────────────────────────

const [appMode, setAppMode] = createSignal<AppMode>("report");
const [currentChapterIndex, setCurrentChapterIndex] = createSignal(0);
const [isTransitioning, setIsTransitioning] = createSignal(false);
const [reportNavOpen, setReportNavOpen] = createSignal(false);

export {
  appMode,
  currentChapterIndex,
  isTransitioning,
  reportNavOpen,
  setAppMode,
  setCurrentChapterIndex,
  setIsTransitioning,
  setReportNavOpen,
};

// ─── Navigation helpers ─────────────────────────────────────────────────────

export function nextChapter(totalChapters: number): void {
  const idx = currentChapterIndex();
  if (idx < totalChapters - 1) {
    setCurrentChapterIndex(idx + 1);
  }
}

export function prevChapter(): void {
  const idx = currentChapterIndex();
  if (idx > 0) {
    setCurrentChapterIndex(idx - 1);
  }
}

export function goToChapter(index: number): void {
  setCurrentChapterIndex(index);
}

/**
 * Switch to explore mode. Caller should restore normal layer visibility
 * on the map after this (the report engine overrides layer visibility).
 */
export function enterExploreMode(): void {
  setAppMode("explore");
}

export function enterReportMode(): void {
  setAppMode("report");
  setCurrentChapterIndex(0);
}
