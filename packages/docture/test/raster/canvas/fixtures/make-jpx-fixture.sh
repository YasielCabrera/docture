#!/usr/bin/env bash
# Regenerates half-black.pdf: one 32x32 pt page filled by a 32x32 grayscale
# JPEG 2000 image (JPXDecode), black on the left half and white on the right.
# Needs Python 3 and OpenJPEG's opj_compress (lossless by default).
set -euo pipefail
out="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 -I - "$work/half-black.pgm" <<'PY'
import sys
row = bytes([0] * 16 + [255] * 16)
with open(sys.argv[1], "wb") as f:
    f.write(b"P5\n32 32\n255\n" + row * 32)
PY
opj_compress -i "$work/half-black.pgm" -o "$work/half-black.j2k" >/dev/null
python3 -I - "$work/half-black.j2k" "$out/half-black.pdf" <<'PY'
import sys
image = open(sys.argv[1], "rb").read()
content = b"q 32 0 0 32 0 0 cm /Im1 Do Q"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 32 32] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /Length %d >>\nstream\n" % len(image) + image + b"\nendstream",
    b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
]
pdf = bytearray(b"%PDF-1.5\n")
offsets = []
for number, body in enumerate(objects, start=1):
    offsets.append(len(pdf))
    pdf += b"%d 0 obj\n" % number + body + b"\nendobj\n"
xref = len(pdf)
pdf += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
for offset in offsets:
    pdf += b"%010d 00000 n \n" % offset
pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
open(sys.argv[2], "wb").write(pdf)
PY
