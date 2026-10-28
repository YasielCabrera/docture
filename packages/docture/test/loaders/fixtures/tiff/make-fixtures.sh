#!/usr/bin/env bash
# Regenerates the two-page TIFF fixtures: page 1 reads "PAGE ONE" (400x120),
# page 2 reads "PAGE TWO" (440x128). Needs Python with Pillow and libtiff's tiffcp.
set -euo pipefail
out="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 -I - "$work" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
work = sys.argv[1]
font = ImageFont.load_default(size=56)
def page(text, size):
    img = Image.new("1", size, 1)
    ImageDraw.Draw(img).text((24, 28), text, font=font, fill=0)
    return img
pages = [page("PAGE ONE", (400, 120)), page("PAGE TWO", (440, 128))]
pages[0].save(f"{work}/bilevel.tif", save_all=True, append_images=pages[1:], compression="raw")
gray = [p.convert("L") for p in pages]
gray[0].save(f"{work}/gray.tif", save_all=True, append_images=gray[1:], compression="raw")
PY
tiffcp -c none "$work/bilevel.tif" "$out/pages-none.tif"
tiffcp -c g3 "$work/bilevel.tif" "$out/pages-g3.tif"
tiffcp -c g4 "$work/bilevel.tif" "$out/pages-g4.tif"
for c in lzw zip packbits; do tiffcp -c "$c" "$work/gray.tif" "$out/pages-$c.tif"; done
tiffcp -B -c lzw "$work/gray.tif" "$out/pages-lzw-be.tif"
