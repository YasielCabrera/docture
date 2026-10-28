---
"docture": patch
---

Conversion no longer adds a form section to the table above it just because its cells fall in the table's columns. A row more than 1.5 times the row spacing below the row above, with fewer cells than the table or a different font weight, starts a new section, so receipt labels such as `Booking ID` and `Payment Mode` and their values stay out of the `Check In`/`Check Out`/`Rooms` table. A totals row with a number in the last column still joins after a wider gap. The same rule ends rows that continue a table on the next page. Two-column pages also no longer drop a line that shares its row with a line spanning both columns.
