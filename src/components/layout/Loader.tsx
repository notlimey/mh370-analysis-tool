import type { Component } from "solid-js";
import { Show } from "solid-js";
import { loaderText, loaderVisible } from "../../stores/ui";

const Loader: Component = () => {
  return (
    <Show when={loaderVisible()}>
      <div class="loader-overlay">
        <div class="loader-content">
          <div class="loader-spinner" />
          <span class="loader-text">{loaderText()}</span>
        </div>
      </div>
    </Show>
  );
};

export default Loader;
