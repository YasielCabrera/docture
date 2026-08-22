import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig } from "fumadocs-mdx/config";

/**
 * Global MDX options.
 *
 * This is the ONLY correct place for an extra remark plugin. The alternative —
 * `mdxOptions` on the collection in `lib/source.ts` — takes raw `ProcessorOptions`
 * and, as its own type documents, "the default options & plugins will be removed".
 * That silently drops `remarkGfm`, and every table in the site renders as literal
 * pipe characters.
 *
 * Here the options go through Fumadocs' preset instead, so `remarkGfm`,
 * `remarkHeading`, `remarkImage`, `remarkStructure` (search indexing) and the rest
 * all survive, and the function form APPENDS to them.
 *
 * `remarkMdxMermaid` rewrites each ```mermaid fence into `<Mermaid chart="…" />`, so
 * a diagram is authored as plain markdown. The renderer is in
 * `components/mdx/mermaid.tsx`.
 */
export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [...plugins, remarkMdxMermaid],
  },
});
