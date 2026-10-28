export interface ApiEntrypointInventory {
  readonly packageName: "docture" | "@docture/cli";
  readonly importPath: string;
  readonly entrypoint: string;
  readonly pages: Readonly<Record<string, readonly string[]>>;
}

export const API_INVENTORY: readonly ApiEntrypointInventory[] = [
  {
    packageName: "docture",
    importPath: "docture",
    entrypoint: "../../packages/docture/src/index.ts",
    pages: {
      "content/docs/reference/api/core-extraction.mdx": [
        "Attempt",
        "AttemptStatus",
        "BatchItem",
        "BatchOptions",
        "CitationStatus",
        "ClassificationResult",
        "ClassificationSignal",
        "ConflictingValue",
        "DocumentExtractor",
        "EMPTY_USAGE",
        "sumUsage",
        "mapWithConcurrency",
        "ExtractionConflict",
        "ExtractionResult",
        "Extractor",
        "ExtractorOptions",
        "FieldCitation",
        "formatFieldPath",
        "parseFieldPath",
        "LoadLlmOptions",
        "ModelBackend",
        "PipelineComponents",
        "RepairInput",
        "RuleFailureMode",
        "RunOptions",
        "SafeExtraction",
        "Usage",
        "ValidationIssue",
        "ValidationOutcome",
        "ValidationRule",
        "createExtractor"
      ],
      "content/docs/reference/api/core-conversion.mdx": [
        "CodeElement",
        "ConversionAsset",
        "ConversionAssetMode",
        "ConversionBatchItem",
        "ConversionBatchOptions",
        "ConversionFormat",
        "ConversionResult",
        "ConversionWarning",
        "ConversionWarningCode",
        "ConvertedPage",
        "DoctureDocument",
        "DoctureDocumentAsset",
        "DoctureDocumentParse",
        "ConvertOptions",
        "DocumentConverter",
        "DocumentConverterOptions",
        "DocumentElement",
        "ElementProvenance",
        "FigureElement",
        "FurnitureEvidence",
        "HeadingElement",
        "InlineText",
        "LayoutAnalysis",
        "LayoutAnalyzer",
        "LayoutAnalyzerContext",
        "LayoutAnnotation",
        "LayoutDocument",
        "LayoutElementRole",
        "LayoutPage",
        "LineSourceId",
        "ListElement",
        "PageBreakElement",
        "PageFooterElement",
        "PageHeaderElement",
        "ParagraphElement",
        "ProvenanceSegment",
        "SafeConversion",
        "SourceLine",
        "TableCellSpan",
        "TableElement",
        "createDocumentConverter",
        "defineLayoutAnalyzer",
        "isLineSourceId",
        "parseDoctureDocument",
        "provenanceSegments",
        "sourceLines"
      ],
      "content/docs/reference/api/core-contracts.mdx": [
        "Contract",
        "ContractDefinition",
        "ContractExample",
        "ContractLike",
        "FlexibleSchema",
        "InferContract",
        "InferSchema",
        "JsonSchemaObject",
        "ResolvedSchema",
        "ValidateResult",
        "contract",
        "contractName",
        "isContract",
        "resolveSchema",
        "schemaOf"
      ],
      "content/docs/reference/api/core-documents.mdx": [
        "DEFAULT_RASTER_OPTIONS",
        "DataLoaderConfig",
        "DocumentFact",
        "DocumentFeatures",
        "DocumentForm",
        "DocumentLoader",
        "DocumentLoaderData",
        "DocumentMetadata",
        "DocumentSource",
        "GeometryLoader",
        "ImageLoader",
        "ImageLayoutBlock",
        "ImageSize",
        "KnownDocumentFact",
        "LinesFromWordsOptions",
        "LoadContext",
        "LoadRequest",
        "LayoutBlock",
        "LayoutBox",
        "LayoutRoleHint",
        "LoadedAsset",
        "LoadedDocument",
        "LoadedPage",
        "LoadedSource",
        "LoaderCapabilities",
        "Logger",
        "MIN_TEXT_LAYER_CHARS",
        "PositionedWord",
        "RasterFormat",
        "RasterOptions",
        "RasterPage",
        "RasterizeContext",
        "Rasterizer",
        "RawDocument",
        "TextLine",
        "TextLayoutBlock",
        "TextLoader",
        "TextSpan",
        "TextStyle",
        "TiffPage",
        "WithImages",
        "WithRasterizerOptions",
        "consoleLogger",
        "defineLoader",
        "defineRasterizer",
        "documentLoaderData",
        "hasFact",
        "imageSize",
        "inferForm",
        "isLoadedSource",
        "linesFromWords",
        "loaderAccepts",
        "preloadedFeatures",
        "resolveSource",
        "silentLogger",
        "sniffMimeType",
        "textFromLines",
        "tiffPages",
        "withRasterizer"
      ],
      "content/docs/reference/api/core-components.mdx": [
        "ClassificationNeed",
        "ClassificationStrategy",
        "CompletionStrategy",
        "ExtractionStrategy",
        "OutcomeCitation",
        "ReadDocument",
        "RoutingPolicy",
        "StrategyContext",
        "StrategyOutcome",
        "declarationOrder",
        "defineStrategy",
        "readDocument",
        "runPipeline"
      ],
      "content/docs/reference/api/core-classification.mdx": [
        "Classification",
        "ClassificationNames",
        "ClassificationNode",
        "ClassificationResponse",
        "ClassificationTree",
        "ClassifiedExtraction",
        "Classifier",
        "ClassifyContext",
        "ClassifyOptions",
        "ConsensusStrategy",
        "DocGroup",
        "DocGroups",
        "Process",
        "ProcessExtractOptions",
        "RunSplitterOptions",
        "SplitContext",
        "SplitReport",
        "SplitVerdict",
        "Splitter",
        "SplittingStrategy",
        "UNCLASSIFIED",
        "aggregateDocGroups",
        "classificationNode",
        "classificationOf",
        "classificationTree",
        "defineClassification",
        "defineClassifier",
        "defineSplitter",
        "extractionContractOf",
        "flattenTree",
        "isClassificationTree",
        "pageWindows",
        "runSplitter"
      ],
      "content/docs/reference/errors.mdx": [
        "ContractViolationError",
        "DoctureError",
        "DoctureErrorCode",
        "DuplicateComponentError",
        "ExtractionFailedError",
        "Ineligibility",
        "LoadFailedError",
        "MissingEngineError",
        "NoConvertibleContentError",
        "NoEligibleLoaderError",
        "NoEligibleStrategyError",
        "PageSelectionError",
        "ModelOutputError",
        "MissingComponentError",
        "isDoctureError",
        "SplitFailedError",
        "TimeoutError",
        "UnclassifiedGroupError",
        "UnsupportedSourceError",
        "errorCodeOf",
        "isAbortError",
        "messageOf"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm",
    entrypoint: "../../packages/docture/src/llm/index.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "ImageSplitter",
        "LLM",
        "LlmClassifier",
        "LlmClassifierOptions",
        "LlmExtractorOptions",
        "LlmLayoutAnalyzer",
        "LlmLayoutAnalyzerOptions",
        "LlmOptions",
        "LlmStrategy",
        "LlmStrategyOptions",
        "LlmTelemetryOptions",
        "SplitterOptions",
        "TextSplitter",
        "VisionStrategy",
        "VisionStrategyOptions",
        "createLlmExtractor",
        "imageSplitter",
        "llm",
        "llmClassifier",
        "llmLayout",
        "model",
        "modelIdOf",
        "textSplitter",
        "vision"
      ],
      "content/docs/reference/api/llm-utilities.mdx": [
        "BuildPromptOptions",
        "MergeDiagnostics",
        "MergePart",
        "CacheKeyParts",
        "CachedResponse",
        "ContentPart",
        "Chunk",
        "ChunkContext",
        "DEFAULT_SYSTEM_PROMPT",
        "JsonSchemaLike",
        "LlmCache",
        "ModelPricing",
        "PricingTable",
        "PromptParts",
        "RawUsage",
        "buildPrompt",
        "wrapUntrusted",
        "cacheKey",
        "chunkByBudget",
        "chunkByPage",
        "estimateTokens",
        "fileCache",
        "fingerprint",
        "lookupPricing",
        "memoryCache",
        "mergePartials",
        "mergePartialsWithDiagnostics",
        "relaxJsonSchema",
        "toUsage"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/text",
    entrypoint: "../../packages/docture/src/llm/text.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "LlmStrategy",
        "LlmStrategyOptions",
        "LlmTelemetryOptions",
        "llm",
        "modelIdOf"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/vision",
    entrypoint: "../../packages/docture/src/llm/vision.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "VisionStrategy",
        "VisionStrategyOptions",
        "LlmTelemetryOptions",
        "vision"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/classifier",
    entrypoint: "../../packages/docture/src/llm/classifier.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "LlmClassifier",
        "LlmClassifierOptions",
        "LlmTelemetryOptions",
        "llmClassifier"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/layout",
    entrypoint: "../../packages/docture/src/llm/layout.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "LlmLayoutAnalyzer",
        "LlmLayoutAnalyzerOptions",
        "LlmTelemetryOptions",
        "llmLayout"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/split",
    entrypoint: "../../packages/docture/src/llm/split.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "ImageSplitter",
        "TextSplitter",
        "imageSplitter",
        "textSplitter",
        "LlmTelemetryOptions",
        "SplitterOptions"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/extractor",
    entrypoint: "../../packages/docture/src/llm/extractor.ts",
    pages: {
      "content/docs/reference/api/llm.mdx": [
        "createLlmExtractor",
        "LlmExtractorOptions"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/cache",
    entrypoint: "../../packages/docture/src/llm/entries/cache.ts",
    pages: {
      "content/docs/reference/api/llm-utilities.mdx": [
        "cacheKey",
        "fileCache",
        "fingerprint",
        "memoryCache",
        "CacheKeyParts",
        "CachedResponse",
        "ContentPart",
        "LlmCache"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/pricing",
    entrypoint: "../../packages/docture/src/llm/pricing.ts",
    pages: {
      "content/docs/reference/api/llm-utilities.mdx": [
        "lookupPricing",
        "toUsage",
        "ModelPricing",
        "PricingTable",
        "RawUsage"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/prompt",
    entrypoint: "../../packages/docture/src/llm/prompt.ts",
    pages: {
      "content/docs/reference/api/llm-utilities.mdx": [
        "DEFAULT_SYSTEM_PROMPT",
        "buildPrompt",
        "wrapUntrusted",
        "chunkByBudget",
        "chunkByPage",
        "estimateTokens",
        "BuildPromptOptions",
        "Chunk",
        "ChunkContext",
        "PromptParts"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/merge",
    entrypoint: "../../packages/docture/src/llm/merge.ts",
    pages: {
      "content/docs/reference/api/llm-utilities.mdx": [
        "MergeDiagnostics",
        "MergePart",
        "mergePartials",
        "mergePartialsWithDiagnostics"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/llm/relax",
    entrypoint: "../../packages/docture/src/llm/relax.ts",
    pages: {
      "content/docs/reference/api/llm-utilities.mdx": [
        "relaxJsonSchema",
        "JsonSchemaLike"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/loaders/pdfjs",
    entrypoint: "../../packages/docture/src/loaders/pdfjs/index.ts",
    pages: {
      "content/docs/reference/api/loader-pdfjs.mdx": [
        "DocumentLoaderPdfJs",
        "DocumentLoaderPdfJsOptions",
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/loaders/mupdf",
    entrypoint: "../../packages/docture/src/loaders/mupdf/index.ts",
    pages: {
      "content/docs/reference/api/loader-mupdf.mdx": [
        "DocumentLoaderMuPdf",
        "DocumentLoaderMuPdfOptions",
        "MuPdfRasterizer",
        "MuPdfRasterizerOptions",
        "muPdfRasterizer"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/loaders/tesseract",
    entrypoint: "../../packages/docture/src/loaders/tesseract/index.ts",
    pages: {
      "content/docs/reference/api/loader-tesseract.mdx": [
        "DocumentLoaderTesseract",
        "PageSegmentation",
        "DocumentLoaderTesseractOptions",
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/loaders/paddleocr",
    entrypoint: "../../packages/docture/src/loaders/paddleocr/index.ts",
    pages: {
      "content/docs/reference/api/loader-paddleocr.mdx": [
        "DocumentLoaderPaddleOcr",
        "ImageEngine",
        "ModelSource",
        "PADDLE_MODELS",
        "PaddleModel",
        "PaddleModelFiles",
        "DocumentLoaderPaddleOcrOptions",
        "RecognitionStrategy"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/raster/canvas",
    entrypoint: "../../packages/docture/src/raster/canvas/index.ts",
    pages: {
      "content/docs/reference/api/raster-canvas.mdx": [
        "NapiCanvasRasterizer",
        "NapiCanvasRasterizerOptions",
        "napiCanvasRasterizer"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/chunk",
    entrypoint: "../../packages/docture/src/chunk/index.ts",
    pages: {
      "content/docs/reference/api/chunk.mdx": [
        "ChunkBudget",
        "ChunkOptions",
        "ChunkableDocument",
        "DocumentChunk",
        "chunkDocument",
        "estimateTokens"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/eval",
    entrypoint: "../../packages/docture/src/eval/index.ts",
    pages: {
      "content/docs/reference/api/eval.mdx": [
        "Aggregate",
        "FieldAggregate",
        "GateOptions",
        "GateResult",
        "gate",
        "FieldResult",
        "FieldStatus",
        "RunRecord",
        "Score",
        "ScoreOptions",
        "aggregate",
        "failures",
        "formatFailures",
        "formatScoreboard",
        "hallucinations",
        "recordRun",
        "scoreExtraction",
        "AbsentCheck",
        "ConversionCheck",
        "ConversionCheckKind",
        "ConversionCheckResult",
        "ConversionReport",
        "ConvertedPages",
        "OrderCheck",
        "PresentCheck",
        "TableCheck",
        "checkConversion"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/testing/doubles",
    entrypoint: "../../packages/docture/src/testing/doubles.ts",
    pages: {
      "content/docs/reference/api/testing.mdx": [
        "failingStrategy",
        "fixedStrategy",
        "inMemoryLoader",
        "loadedDocument"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/testing/conformance",
    entrypoint: "../../packages/docture/src/testing/conformance/index.ts",
    pages: {
      "content/docs/reference/api/testing.mdx": [
        "ConformanceDocument",
        "ConformanceFixtures",
        "LoaderConformanceOptions",
        "RasterizerConformanceOptions",
        "describeLoaderConformance",
        "describeRasterizerConformance",
        "pdfFixtures",
        "pngFixtures",
        "textFixtures"
      ]
    }
  },
  {
    packageName: "docture",
    importPath: "docture/testing/fixtures",
    entrypoint: "../../packages/docture/src/testing/fixtures/index.ts",
    pages: {
      "content/docs/reference/api/testing.mdx": [
        "InvoiceOptions",
        "RichDocumentExpected",
        "SyntheticDocument",
        "SyntheticInvoice",
        "SyntheticLineItem",
        "buildInvoiceData",
        "formatMoney",
        "makeInvoicePdf",
        "makeRichDocumentPdf",
        "richDocumentExpected",
        "ConversionCase",
        "conversionCorpus"
      ]
    }
  },
  {
    packageName: "@docture/cli",
    importPath: "@docture/cli",
    entrypoint: "../../packages/cli/src/index.ts",
    pages: {
      "content/docs/reference/api/cli.mdx": [
        "CaptureOptions",
        "CapturedIo",
        "CliError",
        "DoctureConfig",
        "ExitCode",
        "Explained",
        "Io",
        "RunOptions",
        "Style",
        "UsageError",
        "captureIo",
        "defineConfig",
        "explain",
        "processIo",
        "run",
        "styleFor",
        "version"
      ]
    }
  },
  {
    packageName: "@docture/cli",
    importPath: "@docture/cli/config",
    entrypoint: "../../packages/cli/src/define-config.ts",
    pages: {
      "content/docs/reference/api/cli.mdx": [
        "CliConverter",
        "CliExtractor",
        "DoctureConfig",
        "defineConfig"
      ]
    }
  },
  {
    packageName: "@docture/cli",
    importPath: "@docture/cli/mcp",
    entrypoint: "../../packages/cli/src/mcp/index.ts",
    pages: {
      "content/docs/reference/api/cli.mdx": [
        "ENGINE_RANGES",
        "McpServerOptions",
        "createMcpServer"
      ]
    }
  }
];
