import type { ComponentProps } from "react";

/**
 * A wide table scrolls inside its wrapper on narrow screens, so the wrapper takes
 * keyboard focus and a name to let keyboard users scroll it. It is a group rather
 * than a region so that pages with several tables don't repeat a landmark.
 */
export function Table(props: ComponentProps<"table">) {
  return (
    <div className="relative overflow-auto prose-no-margin my-6" role="group" aria-label="Scrollable table" tabIndex={0}>
      <table {...props} />
    </div>
  );
}
