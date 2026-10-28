---
"docture": patch
---

Conversion no longer takes a two-page running header, such as `Report 2026` at the top of both pages, as a row of a table that continues onto the next page. A band line that repeats at the same place on another page without qualifying as furniture stays body text outside any table, and a table never continues across or through it. The rows stay on their own page, and the result carries one `LAYOUT_DEGRADED` warning naming the table's last line, the first row, and the repeated line. A loader-tagged header is still removed before the join, and a table header that repeats at the top of each page still joins.
