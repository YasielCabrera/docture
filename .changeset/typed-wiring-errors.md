---
"docture": minor
---

Breaking change. Missing pipeline components and invalid call order now throw MissingComponentError with code MISSING_COMPONENT instead of TypeError. Export isDoctureError for installed-copy identity checks. Serialize DoctureError as code and message, matching command errors.
