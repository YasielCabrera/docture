let renderQueue: Promise<void> = Promise.resolve();

export function renderGraphic({ chart, id, theme }: {
  chart: string;
  id: string;
  theme: "dark" | "default";
}) {
  const result = renderQueue.then(async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      suppressErrorRendering: true,
      fontFamily: "inherit",
      theme,
      themeVariables: { fontSize: "16px" },
      flowchart: { curve: "basis", useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
    const { svg } = await mermaid.render(id, chart);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = document.documentElement;
    if (!(root instanceof SVGSVGElement) || document.querySelector("parsererror")) {
      throw new Error("Mermaid returned an invalid SVG.");
    }
    const { width, height } = root.viewBox.baseVal;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("Mermaid returned invalid diagram dimensions.");
    }
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.setAttribute("role", "img");
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.maxWidth = "none";
    return {
      svg: root.outerHTML,
      natural: { width, height },
      title: root.querySelector("title")?.textContent?.trim() || "Diagram",
    };
  });
  renderQueue = result.then(() => {}, () => {});
  return result;
}
