# Docture brand kit

Use the G5 icon with the selected semibold wordmark. Start with `logos/horizontal/docture-horizontal-primary.svg` on light surfaces or `logos/horizontal/docture-horizontal-on-dark.svg` on dark surfaces.

The logo files contain vector artwork. They do not require a font, network access, or an image embedded inside the SVG.

## Choose an asset

| Placement | Asset |
| --- | --- |
| Website header, documentation, or repository README | `logos/horizontal/` |
| A narrow cover or centered composition | `logos/stacked/` |
| An avatar, app icon, or compact navigation item | `logos/icon/` |
| Text without the icon | `logos/wordmark/` |
| A signature with the Powerhouse attribution | `logos/endorsed/` |
| An email, slide, or tool that requires a bitmap | `png/` |
| Browser tabs and home-screen installation | `favicons/` |
| Link previews, repository social previews, and slide covers | `social/` |
| Brand colors in code or design tools | `tokens/` |
| The complete visual reference | `brand-sheet.pdf`, `brand-sheet.svg`, or `brand-sheet.png` |

`brand-sheet.html` is an offline preview with the supporting fonts embedded. `manifest.json` records each distributed file and its SHA-256 checksum.

## Choose a color variant

| Suffix | Use |
| --- | --- |
| `primary` | Burnt-orange icon and ink wordmark on light surfaces |
| `on-dark` | Amber icon and paper wordmark on dark surfaces |
| `black` | One-color black artwork |
| `white` | One-color white artwork on a dark field |
| `brand` | One-color burnt-orange artwork on a light field |
| `current-color` | Inline SVG controlled by CSS `color` |

The SVG and logo PNG files have transparent backgrounds. Social images, app icons, and fallback favicon PNG files have intentional solid backgrounds.

The `current-color` variant inherits CSS only when the SVG is inline. An SVG loaded with an HTML `<img>` does not inherit the page's text color. Use a fixed-color variant for `<img>`.

## Keep the geometry

Keep at least 16 design units clear around the complete logo, measured against the 128-unit icon canvas. At a 32 px icon canvas, that clearance is 4 px. The clear area surrounds the SVG canvas; do not place other content inside that area.

Use the complete horizontal logo at 140 px wide or larger. Use the standard icon at 24 px or larger. At 16-24 px, use `logos/icon-micro/` or the micro artwork in `favicons/favicon.svg`; its braces are slightly heavier. Below 16 px, use a larger placement.

Scale the whole SVG uniformly. Keep the icon and wordmark together in the supplied lockups. Do not stretch the letters, change the spacing, or add shadows, outlines, gradients, or extra marks.

Use the icon alone in square placements. The app and avatar files already include padding. Keep the maskable icon's solid background; the central artwork stays within the platform's safe circle.

## Use the colors

| Color | Screen export | CSS source | Role |
| --- | --- | --- | --- |
| Burnt orange | `#BF4300` | `oklch(0.55 0.17 41)` | Light accent and filled brand surfaces |
| Amber | `#F99549` | `oklch(0.76 0.15 55)` | Accent against dark surfaces |
| Ink | `#171717` | `#171717` | Wordmark and dark fields |
| Paper | `#FCFCFC` | `oklch(0.99 0 0)` | Light fields and artwork on brand fills |

The accent values originated in `apps/docs/app/global.css`. The authoritative values now live in `tokens/brand.css`, which the documentation app synchronizes and imports. The HEX values are sRGB exports of those values, rounded to 8-bit channels. The burnt-orange conversion clips a small negative blue component to zero. Keep the original OKLCH values in CSS.

The filled brand color stays burnt orange in both modes. Only the accent for dark backgrounds becomes amber. Use paper on a burnt-orange tile. The supplied combinations meet a 3:1 contrast target for the graphic mark; the verification report records the actual ratios. Use the neutral foreground color for ordinary text.

## Use the supporting fonts

The wordmark is custom outlined artwork reconstructed from the approved semibold concept. Do not retype it with a font and expect a matching logo.

Use Geist for interface text and headings. Use Geist Mono for code and technical labels. Static TTF files for Geist regular, Geist semibold, and Geist Mono regular are in `fonts/`. Their original SIL Open Font License files are included there.

Font sources are recorded in [the source notes](source/README.md). These supporting fonts match the families already used by the documentation app.

## Install favicons

Copy the files inside `favicons/`, excluding `head.html`, into the website's public root. Copy the tags from `favicons/head.html` into the document head, adapting them to your framework.

The supplied `site.webmanifest` is an installation template for a site hosted at `/`. Set its `start_url`, display mode, name, and colors to the deployed application's requirements. If you put the files in a subdirectory, update the HTML paths and retain the manifest's relative icon paths.

The SVG favicon adapts to the operating system's light or dark preference. The ICO contains 16, 32, and 48 px images. Apple, Android, and maskable icons are separate files.

The brand kit does not change the documentation application's active metadata or public files.

## Use social and presentation images

Use `social/open-graph-*.png` for 1200 x 630 link previews. Use `social/github-social-*.png` for a 1280 x 640 repository social preview. Use `social/presentation-cover-*.png` for a 1600 x 900 cover. Square 1024 px avatars are available on paper, ink, or burnt-orange fields.

Each social image also has an SVG master. Its text is outlined, including the description and Powerhouse attribution.

## Regenerate the kit

The generator reads `masters/icon-artwork.svg` and `masters/wordmark-artwork.svg`. Edit those masters to change the geometry. The source crops preserve the original selections for comparison.

Use Python 3.13 or later with the pinned dependencies in `tooling/requirements.txt`.

```sh
uv venv /tmp/docture-brand-tools
uv pip install --python /tmp/docture-brand-tools/bin/python -r brand/tooling/requirements.txt
/tmp/docture-brand-tools/bin/python brand/tooling/generate.py
/tmp/docture-brand-tools/bin/python brand/tooling/verify.py
/tmp/docture-brand-tools/bin/python brand/tooling/generate.py --archive-only
```

Run the commands from the repository root. PDF verification also needs Poppler's `pdftoppm` command. Regeneration uses the local masters and fonts; it does not make model calls or download assets. The optional `tooling/build_masters.py` rebuilds the reviewed construction geometry with explicit curves. The letters share consistent bowls, stems, and flat terminals. It does not trace the raster edge noise. Keep the current masters if you have edited them in a vector editor.

The generator rewrites its named exports and inventory. The archive is `docture-brand-kit.zip`. The generator does not remove files that you added to the kit.

The PDF is a vector brand reference. For print artwork, import the logo SVG into the print layout and use the printer's color profile.
