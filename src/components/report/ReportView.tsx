import type { Component } from "solid-js";
import { createEffect, For, on, Show } from "solid-js";
import { MAP_CENTER, MAP_ZOOM } from "../../constants";
import { CHAPTERS } from "../../content/chapters";
import { useMap } from "../../contexts/map-context";
import { animateRadarTrack, hideRadarTrack, showRadarTrackInstant } from "../../layers/radar-track";
import { restoreExploreState, transitionToChapter } from "../../lib/map-transitions";
import {
  currentChapterIndex,
  enterExploreMode,
  goToChapter,
  nextChapter,
  prevChapter,
  reportNavOpen,
  setReportNavOpen,
} from "../../stores/report";
import { mapReady } from "../../stores/ui";
import { applyLayerVisibility } from "../map/MapContainer";

const ReportView: Component = () => {
  const map = useMap();

  // Transition map when chapter changes — but only after layers are loaded
  createEffect(
    on(
      () => [currentChapterIndex(), mapReady()] as const,
      ([idx, ready], prev) => {
        if (!ready) return;
        const m = map();
        if (!m) return;
        const chapter = CHAPTERS[idx];
        if (!chapter) return;

        const prevIdx = prev?.[0];

        // Radar-track layers use paint opacity (start at 0) rather than layout visibility,
        // so we need to manage their opacity based on chapter context.
        const hasRadarTrack = chapter.mapState.layers?.includes("radar-track");
        const wantsAnimation = chapter.interactives?.includes("radar-track-animation");

        if (hasRadarTrack && wantsAnimation) {
          hideRadarTrack(m);
        } else if (hasRadarTrack) {
          showRadarTrackInstant(m);
        } else {
          hideRadarTrack(m);
        }

        void transitionToChapter(m, chapter).then(() => {
          if (wantsAnimation) {
            if (prevIdx === undefined || prevIdx < idx) {
              void animateRadarTrack(m, 8000);
            } else {
              showRadarTrackInstant(m);
            }
          }
        });
      },
    ),
  );

  const chapter = () => CHAPTERS[currentChapterIndex()];
  const isFirst = () => currentChapterIndex() === 0;
  const isLast = () => currentChapterIndex() === CHAPTERS.length - 1;

  function handleExplore() {
    const m = map();
    if (m) {
      restoreExploreState(m);
      hideRadarTrack(m);
      applyLayerVisibility(m);
      m.flyTo({ center: MAP_CENTER, zoom: MAP_ZOOM, duration: 2000, essential: true });
    }
    enterExploreMode();
  }

  return (
    <div class="report-panel">
      {/* Chapter navigation dots */}
      <div class="report-nav-strip">
        <button
          type="button"
          class="report-nav-toggle"
          onClick={() => setReportNavOpen(!reportNavOpen())}
          title="Chapter list"
        >
          <span class="report-nav-hamburger" />
        </button>
        <div class="report-nav-dots">
          <For each={CHAPTERS}>
            {(ch, i) => (
              <button
                type="button"
                class="report-dot"
                classList={{ active: i() === currentChapterIndex() }}
                onClick={() => goToChapter(i())}
                title={ch.title}
              />
            )}
          </For>
        </div>
      </div>

      {/* Chapter list dropdown */}
      <Show when={reportNavOpen()}>
        <div class="report-chapter-list">
          <For each={CHAPTERS}>
            {(ch, i) => (
              <button
                type="button"
                class="report-chapter-item"
                classList={{ active: i() === currentChapterIndex() }}
                onClick={() => {
                  goToChapter(i());
                  setReportNavOpen(false);
                }}
              >
                <span class="report-chapter-num">{i()}</span>
                <span class="report-chapter-title">{ch.title}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Narrative content */}
      <div class="report-content">
        <Show when={chapter()}>
          {(ch) => (
            <>
              <Show when={ch().subtitle}>
                <p class="report-subtitle">{ch().subtitle}</p>
              </Show>
              <h1 class="report-title">{ch().title}</h1>
              <div class="report-body">
                <For each={ch().content}>{(paragraph) => <p>{paragraph}</p>}</For>
              </div>
            </>
          )}
        </Show>
      </div>

      {/* Navigation controls */}
      <div class="report-controls">
        <button
          type="button"
          class="report-btn report-btn-prev"
          disabled={isFirst()}
          onClick={() => prevChapter()}
        >
          Previous
        </button>
        <span class="report-progress">
          {currentChapterIndex() + 1} / {CHAPTERS.length}
        </span>
        <Show
          when={!isLast()}
          fallback={
            <button type="button" class="report-btn report-btn-explore" onClick={handleExplore}>
              Explore the data
            </button>
          }
        >
          <button
            type="button"
            class="report-btn report-btn-next"
            onClick={() => nextChapter(CHAPTERS.length)}
          >
            Next
          </button>
        </Show>
      </div>

      {/* Skip to explore */}
      <button type="button" class="report-skip" onClick={handleExplore}>
        Skip to explore mode
      </button>
    </div>
  );
};

export default ReportView;
