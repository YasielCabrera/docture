"use client";

import { Maximize2, Minus, Plus, RotateCcw, Scan, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { renderGraphic } from "./mermaid-render";

type RenderState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | ({ kind: "ready" } & Awaited<ReturnType<typeof renderGraphic>>);
type Zoom = { kind: "manual"; scale: number } | { kind: "fit" };
type Surface = "inline" | "expanded";
type ScrollTarget = { kind: "start" } | { kind: "center"; x: number; y: number };

export function Mermaid({ chart }: { chart: string }): React.ReactElement {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { resolvedTheme } = useTheme();
  const [renderState, setRenderState] = useState<RenderState>({ kind: "loading" });
  const [zoom, setZoom] = useState<Zoom>({ kind: "manual", scale: 1 });
  const [surface, setSurface] = useState<Surface>("inline");
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const inlineRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const graphicRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const renderVersion = useRef(0);
  const pendingScroll = useRef<ScrollTarget | null>(null);
  const returnScroll = useRef<ScrollTarget | null>(null);

  const readCenter = useCallback((): ScrollTarget | null => {
    const graphic = graphicRef.current;
    const viewport = graphic?.closest<HTMLElement>(".mermaid-viewport");
    if (!viewport || !graphic) return null;
    const bounds = graphic.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const frame = viewport.getBoundingClientRect();
    const x = (frame.left + viewport.clientLeft + viewport.clientWidth / 2 - bounds.left) / bounds.width;
    const y = (frame.top + viewport.clientTop + viewport.clientHeight / 2 - bounds.top) / bounds.height;
    return {
      kind: "center",
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }, []);

  useEffect(() => {
    pendingScroll.current = { kind: "start" };
    returnScroll.current = null;
    setZoom({ kind: "manual", scale: 1 });
    setSurface("inline");
    setRenderState({ kind: "loading" });
  }, [chart]);

  useEffect(() => {
    let cancelled = false;
    const version = ++renderVersion.current;
    void renderGraphic({
      chart,
      id: `mermaid-${id}-${version}`,
      theme: resolvedTheme === "dark" ? "dark" : "default",
    }).then(
      (graphic) => {
        if (cancelled) return;
        pendingScroll.current ??= readCenter();
        setRenderState({ kind: "ready", ...graphic });
      },
      (cause: unknown) => {
        if (!cancelled) {
          setRenderState({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
        }
      },
    );
    return () => { cancelled = true; };
  }, [chart, id, resolvedTheme, readCenter]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (surface === "expanded" && !dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus({ preventScroll: true });
    } else if (surface === "inline" && dialog.open) {
      dialog.close();
      expandButtonRef.current?.focus({ preventScroll: true });
    }
  }, [surface]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => { dialog?.close(); };
  }, []);

  useLayoutEffect(() => {
    const viewport = surface === "inline" ? inlineRef.current : expandedRef.current;
    if (!viewport) return;
    const measure = () => setAvailable({
      width: Math.max(0, viewport.clientWidth - 32),
      height: Math.max(0, viewport.clientHeight - 32),
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [surface, renderState.kind]);

  const ready = renderState.kind === "ready";
  const scale = zoom.kind === "manual" ? zoom.scale
    : ready && available.width > 0 && available.height > 0
      ? Math.min(1, available.width / renderState.natural.width, available.height / renderState.natural.height)
      : 1;
  const title = ready ? renderState.title : "Diagram";
  const inlineHeight = ready ? `min(${renderState.natural.height + 48}px, 28rem, 65dvh)` : "8rem";

  useLayoutEffect(() => {
    const viewport = surface === "inline" ? inlineRef.current : expandedRef.current;
    const graphic = graphicRef.current;
    if (!ready || !viewport || !graphic) return;
    const target: ScrollTarget | null = pendingScroll.current
      ?? (zoom.kind === "fit" ? { kind: "center", x: 0.5, y: 0.5 } : null);
    pendingScroll.current = null;
    if (!target) return;
    if (target.kind === "start") {
      viewport.scrollTo({ left: 0, top: 0, behavior: "instant" });
      return;
    }
    const bounds = graphic.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + bounds.left - frame.left - viewport.clientLeft + bounds.width * target.x - viewport.clientWidth / 2,
      top: viewport.scrollTop + bounds.top - frame.top - viewport.clientTop + bounds.height * target.y - viewport.clientHeight / 2,
      behavior: "instant",
    });
  }, [scale, zoom, surface, renderState, ready, available]);

  function stepZoom(direction: -1 | 1) {
    pendingScroll.current = readCenter();
    const step = direction === 1 ? Math.floor(scale * 4) + 1 : Math.ceil(scale * 4) - 1;
    setZoom({ kind: "manual", scale: Math.max(0.25, Math.min(3, step / 4)) });
  }

  function closeExpanded() {
    pendingScroll.current = returnScroll.current;
    setSurface("inline");
  }

  const zoomControls = (
    <div className="mermaid-zoom-controls" role="group" aria-label="Diagram zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!ready || scale <= 0.25} onClick={() => stepZoom(-1)}>
        <Minus aria-hidden="true" />
      </button>
      <output className="mermaid-percentage" aria-label="Zoom level" aria-live="polite">
        {(scale * 100).toFixed(scale < 0.01 ? 2 : 0)}%
      </output>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!ready || scale >= 3} onClick={() => stepZoom(1)}>
        <Plus aria-hidden="true" />
      </button>
      <button type="button" disabled={!ready} onClick={() => {
        pendingScroll.current = { kind: "start" };
        setZoom({ kind: "manual", scale: 1 });
      }}>
        <RotateCcw aria-hidden="true" /> Reset 100%
      </button>
      <button type="button" disabled={!ready} aria-pressed={zoom.kind === "fit"} onClick={() => {
        pendingScroll.current = { kind: "center", x: 0.5, y: 0.5 };
        setZoom({ kind: "fit" });
      }}>
        <Scan aria-hidden="true" /> Fit
      </button>
    </div>
  );

  const content = renderState.kind === "ready" ? (
    <div className="mermaid-stage">
      <div
        ref={graphicRef}
        className="mermaid-graphic"
        style={{ width: renderState.natural.width * scale, height: renderState.natural.height * scale }}
        dangerouslySetInnerHTML={{ __html: renderState.svg }}
      />
    </div>
  ) : renderState.kind === "error" ? (
    <pre className="mermaid-error" role="alert">Mermaid could not render this diagram:{"\n"}{renderState.message}</pre>
  ) : (
    <div className="mermaid-loading" role="status">Loading diagram...</div>
  );

  return (
    <div className="mermaid-diagram">
      <div className="mermaid-toolbar">
        {zoomControls}
        <button ref={expandButtonRef} type="button" disabled={!ready} aria-haspopup="dialog" onClick={() => {
          returnScroll.current = readCenter();
          pendingScroll.current = returnScroll.current;
          setSurface("expanded");
        }}>
          <Maximize2 aria-hidden="true" /> Expand
        </button>
      </div>
      <p className="sr-only" id={`${id}-inline-help`}>Use the arrow keys to scroll the diagram. Fit shows the whole diagram.</p>
      <div
        ref={inlineRef}
        className="mermaid-viewport"
        style={{ height: inlineHeight }}
        role="region"
        aria-label={`${title}, scrollable diagram`}
        aria-describedby={`${id}-inline-help`}
        aria-busy={renderState.kind === "loading"}
        aria-hidden={surface === "expanded"}
        tabIndex={surface === "inline" ? 0 : -1}
      >
        {surface === "inline" ? content : null}
      </div>
      <dialog
        ref={dialogRef}
        className="mermaid-dialog"
        aria-labelledby={`${id}-title`}
        onCancel={(event) => { event.preventDefault(); closeExpanded(); }}
        onClose={() => {
          if (!dialogRef.current?.open) {
            setSurface("inline");
            expandButtonRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="mermaid-dialog-heading">
          <h2 id={`${id}-title`}>{title}</h2>
          <button ref={closeButtonRef} type="button" onClick={closeExpanded}>
            <X aria-hidden="true" /> Close
          </button>
        </div>
        <div className="mermaid-toolbar">{zoomControls}</div>
        <p className="sr-only" id={`${id}-expanded-help`}>Use the arrow keys to scroll the diagram. Fit shows the whole diagram. Press Escape to close.</p>
        <div
          ref={expandedRef}
          className="mermaid-viewport"
          role="region"
          aria-label={`${title}, scrollable diagram`}
          aria-describedby={`${id}-expanded-help`}
          aria-busy={renderState.kind === "loading"}
          tabIndex={0}
        >
          {surface === "expanded" ? content : null}
        </div>
      </dialog>
    </div>
  );
}
