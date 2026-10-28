---
"docture": patch
---

Conversion no longer joins an unrelated text-only grid on the next page to a table without a number column just because the columns line up. Such a table continues only after a copy of its header row, or under a line such as `Table 4 (continued)` that names the caption right above the table. Otherwise both tables stay on their own pages with their own provenance, and the result carries one `LAYOUT_DEGRADED` warning naming the table's last line and the first unjoined row. A bold or heading-size section title set apart at the top of the next page now ends any table, even when a header copy follows it.
