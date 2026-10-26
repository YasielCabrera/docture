---
"@docture/cli": patch
---

Reject missing provider or gateway credentials before loading documents. Allow cache reruns, custom OpenAI base URLs, and configured compatible models to work without a hosted-provider key.

Construct a keyless OpenAI-compatible provider for an explicit OPENAI_BASE_URL, verified with the real SDK request path.
