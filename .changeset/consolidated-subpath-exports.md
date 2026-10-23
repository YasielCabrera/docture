---
"docture": minor
"@docture/cli": minor
---

Consolidate the library into `docture` with explicit ESM subpaths and retain the separate `@docture/cli` package. The root now exports core APIs only. Import model APIs from `docture/llm` or a narrow entry such as `docture/llm/text`. Replace scoped loader, rasterizer, eval and testing imports with the documented `docture/...` paths.

Engine dependencies are optional peers and must be installed explicitly for the selected integration. PDF.js, canvas, MuPDF and PDFKit accept ranges (`^6.2.108`, `^1.0.10`, `~1.28.0` and `>=0.17.2 <0.21.0`); Tesseract.js, PaddleOCR and ONNX Runtime stay at exact versions. An application that already depends on another release of an OCR engine needs the npm override in the installation guide to install `docture` for core use. The canvas rasterizer draws on the canvas that PDF.js loads, so pages render when a package manager installs a separate canvas for PDF.js. Model integrations accept Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later. An adapter whose engine is not installed throws the new `MissingEngineError` (`MISSING_ENGINE`) with the package and range to install; the CLI prints an install hint instead of calling the file damaged. Error classes recognize instances from another installed copy of `docture`, so usage, codes and fallback survive when pnpm installs separate copies for an application and the CLI. A typed CLI config accepts an `extractor` or `converter` built by either copy. The CLI retains AI SDK and PDF.js dependencies and its optional native canvas installation. Testing doubles, fixtures and conformance suites have separate entry points. Fixtures need PDFKit; conformance suites need Vitest and use those PDFKit fixtures.

This changes existing imports and dependency installation. See the migration guide before upgrading. All wrappers ship in the library tarball. Production bundlers can prune unused ESM modules; convenience classes retain their referenced capabilities.
