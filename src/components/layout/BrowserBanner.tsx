import type { Component } from "solid-js";
import { Show } from "solid-js";
import { IS_TAURI } from "../../lib/backend";

const BrowserBanner: Component = () => {
  return (
    <Show when={!IS_TAURI}>
      <div class="browser-banner">
        Read-only snapshot — download the desktop app to adjust model parameters and recompute{" "}
        <a href="https://github.com/notlimey/mh370-analysis-tool" target="_blank" rel="noreferrer">
          GitHub repo
        </a>
      </div>
    </Show>
  );
};

export default BrowserBanner;
