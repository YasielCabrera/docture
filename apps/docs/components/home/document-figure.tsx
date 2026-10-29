import Image from "next/image";
import type { ReactNode } from "react";

export interface CroppedImage {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Fraction of the page height that is shown, from the top. */
  readonly crop: number;
}

/** Relative to the cropped frame, 0-1. */
export interface FrameBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rendered page, framed to where its content ends, with overlays positioned in
 * the same frame. The frame's aspect ratio is fixed before the image loads.
 */
export function DocumentFigure({
  image,
  sizes,
  eager = false,
  className = "",
  children,
}: {
  image: CroppedImage;
  sizes: string;
  eager?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <figure className={`m-0 overflow-hidden rounded-surface border border-fd-border bg-white ${className}`}>
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: `${String(image.width)} / ${String(Math.round(image.height * image.crop))}` }}
      >
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          className="absolute inset-x-0 top-0 h-auto w-full"
        />
        {children}
      </div>
    </figure>
  );
}

export function FieldBox({ box, children }: { box: FrameBox; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className="absolute rounded-[3px] border-[1.5px] border-brand-solid bg-brand-solid/[0.09]"
      style={{
        left: `${String(box.left * 100)}%`,
        top: `${String(box.top * 100)}%`,
        width: `${String(box.width * 100)}%`,
        height: `${String(box.height * 100)}%`,
      }}
    >
      {children}
    </span>
  );
}
