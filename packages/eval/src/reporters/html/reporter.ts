import { liveArtifact, writeFileAtomic, type LiveArtifact } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { buildResult } from "../../result/build.js";
import type { CaseResult } from "../../result/types.js";
import { renderHtml, type HtmlOptions } from "./render.js";

export interface HtmlReporterOptions extends HtmlOptions {
  readonly out: string;
  /**
   * Rewrite the file while the run progresses, at most once per `intervalMs` (default 1000), with an
   * in-progress banner. The final write replaces it.
   */
  readonly live?: boolean | { readonly intervalMs?: number };
}

/** Write the result as a single offline HTML report, optionally rewritten live during the run. */
export function htmlReporter(options: HtmlReporterOptions): Reporter {
  const rows: CaseResult[] = [];
  let live: { readonly artifact: LiveArtifact; readonly render: () => string } | undefined;

  return defineReporter({
    id: "html",
    onRunStart(run) {
      if (options.live === undefined || options.live === false) return;
      rows.length = 0;
      const render = (): string => renderHtml(buildResult({ run: { ...run, status: "in-progress" }, cases: rows }), options);
      live = { artifact: liveArtifact(options.out, options.live === true ? {} : options.live), render };
      live.artifact.update(render);
    },
    onCase(row) {
      if (live === undefined) return;
      rows.push(row);
      live.artifact.update(live.render);
    },
    async onResult(result) {
      const html = renderHtml(result, options);
      if (live === undefined) return writeFileAtomic(options.out, html);
      const { artifact } = live;
      live = undefined;
      await artifact.finish(html);
    },
  });
}
