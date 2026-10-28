---
"docture": patch
---

Conversion now merges a bold group label centred over two or more table columns, such as `Quarters` above `Q1` and `Q2`, into a header cell with `colSpan`, even when the label overlaps neither column, and counts the row below it as a second header row. The label needs a bold header row under rows that are not all bold, at least two rows below it, and a step to the next row of at most 1.5 times their spacing. A caption such as `Table 1`, heading-size text, or an unstyled centred line stays outside the table; the unstyled line adds a `LAYOUT_DEGRADED` warning, and it is no longer placed in the first column.
