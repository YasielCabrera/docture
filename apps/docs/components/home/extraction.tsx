import Image from "next/image";
import { Check } from "lucide-react";
import { heroBoxes, heroImage } from "@/lib/hero-document";

/**
 * A real generated invoice with the field geometry returned by the PDF.js loader.
 * The finished state is enough to explain the operation, so the documentation home
 * keeps this visual static.
 */
export function Extraction() {
  const { crop, height, src, width } = heroImage;

  return (
    <figure className="relative mx-auto w-full max-w-xl overflow-hidden rounded-surface border border-fd-border bg-fd-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-28px_rgba(0,0,0,0.24)] lg:max-w-none dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_28px_70px_-28px_rgba(0,0,0,0.62)]">
      <div
        className="relative overflow-hidden bg-white"
        style={{ aspectRatio: `${String(width)} / ${String(Math.round(height * crop))}` }}
      >
        <Image
          src={src}
          alt={`A generated invoice with ${String(heroBoxes.length)} regions marked: invoice number, line items and total.`}
          width={width}
          height={height}
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 1280px) 37rem, (min-width: 1024px) calc((100vw - 6rem) / 2), (min-width: 640px) 36rem, 92vw"
          className="absolute inset-0 h-auto w-full"
        />

        {heroBoxes.map((box) => (
          <div
            key={box.field}
            aria-hidden
            className="absolute z-20 overflow-hidden rounded-[3px] bg-brand/[0.06] ring-1 ring-brand"
            style={
              {
                left: `${String(box.left * 100)}%`,
                top: `${String(box.top * 100)}%`,
                width: `${String(box.width * 100)}%`,
                height: `${String(box.height * 100)}%`,
              } as React.CSSProperties
            }
          />
        ))}

        <div
          aria-hidden
          className="absolute top-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/90 px-2.5 py-1 font-mono text-[0.625rem] leading-none font-medium whitespace-nowrap text-neutral-700 shadow-[0_2px_10px_rgba(0,0,0,0.08)] sm:top-4 sm:right-4 sm:px-3 sm:py-1.5 sm:text-[0.6875rem]"
        >
          <span className="grid size-3.5 place-items-center rounded-full bg-brand-solid text-brand-on-solid">
            <Check className="size-2.5" strokeWidth={2.5} />
          </span>
          {String(heroBoxes.length)} typed fields
        </div>
      </div>

      {/* The other half of the headline. The names and types come from the schema,
          so they are there from the first frame; only the values are extracted. */}
      <figcaption className="divide-y divide-fd-border border-t border-fd-border font-mono text-[0.8125rem]">
        {heroBoxes.map((box) => {
          return (
            <div
              key={box.field}
              className="flex items-center gap-2.5 overflow-hidden px-4 py-2.5 sm:gap-3 sm:px-5"
            >
              <span
                aria-hidden
                className="h-3.5 w-0.5 shrink-0 rounded-full bg-brand"
              />
              <span className="min-w-0 truncate">{box.field}</span>
              <span className="text-fd-muted-foreground">{box.type}</span>
              <span className="ms-auto shrink-0 tabular-nums text-fd-muted-foreground">
                {box.value}
              </span>
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-items-center rounded-full border border-brand/30 bg-brand/10 text-brand"
              >
                <Check className="size-2.5" strokeWidth={2.5} />
              </span>
            </div>
          );
        })}
      </figcaption>
    </figure>
  );
}
