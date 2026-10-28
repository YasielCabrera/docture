---
"@docture/cli": minor
---

Add the `@docture/cli/config` entry. It exports `defineConfig`, `DoctureConfig`, and the `CliExtractor` and `CliConverter` types, and it has no runtime imports, so a tool that reads a `docture.config.ts` loads neither the CLI nor `docture`. Documented config examples now import `defineConfig` from `@docture/cli/config`. The root `@docture/cli` entry still exports `defineConfig` and `DoctureConfig`, so existing configs keep working.
