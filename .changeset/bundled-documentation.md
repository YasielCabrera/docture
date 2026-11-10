---
"docture": patch
"@docture/cli": patch
"@docture/eval": patch
"@docture/synthetic": patch
---

Ship the complete offline Markdown documentation once in `docture`, generated on build and pack. Expose `docture/docs/manifest.json` for discovery with exact documented package versions and content hashes. Point each package's agent guide to the installed snapshot and reject unreleased documentation during publication.
