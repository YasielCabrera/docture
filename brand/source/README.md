# Brand source reference

The selected identity combines G5 from the generated brace study with option B from the semibold wordmark comparison in this conversation.

- `selected-g5.png` is the G5 crop from the generated brace sheet.
- `selected-semibold.png` is the B crop from the selected weight comparison.
- `reconstruction.json` records the reference crop bounds and production construction notes.
- `../masters/wordmark-artwork.svg` contains a geometric reconstruction of the selected semibold lettering. Shared bowls, straight stems, consistent stroke widths, and flat terminals replace the raster irregularities. The font weight name describes the approved visual choice, not a claim that the generated image used a particular font file.
- `../masters/icon-artwork.svg` is the production reconstruction of G5. Its continuous braces are mirrored for symmetry. Its winding center follows the original Powerhouse channel geometry.

The seven-letter wordmark uses custom curves derived from the selected reference. Its shapes are not an automatic bitmap trace or an unmodified font. `../tooling/build_masters.py` records that construction.

The SVG masters contain the reviewed production geometry. The raster crops are reference material rather than embedded logo content.

The Powerhouse reference sites were https://www.powerhouse.io/ and https://www.powerhouse.inc/. The original channel geometry came from the first path of the `.inc` logo at https://cdn.prod.website-files.com/64526a93e82c4b11d3e1a56c/64526a93e82c4b60e5e1a58a_ph.svg.

The colors originated in `apps/docs/app/global.css` in the Docture repository. The kit owns them in `../tokens/brand.css`; the site synchronizes that file and aliases its variables. The fixed SVG palette uses 8-bit sRGB equivalents; the CSS tokens preserve the original OKLCH values.

The supporting font files were obtained from Google Fonts. Geist and Geist Mono are the documentation app's existing families. Their licenses are included in `../fonts/`.

- Geist regular: https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RnOM4nQ.ttf
- Geist semibold: https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RQuQ4nQ.ttf
- Geist Mono regular: https://fonts.gstatic.com/s/geistmono/v6/or3yQ6H-1_WfwkMZI_qYPLs1a-t7PU0AbeE9KJ5T.ttf
- Geist license: https://raw.githubusercontent.com/google/fonts/main/ofl/geist/OFL.txt
- Geist Mono license: https://raw.githubusercontent.com/google/fonts/main/ofl/geistmono/OFL.txt
