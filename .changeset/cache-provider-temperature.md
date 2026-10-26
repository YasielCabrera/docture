---
"docture": minor
---

Include the provider and resolved temperature in LLM response cache keys for extraction, vision, classification, layout, and splitting. String models use the gateway provider, and an unset temperature shares entries with zero.

`CacheKeyParts` now requires `provider` and `temperature`. This changes persisted cache digests. Old entries are no longer reused, and the first matching request calls the model again. File-cache entries remain on disk.
