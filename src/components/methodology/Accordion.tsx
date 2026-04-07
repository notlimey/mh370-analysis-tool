import type { Component, JSX } from "solid-js";

interface AccordionProps {
  title: string;
  children: JSX.Element;
}

const Accordion: Component<AccordionProps> = (props) => {
  return (
    <details class="methodology-accordion">
      <summary class="methodology-accordion-summary">{props.title}</summary>
      <div class="methodology-accordion-body">{props.children}</div>
    </details>
  );
};

export default Accordion;
