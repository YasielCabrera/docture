/**
 * @docture/core — strongly typed extraction and grounded document conversion.
 *
 * THIS FILE IS THE SUPPORTED API. It is deliberately small, and an export-surface
 * test asserts the exact list — widening it is a decision, not a side effect.
 *
 * Two things are deliberately NOT here:
 *
 *   - a document library. Loaders live in their own packages, each named after the
 *     library it wraps (`@docture/loader-pdfjs` → `PdfJsLoader`), so installing
 *     core pulls no PDF parser, no WASM, no ONNX.
 *   - a model. A model belongs to the strategy that calls it; see `@docture/llm`.
 *
 * See ARCHITECTURE.md for the layering behind this.
 */

// ── The entry point ─────────────────────────────────────────────────────────────
export { Extractor, createExtractor } from "./extractor.js";
export type {
  BatchItem,
  BatchOptions,
  ExtractorOptions,
  SafeExtraction,
} from "./extractor.js";

/** Deterministic document conversion with optional constrained layout assistance. */
export { DocumentConverter, createDocumentConverter } from "./converter.js";
export type { DocumentConverterOptions } from "./converter.js";
export type {
  CodeElement,
  ConversionAsset,
  ConversionAssetMode,
  ConversionBatchItem,
  ConversionBatchOptions,
  ConversionFormat,
  ConversionResult,
  ConversionWarning,
  ConversionWarningCode,
  ConvertedPage,
  ConvertOptions,
  DocumentElement,
  ElementProvenance,
  FigureElement,
  HeadingElement,
  InlineText,
  LayoutDocument,
  LayoutPage,
  ListElement,
  PageBreakElement,
  ParagraphElement,
  SafeConversion,
  TableElement,
} from "./domain/conversion.js";
export { defineLayoutAnalyzer } from "./contracts/layout-analyzer.js";
export type {
  LayoutAnalysis,
  LayoutAnalyzer,
  LayoutAnalyzerContext,
  LayoutAnnotation,
  LayoutElementRole,
} from "./contracts/layout-analyzer.js";

/** Extracting a bundle that holds more than one document. */
export { Process } from "./process.js";
export type { ProcessExtractOptions, SplitReport } from "./process.js";

/**
 * A schema that knows its own name. Everything that takes a contract also takes a
 * bare schema — the name is only worth writing when something reads it.
 */
export { contract, contractName, isContract, schemaOf } from "./domain/contract.js";
export type { Contract, ContractDefinition, ContractLike, InferContract } from "./domain/contract.js";

/** The closed vocabularies, as values you can reach for by name. */
export { ClassificationStrategy, CompletionStrategy, SplittingStrategy } from "./domain/enums.js";

/** The one loader that lives in core, because it wraps no library. */
export { DocumentLoaderData, documentLoaderData } from "./loaders/data.js";
export type { DataLoaderConfig } from "./loaders/data.js";

// ── What goes in ────────────────────────────────────────────────────────────────
export type {
  DocumentFact,
  DocumentFeatures,
  DocumentForm,
  DocumentSource,
  KnownDocumentFact,
  RawDocument,
} from "./domain/document.js";
export { MIN_TEXT_LAYER_CHARS, hasFact, isLoadedSource } from "./domain/document.js";

// ── What comes back ─────────────────────────────────────────────────────────────
export type {
  Attempt,
  AttemptStatus,
  ClassificationResult,
  ClassificationSignal,
  ExtractionResult,
  Usage,
  ValidationIssue,
  ValidationOutcome,
} from "./domain/result.js";
export { EMPTY_USAGE } from "./domain/result.js";

// ── Writing a loader ────────────────────────────────────────────────────────────
export { defineLoader, loaderAccepts } from "./contracts/loader.js";
export type {
  DocumentLoader,
  GeometryLoader,
  ImageLoader,
  LoadContext,
  LoadRequest,
  LoaderCapabilities,
  TextLoader,
} from "./contracts/loader.js";
export type {
  DocumentMetadata,
  ImageLayoutBlock,
  LayoutBlock,
  LayoutBox,
  LayoutRoleHint,
  LoadedAsset,
  LoadedDocument,
  LoadedPage,
  LoadedSource,
  TextLine,
  TextLayoutBlock,
  TextSpan,
  TextStyle,
} from "./domain/geometry.js";

/**
 * The shared word-to-line grouper. Public because EVERY geometry loader needs it
 * and none of them should own it: a text layer, Tesseract and PaddleOCR all report
 * words differently and must arrive at the same `TextLine` shape or the parsers
 * downstream cannot be shared.
 */
export { linesFromWords, textFromLines } from "./domain/lines.js";
export type { LinesFromWordsOptions, PositionedWord } from "./domain/lines.js";

