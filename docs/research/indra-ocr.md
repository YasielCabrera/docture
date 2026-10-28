# Indra OCR integration assessment

Assessed on 2026-10-28 for T-154. Recommendation is **support later**. A Node implementation is feasible, but model-license permission and a reproducible native geometry test must come first. This assessment adds no engine, loader, model download or public entry.

## Runtime and maturity

The official `indra-ocr` implementation uses Python, ONNX Runtime, OpenCV and pypdfium2. Its first run fetches model files, and it supports local model directories. A Python subprocess would add a separate runtime and lifecycle to Docture. Prefer the community TypeScript path if the gates below pass. [Official Indra repository](https://github.com/datalab-to/indra).

The published `ppu-indra-ocr@0.2.1` package has an image entry and separate PDF entry. Its optional Node ONNX peer is `^1.23.2`; its development dependency is `^1.29.0`. OpenCV support comes through ordinary dependency `ppu-ocv`. The peer range includes Docture's current exact `onnxruntime-node@1.27.0`, but that inclusion is not runtime evidence. The exact package metadata was checked with `npm view` and the tagged manifest. [Version 0.2.1 package manifest](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-indra-ocr/v0.2.1/package.json).

The port offers reusable initialize/convert/destroy methods, versioned model presets and explicit local model sources. It reports line boxes and confidence, reading-order blocks, text and Markdown. Boxes use the upright page's pixels after rotation and deskew. Its maintainers compare stages with Python 1.1.2 goldens and claim reference parity for their OpenCV backend. These are upstream claims, not Docture measurements. Pinning a 0.2.x package is possible, but no Docture native recognition or transformation checks have run. [Tagged port documentation](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-indra-ocr/v0.2.1/README.md).

## Model-license gate

The code's Apache-2.0 license does not cover the weights. The model license restricts use by organizations above the stated prior-year revenue or lifetime-funding caps, with personal and research exceptions. Its competing-product restriction has no such exception. Distribution requires downstream license notices and restrictions. The text also contains attribution and share-alike clauses covering outputs. Those clauses require review before any claim that a general Docture deployment can use the model. [Datalab model license](https://huggingface.co/datalab-to/indra-ocr/blob/main/LICENSE).

Docture's extraction purpose may overlap Datalab's products. That is an inference about a material unresolved permission question. Obtain written permission that covers project CI, the proposed integration and the intended deployment class before downloading weights here. Do not ship weights or mirror them in packages or images. An optional peer alone cannot settle whether its caller may run the model. Any future recipe must distinguish code and model licenses and explain first-use downloads, deployment eligibility, local licensed files and output obligations.

The community project records an unanswered licensing request and lists changes it may make, including removing mirrors or archiving. This makes the license an integration-maintenance risk as well as a deployment constraint. [Port license status](https://github.com/PT-Perkasa-Pilar-Utama/ppu-indra-ocr/blob/a1f9fa7fe2b271b237b775f911903db3f591a8f8/LICENSE-STATUS.md).

## Proposed loader after approval

Use `docture/loaders/indra` with `DocumentLoaderIndra`, an exact `ppu-indra-ocr@0.2.1` optional peer and an exact tested native peer. Start by testing the existing `onnxruntime-node@1.27.0` shared with PaddleOCR. Do not widen or tighten either native range based on metadata alone. If the two adapters cannot pass together on one native version, resolve that package-wide dependency policy before publishing support.

Load the peer and initialize sessions only on the first `load` through `importEngine`. A missing peer must raise `MissingEngineError`. Keep the Indra and Paddle entries independent, with no import of the other entry or a registry. Give `loaders/indra` a narrow boundary role. Core retains no Indra declaration dependency.

Accept PNG and JPEG initially. Decode TIFF pages using the same bounded TIFF policy as the existing OCR adapters before sending encoded page images to Indra. Accept PDF only when the caller supplies an existing Docture rasterizer, such as `NapiCanvasRasterizer` or `MuPdfRasterizer`. Pass selected original pages and the render cap before rendering. Do not import the port's PDF entry or add `@embedpdf/pdfium`. Digital PDF text-layer reuse remains a separate primary loader or explicit OCR-fallback composition.

Expose a tested model preset or explicit local model files, DPI for rasterized inputs, page cap, bounded concurrency, math mode and furniture policy. Keep script routing with the engine; do not invent a language-selection option absent from its API. Preserve furniture in normalized evidence even when a Markdown preference omits it.

Map each reported OCR line to one span with its real line box and line confidence. Do not fabricate word boxes. Preserve reading-order text and supported layout roles. A table region alone does not establish cell structure. Generated Markdown and math text cannot establish missing native cell geometry or character positions.

Invert rotation, deskew and scaling into the original page's top-left PDF points before advertising geometry. Record the source dimensions and transformations. `images` is true only if a matching original-page image function is provided. If the transform cannot be reconstructed and verified, return text-only with an explicit limitation rather than attaching upright-image boxes to an original-page review.

## Verification gate

An implementation ticket needs licensed model fixtures pinned by revision and digest, offline initialization, real `RUN_OCR=1` image/PDF/TIFF cases, rotation and skew overlay checks, multilingual lines, furniture and math cases, cancellation, repeated loads, concurrency and exactly-once disposal. Run both Indra and Paddle in the same packed consumer with the proposed shared native version.

Extend packed checks for absent peers, Node/types/error identity, idle imports, root and unrelated-entry bundle isolation, and no PDFium edge. Add the narrow install recipe, API inventory and runnable example. Keep the engine exact until floor/newest evidence justifies a range. No Indra runtime, speed or accuracy result is claimed by this analysis.
