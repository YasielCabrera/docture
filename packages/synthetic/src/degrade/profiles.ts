/** A knob's value at severity 0 and at severity 1. Values in between are interpolated linearly. */
export type Range = readonly [atSeverity0: number, atSeverity1: number];

export type Rgb = readonly [red: number, green: number, blue: number];

export interface PaperKnobs {
  /** 0 is white paper, 1 a strongly yellowed sheet. */
  readonly tint: Range;
  /** Number of stains. */
  readonly blotches: Range;
  /** Number of fold lines. */
  readonly creases: Range;
  /** Number of visible paper fibres. */
  readonly fibre: Range;
}

export interface GeometryKnobs {
  /** Rotation about the page centre, in degrees. */
  readonly skew: Range;
  /** Horizontal shear factor about the page centre. */
  readonly shear: Range;
  /** Translation in points. */
  readonly offset: Range;
  /** Largest inward displacement of a page corner, as a fraction of the page size. */
  readonly perspective: Range;
  /** Colour of what lies beyond the sheet. The paper colour when absent, as on a flatbed scanner. */
  readonly surface?: Rgb;
}

export interface BedKnobs {
  /** Light lost at the corners, 0 to 1. */
  readonly falloff: Range;
  /** Darkness of a shadow along one edge, 0 to 1. */
  readonly shadow: Range;
  /** Number of dust specks. */
  readonly dust: Range;
  /** Number of scan-direction streaks. */
  readonly streaks: Range;
  /** Gaussian blur sigma in points. */
  readonly blur: Range;
  /** Length of a camera-shake trail in points. */
  readonly motionBlur: Range;
  /** Standard deviation of sensor noise, in 8-bit levels. */
  readonly grain: Range;
  /** Contrast change: negative flattens, positive steepens. */
  readonly contrast: Range;
}

export interface EncodeKnobs {
  /** Fraction of resolution lost to a downscale and upscale. */
  readonly softness: Range;
  /** 0 keeps colour, 1 is fully grey. */
  readonly greyscale: Range;
  /** Bilevel cutoff in 8-bit levels; 0 keeps continuous tones. */
  readonly threshold: Range;
  /** JPEG quality; 100 is stored losslessly. */
  readonly quality: Range;
}

/** A degradation recipe. Every knob is a `Range` resolved at the requested severity. */
export interface Profile {
  readonly key: string;
  readonly paper: PaperKnobs;
  readonly geometry: GeometryKnobs;
  readonly bed: BedKnobs;
  readonly encode: EncodeKnobs;
}

export type ProfileKey = "scan" | "scan-lq" | "photo" | "fax";

type Resolved<G> = { readonly [K in keyof G]: G[K] extends Range ? number : G[K] };

/** The knob values one page was degraded with. */
export interface ResolvedKnobs {
  readonly paper: Resolved<PaperKnobs>;
  readonly geometry: Resolved<GeometryKnobs>;
  readonly bed: Resolved<BedKnobs>;
  readonly encode: Resolved<EncodeKnobs>;
}

const COUNTS: ReadonlySet<string> = new Set(["blotches", "creases", "fibre", "dust", "streaks"]);

function resolveStage<G extends object>(knobs: G, severity: number): Resolved<G> {
  const out: Record<string, unknown> = {};
  for (const [name, knob] of Object.entries(knobs)) {
    if (name === "surface") {
      out[name] = knob;
      continue;
    }
    const [from, to] = knob as Range;
    const value = from + (to - from) * severity;
    out[name] = COUNTS.has(name) ? Math.round(value) : value;
  }
  return out as Resolved<G>;
}

export function resolveKnobs(profile: Profile, severity: number): ResolvedKnobs {
  return {
    paper: resolveStage(profile.paper, severity),
    geometry: resolveStage(profile.geometry, severity),
    bed: resolveStage(profile.bed, severity),
    encode: resolveStage(profile.encode, severity),
  };
}

const cleanPaper: PaperKnobs = { tint: [0, 0], blotches: [0, 0], creases: [0, 0], fibre: [0, 0] };
const cleanBed: BedKnobs = { falloff: [0, 0], shadow: [0, 0], dust: [0, 0], streaks: [0, 0], blur: [0, 0], motionBlur: [0, 0], grain: [0, 0], contrast: [0, 0] };

export const profiles: Readonly<Record<ProfileKey, Profile>> = {
  scan: {
    key: "scan",
    paper: { tint: [0, 0.25], blotches: [0, 1], creases: [0, 1], fibre: [0, 120] },
    geometry: { skew: [0, 1.4], shear: [0, 0.004], offset: [0, 4], perspective: [0, 0] },
    bed: { ...cleanBed, falloff: [0, 0.04], dust: [0, 20], streaks: [0, 1], blur: [0, 0.2], grain: [0, 5], contrast: [0, -0.05] },
    encode: { softness: [0, 0.1], greyscale: [0, 0], threshold: [0, 0], quality: [92, 85] },
  },
  "scan-lq": {
    key: "scan-lq",
    paper: { tint: [0.05, 0.45], blotches: [0, 3], creases: [0, 2], fibre: [20, 250] },
    geometry: { skew: [0, 3], shear: [0, 0.008], offset: [0, 6], perspective: [0, 0] },
    bed: { ...cleanBed, falloff: [0, 0.08], dust: [5, 80], streaks: [1, 6], blur: [0.1, 0.55], grain: [2, 12], contrast: [-0.03, -0.18] },
    encode: { softness: [0.1, 0.35], greyscale: [0, 0.3], threshold: [0, 0], quality: [70, 35] },
  },
  photo: {
    key: "photo",
    paper: { tint: [0, 0.2], blotches: [0, 1], creases: [0, 2], fibre: [0, 60] },
    geometry: { skew: [0, 2.5], shear: [0, 0.01], offset: [0, 6], perspective: [0, 0.06], surface: [92, 84, 76] },
    bed: { ...cleanBed, falloff: [0.03, 0.3], shadow: [0, 0.35], dust: [0, 6], blur: [0, 0.3], motionBlur: [0, 1.5], grain: [2, 9], contrast: [0, -0.1] },
    encode: { softness: [0, 0.2], greyscale: [0, 0], threshold: [0, 0], quality: [88, 60] },
  },
  fax: {
    key: "fax",
    paper: cleanPaper,
    geometry: { skew: [0, 1], shear: [0, 0.003], offset: [0, 3], perspective: [0, 0] },
    bed: { ...cleanBed, dust: [0, 30], streaks: [0, 3], blur: [0.15, 0.35], grain: [0, 10] },
    encode: { softness: [0.2, 0.45], greyscale: [1, 1], threshold: [150, 125], quality: [100, 100] },
  },
};
