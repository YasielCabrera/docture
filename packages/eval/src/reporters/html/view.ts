import type { CellValue } from "../shared/columns.js";
import type { TableView } from "../shared/views.js";

/** How a tile or bar is colored. */
export type Tone = "good" | "fair" | "warn" | "bad" | "neutral";

/** A headline number. `text` is already formatted on the server. */
export interface TileData {
  readonly label: string;
  readonly text: string;
  readonly detail?: string;
  readonly tone: Tone;
}

/** One bar. `value` is its length relative to the panel's `max`. */
export interface BarData {
  readonly label: string;
  readonly value: number | null;
  readonly text: string;
  readonly tone: Tone;
}

/** Data the client renders generically. Every value is computed and formatted on the server. */
export type PanelData =
  | { readonly kind: "tiles"; readonly title: string; readonly items: readonly TileData[] }
  | { readonly kind: "bars"; readonly title: string; readonly max: number; readonly items: readonly BarData[] }
  | ({ readonly kind: "table" } & TableView);

/** A titled group of panels. An empty title renders no heading. */
export interface SectionData {
  readonly id: string;
  readonly title: string;
  readonly panels: readonly PanelData[];
}

/** One documents-table row: the index of its case in `result.cases`, raw values to sort by and display text. */
export interface DocumentRow {
  readonly index: number;
  readonly failed: boolean;
  readonly values: readonly CellValue[];
  readonly text: readonly string[];
}

/** Everything the client shows besides the embedded result. */
export interface HtmlView {
  readonly title: string;
  /** `failures` means the embedded result keeps only leaves that did not match, and no whole documents. */
  readonly detail: "all" | "failures";
  readonly sections: readonly SectionData[];
  readonly documents: {
    readonly columns: readonly { readonly id: string; readonly header: string; readonly numeric: boolean }[];
    readonly rows: readonly DocumentRow[];
  };
}

/** Element ids the client reads. A custom shell must keep them. */
export const HTML_IDS = { result: "eval-result", view: "eval-view", copy: "eval-copy", app: "eval-app", banner: "eval-in-progress" } as const;
