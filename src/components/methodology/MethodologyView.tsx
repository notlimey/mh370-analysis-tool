import "katex/dist/katex.min.css";
import type { Component } from "solid-js";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Dynamic } from "solid-js/web";
import { chapters } from "../../content/methodology/chapters";
import { setMethodologyOpen } from "../../stores/ui";
import Accordion from "./Accordion";
import SourceCitation from "./SourceCitation";

const mdxComponents = {
  Accordion: Accordion as Component,
  SourceCitation: SourceCitation as Component,
};

const MethodologyView: Component = () => {
  const [activeChapter, setActiveChapter] = createSignal(chapters[0]?.id ?? "");

  const current = () => chapters.find((c) => c.id === activeChapter());

  return (
    <div class="methodology-view">
      <nav class="methodology-sidebar" aria-label="Methodology chapters">
        <div class="methodology-sidebar-header">
          <h2>Methodology</h2>
          <button
            class="methodology-close"
            onClick={() => setMethodologyOpen(false)}
            type="button"
            aria-label="Close methodology view"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <ul class="methodology-nav">
          <For each={chapters}>
            {(chapter) => (
              <li>
                <button
                  class="methodology-nav-btn"
                  classList={{ "methodology-nav-btn--active": activeChapter() === chapter.id }}
                  aria-current={activeChapter() === chapter.id ? "page" : undefined}
                  onClick={() => setActiveChapter(chapter.id)}
                  type="button"
                >
                  {chapter.title}
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
      <main class="methodology-content">
        <Show when={current()} fallback={<p class="methodology-empty">Select a chapter.</p>}>
          {(ch) => (
            <Suspense fallback={<p class="methodology-loading">Loading...</p>}>
              <article class="methodology-article">
                <Dynamic component={ch().component} components={mdxComponents} />
              </article>
            </Suspense>
          )}
        </Show>
      </main>
    </div>
  );
};

export default MethodologyView;
