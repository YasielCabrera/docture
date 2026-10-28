---
"docture": patch
---

Apply a caller schema's transforms once per extraction result. The text and vision strategies now return the model's answer before validation, so fresh, cached, cited and repaired answers no longer pass through a transform twice. A validator that changes the answer in place also takes effect once. Text and vision extraction answers cached by an earlier version are not reused, so the first run after upgrading makes those model calls again.
