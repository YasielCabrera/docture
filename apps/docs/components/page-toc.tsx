"use client";

import { TOCPopover } from "fumadocs-ui/layouts/notebook/page/slots/toc";

export function PageTOCPopover() {
  return (
    <section className="contents" aria-label="Page contents">
      <TOCPopover />
    </section>
  );
}
