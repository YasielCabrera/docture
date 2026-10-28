export interface ApiEntrypointInventory {
  readonly packageName: "docture" | "@docture/cli";
  readonly importPath: string;
  readonly entrypoint: string;
  readonly pages: Readonly<Record<string, readonly string[]>>;
}

export const API_INVENTORY: readonly ApiEntrypointInventory[] = [
  {
    "packageName": "docture",
    "importPath": "docture",
    "entrypoint": "../../packages/docture/src/index.ts",
    "pages": {
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
        "ExtractionConflict",
        "ExtractionResult",
        "Extractor",
        "ExtractorOptions",
        "FieldCitation",
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
        "createCheckedExtractor",
        "createExtractor",
        "formatFieldPath",
        "mapWithConcurrency",
        "parseFieldPath",
        "sumUsage"
      ],
      "content/docs/reference/api/core-conversion.mdx": [
        "CellSourceId",
        "CodeElement",
        "ConversionAsset",
        "ConversionAssetMode",
        "ConversionBatchItem",
        "ConversionBatchOptions",
        "ConversionFormat",
        "ConversionResult",
        "ConversionWarning",
        "ConversionWarningCode",
        "ConvertOptions",
        "ConvertedPage",
        "DoctureDocument",
        "DoctureDocumentAsset",
        "DoctureDocumentParse",
        "DocumentConverter",
        "DocumentConverterOptions",
        "DocumentElement",
        "ElementProvenance",
        "ElementSourceId",
        "EvidenceLocation",
        "EvidenceSourceId",
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
        "SourceEvidence",
        "SourceEvidenceParse",
        "SourceLine",
        "TableCellSpan",
        "TableElement",
        "createDocumentConverter",
        "defineLayoutAnalyzer",
        "isEvidenceSourceId",
        "isLineSourceId",
        "parseDoctureDocument",
        "parseSourceEvidence",
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
        "ImageLayoutBlock",
        "ImageLoader",
        "ImageSize",
        "KnownDocumentFact",
        "LayoutBlock",
        "LayoutBox",
        "LayoutRoleHint",
        "LinesFromWordsOptions",
        "LoadContext",
        "LoadRequest",
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
        "SourceResolver",
        "TextLayoutBlock",
        "TextLine",
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
        "DisposalScope",
        "ExtractionStrategy",
        "OcrFallbackOptions",
        "OcrFallbackWarning",
        "OutcomeCitation",
        "PageOcrQuality",
        "ReadDocument",
        "RoutingPolicy",
        "ScopedDisposable",
        "StrategyContext",
        "StrategyOutcome",
        "createDisposalScope",
        "declarationOrder",
        "defineStrategy",
        "readDocument",
        "runPipeline",
        "withOcrFallback"
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
        "MissingComponentError",
        "MissingEngineError",
        "ModelOutputError",
        "NoConvertibleContentError",
        "NoEligibleLoaderError",
        "NoEligibleStrategyError",
        "PageSelectionError",
        "SplitFailedError",
        "TimeoutError",
        "UnclassifiedGroupError",
        "UnsupportedSourceError",
        "errorCodeOf",
        "isAbortError",
        "isDoctureError",
        "messageOf"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm",
    "entrypoint": "../../packages/docture/src/llm/index.ts",
    "pages": {
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
        "CacheKeyParts",
        "CachedResponse",
        "Chunk",
        "ChunkContext",
        "ContentPart",
        "DEFAULT_SYSTEM_PROMPT",
        "JsonSchemaLike",
        "LlmCache",
        "MergeDiagnostics",
        "MergePart",
        "ModelPricing",
        "PricingTable",
        "PromptParts",
        "RawUsage",
        "buildPrompt",
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
        "toUsage",
        "wrapUntrusted"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/text",
    "entrypoint": "../../packages/docture/src/llm/text.ts",
    "pages": {
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
    "packageName": "docture",
    "importPath": "docture/llm/vision",
    "entrypoint": "../../packages/docture/src/llm/vision.ts",
    "pages": {
      "content/docs/reference/api/llm.mdx": [
        "LlmTelemetryOptions",
        "VisionStrategy",
        "VisionStrategyOptions",
        "vision"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/classifier",
    "entrypoint": "../../packages/docture/src/llm/classifier.ts",
    "pages": {
      "content/docs/reference/api/llm.mdx": [
        "LlmClassifier",
        "LlmClassifierOptions",
        "LlmTelemetryOptions",
        "llmClassifier"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/layout",
    "entrypoint": "../../packages/docture/src/llm/layout.ts",
    "pages": {
      "content/docs/reference/api/llm.mdx": [
        "LlmLayoutAnalyzer",
        "LlmLayoutAnalyzerOptions",
        "LlmTelemetryOptions",
        "llmLayout"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/split",
    "entrypoint": "../../packages/docture/src/llm/split.ts",
    "pages": {
      "content/docs/reference/api/llm.mdx": [
        "ImageSplitter",
        "LlmTelemetryOptions",
        "SplitterOptions",
        "TextSplitter",
        "imageSplitter",
        "textSplitter"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/extractor",
    "entrypoint": "../../packages/docture/src/llm/extractor.ts",
    "pages": {
      "content/docs/reference/api/llm.mdx": [
        "LlmExtractorOptions",
        "createLlmExtractor"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/cache",
    "entrypoint": "../../packages/docture/src/llm/entries/cache.ts",
    "pages": {
      "content/docs/reference/api/llm-utilities.mdx": [
        "CacheKeyParts",
        "CachedResponse",
        "ContentPart",
        "LlmCache",
        "cacheKey",
        "fileCache",
        "fingerprint",
        "memoryCache"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/pricing",
    "entrypoint": "../../packages/docture/src/llm/pricing.ts",
    "pages": {
      "content/docs/reference/api/llm-utilities.mdx": [
        "ModelPricing",
        "PricingTable",
        "RawUsage",
        "lookupPricing",
        "toUsage"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/prompt",
    "entrypoint": "../../packages/docture/src/llm/prompt.ts",
    "pages": {
      "content/docs/reference/api/llm-utilities.mdx": [
        "BuildPromptOptions",
        "Chunk",
        "ChunkContext",
        "DEFAULT_SYSTEM_PROMPT",
        "PromptParts",
        "buildPrompt",
        "chunkByBudget",
        "chunkByPage",
        "estimateTokens",
        "wrapUntrusted"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/merge",
    "entrypoint": "../../packages/docture/src/llm/merge.ts",
    "pages": {
      "content/docs/reference/api/llm-utilities.mdx": [
        "MergeDiagnostics",
        "MergePart",
        "mergePartials",
        "mergePartialsWithDiagnostics"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/relax",
    "entrypoint": "../../packages/docture/src/llm/relax.ts",
    "pages": {
      "content/docs/reference/api/llm-utilities.mdx": [
        "JsonSchemaLike",
        "relaxJsonSchema"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/pdfjs",
    "entrypoint": "../../packages/docture/src/loaders/pdfjs/index.ts",
    "pages": {
      "content/docs/reference/api/loader-pdfjs.mdx": [
        "DocumentLoaderPdfJs",
        "DocumentLoaderPdfJsOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/mupdf",
    "entrypoint": "../../packages/docture/src/loaders/mupdf/index.ts",
    "pages": {
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
    "packageName": "docture",
    "importPath": "docture/loaders/tesseract",
    "entrypoint": "../../packages/docture/src/loaders/tesseract/index.ts",
    "pages": {
      "content/docs/reference/api/loader-tesseract.mdx": [
        "DocumentLoaderTesseract",
        "DocumentLoaderTesseractOptions",
        "PageSegmentation"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/paddleocr",
    "entrypoint": "../../packages/docture/src/loaders/paddleocr/index.ts",
    "pages": {
      "content/docs/reference/api/loader-paddleocr.mdx": [
        "DocumentLoaderPaddleOcr",
        "DocumentLoaderPaddleOcrOptions",
        "ImageEngine",
        "ModelSource",
        "PADDLE_MODELS",
        "PaddleModel",
        "PaddleModelFiles",
        "RecognitionStrategy"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/raster/canvas",
    "entrypoint": "../../packages/docture/src/raster/canvas/index.ts",
    "pages": {
      "content/docs/reference/api/raster-canvas.mdx": [
        "NapiCanvasRasterizer",
        "NapiCanvasRasterizerOptions",
        "napiCanvasRasterizer"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/chunk",
    "entrypoint": "../../packages/docture/src/chunk/index.ts",
    "pages": {
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
    "packageName": "docture",
    "importPath": "docture/eval",
    "entrypoint": "../../packages/docture/src/eval/index.ts",
    "pages": {
      "content/docs/reference/api/eval.mdx": [
        "AbsentCheck",
        "Aggregate",
        "CalibrationOptions",
        "CalibrationPair",
        "CalibrationReport",
        "CalibrationSample",
        "ConversionCheck",
        "ConversionCheckKind",
        "ConversionCheckResult",
        "ConversionReport",
        "ConvertedPages",
        "FieldAggregate",
        "FieldResult",
        "FieldStatus",
        "FieldThresholdReport",
        "GateOptions",
        "GateResult",
        "OrderCheck",
        "PresentCheck",
        "RunRecord",
        "Score",
        "ScoreOptions",
        "TableCheck",
        "ThresholdCandidate",
        "aggregate",
        "calibrateFields",
        "checkConversion",
        "failures",
        "formatCalibration",
        "formatFailures",
        "formatScoreboard",
        "gate",
        "hallucinations",
        "recordRun",
        "scoreExtraction"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/testing/doubles",
    "entrypoint": "../../packages/docture/src/testing/doubles.ts",
    "pages": {
      "content/docs/reference/api/testing.mdx": [
        "failingStrategy",
        "fixedStrategy",
        "inMemoryLoader",
        "loadedDocument"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/testing/conformance",
    "entrypoint": "../../packages/docture/src/testing/conformance/index.ts",
    "pages": {
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
    "packageName": "docture",
    "importPath": "docture/testing/fixtures",
    "entrypoint": "../../packages/docture/src/testing/fixtures/index.ts",
    "pages": {
      "content/docs/reference/api/testing.mdx": [
        "ConversionCase",
        "InvoiceOptions",
        "RichDocumentExpected",
        "SyntheticDocument",
        "SyntheticInvoice",
        "SyntheticLineItem",
        "buildInvoiceData",
        "conversionCorpus",
        "formatMoney",
        "makeInvoicePdf",
        "makeRichDocumentPdf",
        "richDocumentExpected"
      ]
    }
  },
  {
    "packageName": "@docture/cli",
    "importPath": "@docture/cli",
    "entrypoint": "../../packages/cli/src/index.ts",
    "pages": {
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
    "packageName": "@docture/cli",
    "importPath": "@docture/cli/config",
    "entrypoint": "../../packages/cli/src/define-config.ts",
    "pages": {
      "content/docs/reference/api/cli.mdx": [
        "CliConverter",
        "CliExtractor",
        "DoctureConfig",
        "PaperlessCliConfig",
        "PaperlessSchemaConfig",
        "defineConfig"
      ]
    }
  },
  {
    "packageName": "@docture/cli",
    "importPath": "@docture/cli/mcp",
    "entrypoint": "../../packages/cli/src/mcp/index.ts",
    "pages": {
      "content/docs/reference/api/cli.mdx": [
        "ENGINE_RANGES",
        "McpServerOptions",
        "createMcpServer"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/node",
    "entrypoint": "../../packages/docture/src/node/index.ts",
    "pages": {
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
        "ExtractionConflict",
        "ExtractionResult",
        "Extractor",
        "ExtractorOptions",
        "FieldCitation",
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
        "createCheckedExtractor",
        "createExtractor",
        "formatFieldPath",
        "mapWithConcurrency",
        "parseFieldPath",
        "sumUsage"
      ],
      "content/docs/reference/api/core-conversion.mdx": [
        "CellSourceId",
        "CodeElement",
        "ConversionAsset",
        "ConversionAssetMode",
        "ConversionBatchItem",
        "ConversionBatchOptions",
        "ConversionFormat",
        "ConversionResult",
        "ConversionWarning",
        "ConversionWarningCode",
        "ConvertOptions",
        "ConvertedPage",
        "DoctureDocument",
        "DoctureDocumentAsset",
        "DoctureDocumentParse",
        "DocumentConverter",
        "DocumentConverterOptions",
        "DocumentElement",
        "ElementProvenance",
        "ElementSourceId",
        "EvidenceLocation",
        "EvidenceSourceId",
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
        "SourceEvidence",
        "SourceEvidenceParse",
        "SourceLine",
        "TableCellSpan",
        "TableElement",
        "createDocumentConverter",
        "defineLayoutAnalyzer",
        "isEvidenceSourceId",
        "isLineSourceId",
        "parseDoctureDocument",
        "parseSourceEvidence",
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
        "ImageLayoutBlock",
        "ImageLoader",
        "ImageSize",
        "KnownDocumentFact",
        "LayoutBlock",
        "LayoutBox",
        "LayoutRoleHint",
        "LinesFromWordsOptions",
        "LoadContext",
        "LoadRequest",
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
        "SourceResolver",
        "TextLayoutBlock",
        "TextLine",
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
        "DisposalScope",
        "ExtractionStrategy",
        "OcrFallbackOptions",
        "OcrFallbackWarning",
        "OutcomeCitation",
        "PageOcrQuality",
        "ReadDocument",
        "RoutingPolicy",
        "ScopedDisposable",
        "StrategyContext",
        "StrategyOutcome",
        "createDisposalScope",
        "declarationOrder",
        "defineStrategy",
        "readDocument",
        "runPipeline",
        "withOcrFallback"
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
        "MissingComponentError",
        "MissingEngineError",
        "ModelOutputError",
        "NoConvertibleContentError",
        "NoEligibleLoaderError",
        "NoEligibleStrategyError",
        "PageSelectionError",
        "SplitFailedError",
        "TimeoutError",
        "UnclassifiedGroupError",
        "UnsupportedSourceError",
        "errorCodeOf",
        "isAbortError",
        "isDoctureError",
        "messageOf"
      ],
      "content/docs/reference/api/node.mdx": [
        "resolveNodeSource"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/mammoth",
    "entrypoint": "../../packages/docture/src/loaders/mammoth/index.ts",
    "pages": {
      "content/docs/reference/api/loader-mammoth.mdx": [
        "DocumentLoaderMammoth",
        "MammothDocumentError"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/tool",
    "entrypoint": "../../packages/docture/src/llm/tool.ts",
    "pages": {
      "content/docs/reference/api/llm-tool.mdx": [
        "ExtractToolOptions",
        "ExtractionToolInput",
        "ExtractionToolResult",
        "extractTool"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/inputs/email",
    "entrypoint": "../../packages/docture/src/inputs/email/index.ts",
    "pages": {
      "content/docs/reference/api/inputs-email.mdx": [
        "EmailInputError",
        "EmailPart",
        "ExpandEmailOptions",
        "ExpandedEmail",
        "expandEmail"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/azure-di",
    "entrypoint": "../../packages/docture/src/loaders/azure-di/index.ts",
    "pages": {
      "content/docs/reference/api/loader-azure-di.mdx": [
        "AzureReadAuthentication",
        "AzureReadError",
        "DocumentLoaderAzureRead",
        "DocumentLoaderAzureReadOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/sources/paperless",
    "entrypoint": "../../packages/docture/src/sources/paperless/index.ts",
    "pages": {
      "content/docs/reference/api/sources-paperless.mdx": [
        "PaperlessApiVersion",
        "PaperlessConnectionOptions",
        "PaperlessContextEntry",
        "PaperlessContextKind",
        "PaperlessCustomFieldDefinition",
        "PaperlessDocument",
        "PaperlessError",
        "PaperlessFailure",
        "PaperlessFieldType",
        "PaperlessFieldValue",
        "PaperlessMetadata",
        "PaperlessNamedObject",
        "PaperlessNote",
        "PaperlessProvenance",
        "PaperlessQueryOptions",
        "PaperlessReadOptions",
        "PaperlessSource",
        "PaperlessSourceResult",
        "PaperlessValue",
        "PaperlessVersion",
        "paperlessSource"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/import/docling",
    "entrypoint": "../../packages/docture/src/import/docling/index.ts",
    "pages": {
      "content/docs/reference/api/import-docling.mdx": [
        "DoclingDiagnostic",
        "DoclingImportError",
        "DoclingImportLimits",
        "DoclingImportOptions",
        "DoclingNativeSource",
        "DoclingProvenance",
        "ImportedDoclingDocument",
        "importDoclingDocument"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/docling",
    "entrypoint": "../../packages/docture/src/loaders/docling/index.ts",
    "pages": {
      "content/docs/reference/api/loader-docling.mdx": [
        "DoclingConversion",
        "DoclingConversionOptions",
        "DoclingJob",
        "DoclingJobReference",
        "DoclingServeClient",
        "DoclingServeError",
        "DoclingServeFailure",
        "DoclingServeOptions",
        "DoclingTaskStatus",
        "DoclingTransportOptions",
        "DocumentLoaderDoclingServe",
        "DocumentLoaderDoclingServeOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/sinks/paperless",
    "entrypoint": "../../packages/docture/src/sinks/paperless/index.ts",
    "pages": {
      "content/docs/reference/api/sinks-paperless.mdx": [
        "PaperlessApplyResult",
        "PaperlessCustomFieldDefinition",
        "PaperlessError",
        "PaperlessEvidencePolicy",
        "PaperlessFieldMapping",
        "PaperlessFieldType",
        "PaperlessOperation",
        "PaperlessOperationOutcome",
        "PaperlessPlan",
        "PaperlessPlanExtraction",
        "PaperlessPlanInput",
        "PaperlessPlanIssue",
        "PaperlessPlannedSkip",
        "PaperlessProvenance",
        "PaperlessSink",
        "PaperlessSinkOptions",
        "PaperlessValue",
        "paperlessSink"
      ]
    }
  },
  {
    "packageName": "@docture/cli",
    "importPath": "@docture/cli/service",
    "entrypoint": "../../packages/cli/src/service/index.ts",
    "pages": {
      "content/docs/reference/api/service.mdx": [
        "HttpService",
        "HttpServiceAddress",
        "HttpServiceOptions",
        "createHttpService"
      ]
    }
  }
];
