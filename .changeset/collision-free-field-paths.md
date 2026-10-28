---
"docture": minor
"@docture/cli": patch
---

Conflict, citation and schema issue paths now quote a key that is empty or contains a dot or a backtick, so the literal key `"a.b"` (`` `a.b` ``) no longer collides with the nested field `a.b`. A single part with both no longer reports a false conflict. `formatFieldPath` and `parseFieldPath` write and read the path text. The CLI review page matches citations by the same paths.