/**
 * Pixel dimensions from a PNG or JPEG header. Public for the same reason: an OCR
 * loader handed a bare image has no page size to report and must read one from the
 * bytes, and every OCR loader has that problem.
 */
export { imageSize } from "./domain/image.js";
export type { ImageSize } from "./domain/image.js";

/** `form` from per-page text lengths — the digital/scanned/mixed verdict. */
export { inferForm, preloadedFeatures } from "./pipeline/features.js";

/**
 * Compose a loader with a rasterizer. The return type gains `images: true`, so an
 * image-requiring strategy accepts the composition and rejects the bare loader.
 */
export { withRasterizer } from "./contracts/compose.js";
export type { WithImages, WithRasterizerOptions } from "./contracts/compose.js";

// ── Writing a rasterizer ────────────────────────────────────────────────────────
export { defineRasterizer } from "./contracts/rasterizer.js";
export type { Rasterizer, RasterizeContext } from "./contracts/rasterizer.js";
export { DEFAULT_RASTER_OPTIONS } from "./domain/raster.js";
export type { RasterFormat, RasterOptions, RasterPage } from "./domain/raster.js";

// ── Writing a strategy ──────────────────────────────────────────────────────────
export { defineStrategy } from "./contracts/strategy.js";
export type {
  ClassificationNeed,
  ExtractionStrategy,
  StrategyContext,
  StrategyOutcome,
} from "./contracts/strategy.js";

/**
 * The resolved contract handed to a strategy: `flexible` to give a model
 * unchanged, `jsonSchema` for a prompt, `validate` for a deterministic parser.
 */
export { resolveSchema } from "./pipeline/schema.js";
export type { JsonSchemaObject, ResolvedSchema, ValidateResult } from "./pipeline/schema.js";

// ── Classification ──────────────────────────────────────────────────────────────
export {
  classificationNode,
  classificationOf,
  classificationTree,
  defineClassification,
  defineClassifier,
  extractionContractOf,
  flattenTree,
  isClassificationTree,
} from "./contracts/classifier.js";
export type {
  Classification,
  ClassificationNames,
  ClassificationNode,
  ClassificationResponse,
  ClassificationTree,
  ClassifiedExtraction,
  Classifier,
  ClassifyContext,
} from "./contracts/classifier.js";
export type { ClassifyOptions, ConsensusStrategy } from "./pipeline/classify.js";

// ── Splitting a bundle ──────────────────────────────────────────────────────────
export { defineSplitter, runSplitter } from "./contracts/splitter.js";
export type { RunSplitterOptions, SplitContext, Splitter } from "./contracts/splitter.js";
export { UNCLASSIFIED, aggregateDocGroups, pageWindows } from "./domain/split.js";
export type { DocGroup, DocGroups, SplitVerdict } from "./domain/split.js";

// ── Bringing your own model ─────────────────────────────────────────────────────
/**
 * The seam that lets `extractor.loadLlm(...)` exist without core depending on the
 * AI SDK. `@docture/llm`'s `LLM` class is the implementation.
 */
export type { LoadLlmOptions, ModelBackend } from "./contracts/model.js";
export type { DocumentExtractor } from "./contracts/extractor.js";

// ── Routing ─────────────────────────────────────────────────────────────────────
export { declarationOrder } from "./pipeline/eligibility.js";
export type { RoutingPolicy } from "./pipeline/eligibility.js";

// ── The typed failure contract ──────────────────────────────────────────────────
export {
  ContractViolationError,
  DuplicateComponentError,
  ExtractionFailedError,
  LoadFailedError,
  NoConvertibleContentError,
  NoEligibleLoaderError,
  NoEligibleStrategyError,
  DoctureError,
  SplitFailedError,
  TimeoutError,
  UnclassifiedGroupError,
  UnsupportedSourceError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./pipeline/errors.js";
export type { Ineligibility, DoctureErrorCode } from "./pipeline/errors.js";

// ── Logging ─────────────────────────────────────────────────────────────────────
export { consoleLogger, silentLogger } from "./domain/logger.js";
export type { Logger } from "./domain/logger.js";

// ── Sources ─────────────────────────────────────────────────────────────────────
export { resolveSource, sniffMimeType } from "./pipeline/source.js";

// ── Advanced: drive the pipeline without an Extractor ───────────────────────────
export { runPipeline } from "./pipeline/run.js";
export type { PipelineComponents, RunOptions } from "./pipeline/run.js";
export { loadDocument } from "./pipeline/read.js";
export type { ReadDocument } from "./pipeline/read.js";

/**
 * Re-exported from the AI SDK so a consumer writing a schema, and a loader author
 * typing one, both reach for the same names without depending on the SDK directly.
 */
export type { FlexibleSchema, InferSchema } from "@ai-sdk/provider-utils";
