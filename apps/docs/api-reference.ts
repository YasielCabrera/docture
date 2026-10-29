export interface ApiEntrypointInventory {
  readonly packageName: "docture" | "@docture/cli" | "@docture/eval" | "@docture/synthetic";
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
      "content/docs/extraction/reference/validation.mdx": [
        "Attempt",
        "RepairInput",
        "ValidationIssue"
      ],
      "content/docs/extraction/reference/results.mdx": [
        "AttemptStatus",
        "ConflictingValue",
        "EMPTY_USAGE",
        "ValidationOutcome",
        "formatFieldPath",
        "parseFieldPath",
        "sumUsage"
      ],
      "content/docs/extraction/reference/batches.mdx": [
        "BatchItem",
        "BatchOptions",
        "mapWithConcurrency"
      ],
      "content/docs/extraction/reference/citations.mdx": [
        "CitationStatus",
        "FieldCitation"
      ],
      "content/docs/extraction/reference/extractor.mdx": [
        "DocumentExtractor",
        "ExtractionResult",
        "Extractor",
        "ExtractorOptions",
        "LoadLlmOptions",
        "ModelBackend",
        "PipelineComponents",
        "RuleFailureMode",
        "RunOptions",
        "SafeExtraction",
        "ValidationRule",
        "createCheckedExtractor",
        "createExtractor"
      ],
      "content/docs/extraction/reference/partials.mdx": [
        "ExtractionConflict"
      ],
      "content/docs/extraction/reference/cache-pricing.mdx": [
        "Usage"
      ],
      "content/docs/conversion/reference/evidence.mdx": [
        "CellSourceId",
        "ElementSourceId",
        "EvidenceLocation",
        "EvidenceSourceId",
        "LineSourceId",
        "SourceEvidence",
        "SourceEvidenceParse",
        "SourceLine",
        "isEvidenceSourceId",
        "isLineSourceId",
        "parseSourceEvidence",
        "sourceLines"
      ],
      "content/docs/conversion/reference/layout.mdx": [
        "CodeElement",
        "DocumentElement",
        "ElementProvenance",
        "FigureElement",
        "FurnitureEvidence",
        "HeadingElement",
        "InlineText",
        "LayoutPage",
        "ListElement",
        "PageBreakElement",
        "PageFooterElement",
        "PageHeaderElement",
        "ParagraphElement",
        "TableCellSpan",
        "TableElement"
      ],
      "content/docs/conversion/reference/converter.mdx": [
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
        "DocumentConverter",
        "DocumentConverterOptions",
        "SafeConversion",
        "createDocumentConverter"
      ],
      "content/docs/conversion/reference/document-json.mdx": [
        "DoctureDocument",
        "DoctureDocumentAsset",
        "DoctureDocumentParse",
        "parseDoctureDocument"
      ],
      "content/docs/conversion/reference/analyzers.mdx": [
        "LayoutAnalysis",
        "LayoutAnalyzer",
        "LayoutAnalyzerContext",
        "LayoutAnnotation",
        "LayoutDocument",
        "LayoutElementRole",
        "defineLayoutAnalyzer"
      ],
      "content/docs/conversion/reference/chunk.mdx": [
        "ProvenanceSegment"
      ],
      "content/docs/conversion/reference/continuations.mdx": [
        "provenanceSegments"
      ],
      "content/docs/extraction/reference/contracts.mdx": [
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
      "content/docs/getting-started/reference/documents.mdx": [
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
      "content/docs/extraction/reference/strategies.mdx": [
        "ClassificationNeed",
        "ClassificationStrategy",
        "CompletionStrategy",
        "ExtractionStrategy",
        "OutcomeCitation",
        "RoutingPolicy",
        "StrategyContext",
        "StrategyOutcome",
        "declarationOrder",
        "defineStrategy"
      ],
      "content/docs/extraction/reference/pipeline.mdx": [
        "DisposalScope",
        "OcrFallbackOptions",
        "OcrFallbackWarning",
        "PageOcrQuality",
        "ReadDocument",
        "ScopedDisposable",
        "createDisposalScope",
        "readDocument",
        "runPipeline",
        "withOcrFallback"
      ],
      "content/docs/extraction/reference/classification.mdx": [
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
        "Process",
        "classificationNode",
        "classificationOf",
        "classificationTree",
        "defineClassification",
        "defineClassifier",
        "extractionContractOf",
        "flattenTree",
        "isClassificationTree",
        "ClassificationResult",
        "ClassificationSignal"
      ],
      "content/docs/extraction/reference/splitting.mdx": [
        "DocGroup",
        "DocGroups",
        "ProcessExtractOptions",
        "RunSplitterOptions",
        "SplitContext",
        "SplitReport",
        "SplitVerdict",
        "SplittingStrategy",
        "UNCLASSIFIED",
        "aggregateDocGroups",
        "defineSplitter",
        "pageWindows",
        "runSplitter"
      ],
      "content/docs/extraction/reference/model-splitting.mdx": [
        "Splitter"
      ],
      "content/docs/resources/errors.mdx": [
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
      "content/docs/extraction/reference/model-splitting.mdx": [
        "ImageSplitter",
        "SplitterOptions",
        "TextSplitter",
        "imageSplitter",
        "textSplitter"
      ],
      "content/docs/extraction/reference/models.mdx": [
        "LLM",
        "LlmClassifier",
        "LlmExtractorOptions",
        "LlmOptions",
        "createLlmExtractor",
        "llm",
        "model",
        "modelIdOf",
        "vision"
      ],
      "content/docs/extraction/reference/model-classification.mdx": [
        "LlmClassifierOptions",
        "llmClassifier"
      ],
      "content/docs/conversion/reference/model-layout.mdx": [
        "LlmLayoutAnalyzer",
        "LlmLayoutAnalyzerOptions",
        "llmLayout"
      ],
      "content/docs/extraction/reference/partials.mdx": [
        "LlmStrategy",
        "Chunk",
        "ChunkContext",
        "JsonSchemaLike",
        "MergeDiagnostics",
        "MergePart",
        "chunkByBudget",
        "chunkByPage",
        "estimateTokens",
        "mergePartials",
        "mergePartialsWithDiagnostics",
        "relaxJsonSchema"
      ],
      "content/docs/extraction/reference/text.mdx": [
        "LlmStrategyOptions"
      ],
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ],
      "content/docs/extraction/reference/vision.mdx": [
        "VisionStrategy",
        "VisionStrategyOptions"
      ],
      "content/docs/extraction/reference/prompts.mdx": [
        "BuildPromptOptions",
        "DEFAULT_SYSTEM_PROMPT",
        "PromptParts",
        "buildPrompt",
        "wrapUntrusted"
      ],
      "content/docs/extraction/reference/cache-pricing.mdx": [
        "CacheKeyParts",
        "CachedResponse",
        "ContentPart",
        "LlmCache",
        "ModelPricing",
        "PricingTable",
        "RawUsage",
        "cacheKey",
        "fileCache",
        "fingerprint",
        "lookupPricing",
        "memoryCache",
        "toUsage"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/text",
    "entrypoint": "../../packages/docture/src/llm/text.ts",
    "pages": {
      "content/docs/extraction/reference/partials.mdx": [
        "LlmStrategy"
      ],
      "content/docs/extraction/reference/text.mdx": [
        "LlmStrategyOptions"
      ],
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ],
      "content/docs/extraction/reference/models.mdx": [
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
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ],
      "content/docs/extraction/reference/vision.mdx": [
        "VisionStrategy",
        "VisionStrategyOptions"
      ],
      "content/docs/extraction/reference/models.mdx": [
        "vision"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/classifier",
    "entrypoint": "../../packages/docture/src/llm/classifier.ts",
    "pages": {
      "content/docs/extraction/reference/models.mdx": [
        "LlmClassifier"
      ],
      "content/docs/extraction/reference/model-classification.mdx": [
        "LlmClassifierOptions",
        "llmClassifier"
      ],
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/layout",
    "entrypoint": "../../packages/docture/src/llm/layout.ts",
    "pages": {
      "content/docs/conversion/reference/model-layout.mdx": [
        "LlmLayoutAnalyzer",
        "LlmLayoutAnalyzerOptions",
        "llmLayout"
      ],
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/split",
    "entrypoint": "../../packages/docture/src/llm/split.ts",
    "pages": {
      "content/docs/extraction/reference/model-splitting.mdx": [
        "ImageSplitter",
        "SplitterOptions",
        "TextSplitter",
        "imageSplitter",
        "textSplitter"
      ],
      "content/docs/extraction/reference/telemetry.mdx": [
        "LlmTelemetryOptions"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/extractor",
    "entrypoint": "../../packages/docture/src/llm/extractor.ts",
    "pages": {
      "content/docs/extraction/reference/models.mdx": [
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
      "content/docs/extraction/reference/cache-pricing.mdx": [
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
      "content/docs/extraction/reference/cache-pricing.mdx": [
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
      "content/docs/extraction/reference/prompts.mdx": [
        "BuildPromptOptions",
        "DEFAULT_SYSTEM_PROMPT",
        "PromptParts",
        "buildPrompt",
        "wrapUntrusted"
      ],
      "content/docs/extraction/reference/partials.mdx": [
        "Chunk",
        "ChunkContext",
        "chunkByBudget",
        "chunkByPage",
        "estimateTokens"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/llm/merge",
    "entrypoint": "../../packages/docture/src/llm/merge.ts",
    "pages": {
      "content/docs/extraction/reference/partials.mdx": [
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
      "content/docs/extraction/reference/partials.mdx": [
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
      "content/docs/integrations/pdfjs.mdx": [
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
      "content/docs/integrations/mupdf.mdx": [
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
      "content/docs/integrations/tesseract.mdx": [
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
      "content/docs/integrations/paddleocr.mdx": [
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
      "content/docs/integrations/canvas.mdx": [
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
      "content/docs/conversion/reference/chunk.mdx": [
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
    "importPath": "docture/testing/doubles",
    "entrypoint": "../../packages/docture/src/testing/doubles.ts",
    "pages": {
      "content/docs/resources/testing-api.mdx": [
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
      "content/docs/resources/testing-api.mdx": [
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
      "content/docs/resources/testing-api.mdx": [
        "ConversionCase",
        "ConversionCaseCheck",
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
      "content/docs/cli/reference/cli.mdx": [
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
      "content/docs/cli/reference/cli.mdx": [
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
      "content/docs/cli/reference/cli.mdx": [
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
      "content/docs/extraction/reference/validation.mdx": [
        "Attempt",
        "RepairInput",
        "ValidationIssue"
      ],
      "content/docs/extraction/reference/results.mdx": [
        "AttemptStatus",
        "ConflictingValue",
        "EMPTY_USAGE",
        "ValidationOutcome",
        "formatFieldPath",
        "parseFieldPath",
        "sumUsage"
      ],
      "content/docs/extraction/reference/batches.mdx": [
        "BatchItem",
        "BatchOptions",
        "mapWithConcurrency"
      ],
      "content/docs/extraction/reference/citations.mdx": [
        "CitationStatus",
        "FieldCitation"
      ],
      "content/docs/extraction/reference/extractor.mdx": [
        "DocumentExtractor",
        "ExtractionResult",
        "Extractor",
        "ExtractorOptions",
        "LoadLlmOptions",
        "ModelBackend",
        "PipelineComponents",
        "RuleFailureMode",
        "RunOptions",
        "SafeExtraction",
        "ValidationRule",
        "createCheckedExtractor",
        "createExtractor"
      ],
      "content/docs/extraction/reference/partials.mdx": [
        "ExtractionConflict"
      ],
      "content/docs/extraction/reference/cache-pricing.mdx": [
        "Usage"
      ],
      "content/docs/conversion/reference/evidence.mdx": [
        "CellSourceId",
        "ElementSourceId",
        "EvidenceLocation",
        "EvidenceSourceId",
        "LineSourceId",
        "SourceEvidence",
        "SourceEvidenceParse",
        "SourceLine",
        "isEvidenceSourceId",
        "isLineSourceId",
        "parseSourceEvidence",
        "sourceLines"
      ],
      "content/docs/conversion/reference/layout.mdx": [
        "CodeElement",
        "DocumentElement",
        "ElementProvenance",
        "FigureElement",
        "FurnitureEvidence",
        "HeadingElement",
        "InlineText",
        "LayoutPage",
        "ListElement",
        "PageBreakElement",
        "PageFooterElement",
        "PageHeaderElement",
        "ParagraphElement",
        "TableCellSpan",
        "TableElement"
      ],
      "content/docs/conversion/reference/converter.mdx": [
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
        "DocumentConverter",
        "DocumentConverterOptions",
        "SafeConversion",
        "createDocumentConverter"
      ],
      "content/docs/conversion/reference/document-json.mdx": [
        "DoctureDocument",
        "DoctureDocumentAsset",
        "DoctureDocumentParse",
        "parseDoctureDocument"
      ],
      "content/docs/conversion/reference/analyzers.mdx": [
        "LayoutAnalysis",
        "LayoutAnalyzer",
        "LayoutAnalyzerContext",
        "LayoutAnnotation",
        "LayoutDocument",
        "LayoutElementRole",
        "defineLayoutAnalyzer"
      ],
      "content/docs/conversion/reference/chunk.mdx": [
        "ProvenanceSegment"
      ],
      "content/docs/conversion/reference/continuations.mdx": [
        "provenanceSegments"
      ],
      "content/docs/extraction/reference/contracts.mdx": [
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
      "content/docs/getting-started/reference/documents.mdx": [
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
      "content/docs/extraction/reference/strategies.mdx": [
        "ClassificationNeed",
        "ClassificationStrategy",
        "CompletionStrategy",
        "ExtractionStrategy",
        "OutcomeCitation",
        "RoutingPolicy",
        "StrategyContext",
        "StrategyOutcome",
        "declarationOrder",
        "defineStrategy"
      ],
      "content/docs/extraction/reference/pipeline.mdx": [
        "DisposalScope",
        "OcrFallbackOptions",
        "OcrFallbackWarning",
        "PageOcrQuality",
        "ReadDocument",
        "ScopedDisposable",
        "createDisposalScope",
        "readDocument",
        "runPipeline",
        "withOcrFallback"
      ],
      "content/docs/extraction/reference/classification.mdx": [
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
        "Process",
        "classificationNode",
        "classificationOf",
        "classificationTree",
        "defineClassification",
        "defineClassifier",
        "extractionContractOf",
        "flattenTree",
        "isClassificationTree",
        "ClassificationResult",
        "ClassificationSignal"
      ],
      "content/docs/extraction/reference/splitting.mdx": [
        "DocGroup",
        "DocGroups",
        "ProcessExtractOptions",
        "RunSplitterOptions",
        "SplitContext",
        "SplitReport",
        "SplitVerdict",
        "SplittingStrategy",
        "UNCLASSIFIED",
        "aggregateDocGroups",
        "defineSplitter",
        "pageWindows",
        "runSplitter"
      ],
      "content/docs/extraction/reference/model-splitting.mdx": [
        "Splitter"
      ],
      "content/docs/resources/errors.mdx": [
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
      "content/docs/getting-started/reference/node.mdx": [
        "resolveNodeSource"
      ]
    }
  },
  {
    "packageName": "docture",
    "importPath": "docture/loaders/mammoth",
    "entrypoint": "../../packages/docture/src/loaders/mammoth/index.ts",
    "pages": {
      "content/docs/integrations/mammoth.mdx": [
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
      "content/docs/integrations/ai-sdk-tool.mdx": [
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
      "content/docs/integrations/email.mdx": [
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
      "content/docs/integrations/azure-read.mdx": [
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
      "content/docs/integrations/paperless-read.mdx": [
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
      "content/docs/integrations/docling-import.mdx": [
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
      "content/docs/integrations/docling-serve.mdx": [
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
      "content/docs/integrations/paperless-updates.mdx": [
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
      "content/docs/cli/reference/service.mdx": [
        "HttpService",
        "HttpServiceAddress",
        "HttpServiceOptions",
        "createHttpService"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval",
    "entrypoint": "../../packages/eval/src/index.ts",
    "pages": {
      "content/docs/evaluation/reference/types.mdx": [
        "AlignmentAlgorithm",
        "AlignmentReport",
        "Assertion",
        "AssertionOutcome",
        "AssertionResult",
        "Box",
        "CalibrationBin",
        "CalibrationStats",
        "CalibrationSummary",
        "CaseDelta",
        "CaseDocument",
        "CompareContext",
        "Comparison",
        "ConfidenceCount",
        "CoveragePoint",
        "DEFAULT_MAX_CELLS",
        "DatasetError",
        "DateGranularity",
        "DateOptions",
        "DeltaVerdict",
        "EpochSummary",
        "ErroredCase",
        "EvidenceRef",
        "ExactNormalization",
        "ExpectedLocation",
        "ExperimentComparison",
        "FieldEvidence",
        "FieldGroupSummary",
        "FieldResult",
        "FieldRule",
        "FieldRuleOptions",
        "FieldSource",
        "FieldStatus",
        "FieldType",
        "GateCheck",
        "GateThreshold",
        "GroundTruthError",
        "GroundTruthIssue",
        "GroundTruthIssueCode",
        "GroundingCounts",
        "GroundingRule",
        "GroundingScore",
        "GroundingSummary",
        "InvalidCaseTruth",
        "JsonObject",
        "MetricContext",
        "MetricDefinition",
        "MetricDelta",
        "MetricValues",
        "MigrationGuardError",
        "NullHandling",
        "NumberOptions",
        "OmittedCount",
        "OmittedLeaves",
        "OutOfScopeError",
        "OutcomeChange",
        "PathDelta",
        "PreflightError",
        "Prf",
        "PrfScope",
        "Progress",
        "RESULT_FORMAT",
        "RESULT_VERSION",
        "RawKey",
        "RepairHint",
        "ResolvedArray",
        "ResolvedField",
        "ResolvedFieldInfo",
        "ResolvedGroundingRule",
        "RunIndexEntry",
        "RunStoreFailure",
        "SchemaInput",
        "ScoreExtras",
        "ScoredCase",
        "SegmentScore",
        "SkippedCase",
        "SliceFilter",
        "SliceMap",
        "SliceValue",
        "SpecInfo",
        "SpecProblem",
        "SpecProblemCode",
        "StatusCounts",
        "StoredRaw",
        "StoredRun",
        "Summary",
        "TextOptions",
        "UsageInfo",
        "ValidationResult"
      ],
      "content/docs/evaluation/reference/arrays.mdx": [
        "ArrayRule",
        "byIndex",
        "hungarian",
        "number",
        "ordered"
      ],
      "content/docs/evaluation/reference/gates.mdx": [
        "BaselineQuery",
        "EvalSpecError",
        "GateOptions",
        "GateResult",
        "gate",
        "resolveBaseline"
      ],
      "content/docs/evaluation/reference/results.mdx": [
        "BuildResultInput",
        "CaseResult",
        "RunInfo",
        "RunStoreError",
        "buildResult",
        "parseCaseResult",
        "parseEvalResult",
        "parseRunInfo"
      ],
      "content/docs/evaluation/reference/calibration.mdx": [
        "CalibrationReport"
      ],
      "content/docs/evaluation/reference/specs.mdx": [
        "CaseScore",
        "EvalRules",
        "JsonSchemaObject",
        "LooseEvalOptions",
        "date",
        "defineEval",
        "identifier",
        "looseEval"
      ],
      "content/docs/evaluation/reference/judges.mdx": [
        "Comparator"
      ],
      "content/docs/evaluation/reference/core.mdx": [
        "Dataset",
        "EvalCase",
        "Reporter",
        "defineReporter",
        "inMemoryDataset"
      ],
      "content/docs/evaluation/reference/processors.mdx": [
        "EvalExtractor"
      ],
      "content/docs/evaluation/reference/grounding.mdx": [
        "EvalResult",
        "GroundingReport"
      ],
      "content/docs/evaluation/reference/datasets.mdx": [
        "EvalSpec",
        "WritableDataset"
      ],
      "content/docs/evaluation/reference/runner.mdx": [
        "ExtractContext",
        "ExtractOutput"
      ],
      "content/docs/evaluation/reference/comparison.mdx": [
        "IncomparableRunsError",
        "RunComparison",
        "exact"
      ],
      "content/docs/evaluation/reference/utilities.mdx": [
        "JsonValue",
        "PathSegment",
        "SliceSpec",
        "TagValue",
        "canonicalJson",
        "compareCodeUnits",
        "fingerprintOf",
        "formatPath",
        "patternOf",
        "sliceValues",
        "toJsonValue"
      ],
      "content/docs/evaluation/reference/reporters-template.mdx": [
        "MetricFormat",
        "MetricInfo"
      ],
      "content/docs/evaluation/reference/config.mdx": [
        "RunStore"
      ],
      "content/docs/evaluation/reference/comparators.mdx": [
        "boxIoU",
        "defineComparator",
        "describeComparator",
        "intersectionOverUnion",
        "oneOf",
        "setOf"
      ],
      "content/docs/evaluation/reference/metrics.mdx": [
        "builtinMetrics",
        "defineAssertion",
        "defineMetric",
        "groundingRule",
        "isGrounded",
        "omittedOf",
        "percentile",
        "prf",
        "prfMetricId",
        "prfOf",
        "runScopeOmissions",
        "sumOf",
        "supportsLocation"
      ],
      "content/docs/evaluation/reference/conversion.mdx": [
        "text"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/config",
    "entrypoint": "../../packages/eval/src/config.ts",
    "pages": {
      "content/docs/evaluation/reference/config.mdx": [
        "EvalConfig",
        "defineEvalConfig"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/dataset",
    "entrypoint": "../../packages/eval/src/dataset/index.ts",
    "pages": {
      "content/docs/evaluation/reference/datasets.mdx": [
        "DraftableDataset",
        "Migration",
        "MigrationDiff",
        "MigrationReport",
        "PendingCase",
        "SampleOptions",
        "caseFingerprint",
        "defineMigration",
        "draftExpected",
        "runMigration",
        "sample"
      ],
      "content/docs/evaluation/reference/gates.mdx": [
        "datasetFingerprint"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/runner",
    "entrypoint": "../../packages/eval/src/runner/index.ts",
    "pages": {
      "content/docs/evaluation/reference/processors.mdx": [
        "EvalExtractor"
      ],
      "content/docs/evaluation/reference/runner.mdx": [
        "ExtractContext",
        "ExtractOutput",
        "RescoreOptions",
        "ResultOptions",
        "ResultSection",
        "RunEvalOptions",
        "memoryRunStore",
        "rescore",
        "runEval"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/node",
    "entrypoint": "../../packages/eval/src/node/index.ts",
    "pages": {
      "content/docs/evaluation/reference/storage.mdx": [
        "FolderDatasetOptions",
        "LiveArtifact",
        "fileDocument",
        "fileRunStore",
        "folderDataset",
        "gitInfo",
        "jsonlDataset",
        "liveArtifact",
        "readEvalResult",
        "runDirectory",
        "writeEvalResult",
        "writeFileAtomic"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/docture",
    "entrypoint": "../../packages/eval/src/docture/index.ts",
    "pages": {
      "content/docs/evaluation/reference/processors.mdx": [
        "FromDoctureOptions",
        "FromDoctureProjection",
        "fromDocture"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/compare",
    "entrypoint": "../../packages/eval/src/comparison/index.ts",
    "pages": {
      "content/docs/evaluation/reference/comparison.mdx": [
        "CompareOptions",
        "compareRuns"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/calibration",
    "entrypoint": "../../packages/eval/src/calibration/index.ts",
    "pages": {
      "content/docs/evaluation/reference/calibration.mdx": [
        "CalibrationOptions",
        "calibrate",
        "calibrationSection",
        "mergeCalibration"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/grounding",
    "entrypoint": "../../packages/eval/src/grounding/index.ts",
    "pages": {
      "content/docs/evaluation/reference/grounding.mdx": [
        "GroundingOptions",
        "grounding",
        "groundingSection"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/terminal",
    "entrypoint": "../../packages/eval/src/reporters/terminal/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-csv.mdx": [
        "CellValue",
        "Column",
        "defaultColumns",
        "defineColumn"
      ],
      "content/docs/evaluation/reference/reporters-terminal.mdx": [
        "ScoreboardOptions",
        "TerminalReporterOptions",
        "TerminalStream",
        "renderScoreboard",
        "terminalReporter"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/json",
    "entrypoint": "../../packages/eval/src/reporters/json/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-json.mdx": [
        "JsonReporterOptions",
        "jsonReporter",
        "renderJson",
        "renderJsonSplit"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/markdown",
    "entrypoint": "../../packages/eval/src/reporters/markdown/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-csv.mdx": [
        "CellValue",
        "Column",
        "defaultColumns",
        "defineColumn"
      ],
      "content/docs/evaluation/reference/reporters-markdown.mdx": [
        "MarkdownHelpers",
        "MarkdownOptions",
        "MarkdownReporterOptions",
        "MarkdownSection",
        "TableView",
        "escapeMarkdown",
        "markdownReporter",
        "md",
        "renderMarkdown"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/csv",
    "entrypoint": "../../packages/eval/src/reporters/csv/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-csv.mdx": [
        "CellValue",
        "Column",
        "CsvOptions",
        "CsvReporterOptions",
        "csvCell",
        "csvReporter",
        "defaultColumns",
        "defineColumn",
        "renderCsv"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/junit",
    "entrypoint": "../../packages/eval/src/reporters/junit/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-junit.mdx": [
        "JunitOptions",
        "JunitReporterOptions",
        "escapeXml",
        "junitReporter",
        "renderJunit"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/html",
    "entrypoint": "../../packages/eval/src/reporters/html/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-html.mdx": [
        "Bar",
        "BarData",
        "DocumentRow",
        "HTML_IDS",
        "HtmlOptions",
        "HtmlPanel",
        "HtmlParts",
        "HtmlReporterOptions",
        "HtmlTheme",
        "HtmlView",
        "PanelData",
        "SectionData",
        "Tile",
        "TileData",
        "Tone",
        "embedJson",
        "htmlReporter",
        "renderHtml",
        "scoreTone"
      ],
      "content/docs/evaluation/reference/reporters-csv.mdx": [
        "CellValue",
        "Column",
        "defaultColumns",
        "defineColumn"
      ],
      "content/docs/evaluation/reference/reporters-terminal.mdx": [
        "panel"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/reporters/template",
    "entrypoint": "../../packages/eval/src/reporters/template/index.ts",
    "pages": {
      "content/docs/evaluation/reference/reporters-markdown.mdx": [
        "TableView"
      ],
      "content/docs/evaluation/reference/reporters-template.mdx": [
        "TemplateHelpers",
        "TemplateRender",
        "TemplateReporterOptions",
        "renderTemplate",
        "templateHelpers",
        "templateReporter"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/judge",
    "entrypoint": "../../packages/eval/src/judge/index.ts",
    "pages": {
      "content/docs/evaluation/reference/judges.mdx": [
        "ENGINE_RANGES",
        "JudgeCache",
        "JudgeOptions",
        "judge"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/vitest",
    "entrypoint": "../../packages/eval/src/adapters/vitest/index.ts",
    "pages": {
      "content/docs/evaluation/reference/frameworks.mdx": [
        "DescribeEvalHost",
        "ExtractionMatchers",
        "MatchExtractionOptions",
        "describeEval",
        "extractionMatchers",
        "toMatchExtraction"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/evalite",
    "entrypoint": "../../packages/eval/src/adapters/evalite/index.ts",
    "pages": {
      "content/docs/evaluation/reference/frameworks.mdx": [
        "extractionScorer"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/promptfoo",
    "entrypoint": "../../packages/eval/src/adapters/promptfoo/index.ts",
    "pages": {
      "content/docs/evaluation/reference/frameworks.mdx": [
        "extractionAssertion"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/autoevals",
    "entrypoint": "../../packages/eval/src/adapters/autoevals/index.ts",
    "pages": {
      "content/docs/evaluation/reference/frameworks.mdx": [
        "ExtractionF1"
      ]
    }
  },
  {
    "packageName": "@docture/eval",
    "importPath": "@docture/eval/conversion",
    "entrypoint": "../../packages/eval/src/conversion/index.ts",
    "pages": {
      "content/docs/evaluation/reference/conversion.mdx": [
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
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic",
    "entrypoint": "../../packages/synthetic/src/index.ts",
    "pages": {
      "content/docs/synthetic/reference/models.mdx": [
        "ArrayLength",
        "ConcretePath",
        "FieldSpec",
        "Fields",
        "GenContext",
        "InferSchema",
        "JsonSchema",
        "Mask",
        "ModelOptions",
        "PageSize",
        "Rendition",
        "SampleOptions",
        "Scenario",
        "SchemaSource",
        "TagValue",
        "TypedJsonSchema",
        "ValueAt",
        "defineModel",
        "readSchema",
        "typedJsonSchema"
      ],
      "content/docs/synthetic/reference/templates.mdx": [
        "At",
        "Flag",
        "FontSource",
        "Formatter",
        "Locale",
        "ObjectMask",
        "Printed",
        "PrintedMask",
        "Projection",
        "RenderingTemplate",
        "Surface",
        "SynthTemplate",
        "TableColumn",
        "TableOptions",
        "TemplateDefinition",
        "TextStyle",
        "defaultFonts",
        "defineTemplate",
        "drawTable",
        "formatter",
        "locales",
        "pageSizes",
        "prints",
        "project",
        "selectTemplates"
      ],
      "content/docs/synthetic/reference/constraints.mdx": [
        "Constraint",
        "PathPattern",
        "PathSegment",
        "Stream",
        "formatPath",
        "formatPattern",
        "ibanCheckDigits",
        "isValidIban",
        "isValidLuhn",
        "luhnCheckDigit",
        "parsePath",
        "streamFor",
        "sumOf",
        "unique",
        "validIban",
        "validLuhn",
        "valuesAt"
      ],
      "content/docs/synthetic/reference/documents.mdx": [
        "FieldLabel",
        "PageInfo",
        "SynthConfig",
        "SynthRendition",
        "SyntheticCase",
        "caseIdOf",
        "defineSynthConfig",
        "groupOf",
        "locationsOf",
        "severityBucket",
        "toEvalCase"
      ],
      "content/docs/synthetic/reference/text-generators.mdx": [
        "Generator",
        "gen"
      ],
      "content/docs/synthetic/reference/errors.mdx": [
        "LabelFailure",
        "LabelFailureKind",
        "LabelVerificationError",
        "SynthesisError",
        "SynthesisProblem",
        "TemplateError",
        "TemplateProblem",
        "TemplateProblemCode",
        "constraint",
        "scenario"
      ],
      "content/docs/synthetic/reference/index.mdx": [
        "Model"
      ],
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "Sample",
        "SyntheticDocument",
        "Template"
      ],
      "content/docs/synthetic/reference/verify.mdx": [
        "before"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/pdfkit",
    "entrypoint": "../../packages/synthetic/src/pdfkit/index.ts",
    "pages": {
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "ENGINE_RANGES",
        "RenderPdfOptions",
        "renderPdf",
        "renderTemplate"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/verify",
    "entrypoint": "../../packages/synthetic/src/verify/index.ts",
    "pages": {
      "content/docs/synthetic/reference/verify.mdx": [
        "VerifiableDocument",
        "VerificationReport",
        "VerifyOptions",
        "assertVerified",
        "verifyLabels"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/measure",
    "entrypoint": "../../packages/synthetic/src/measure/index.ts",
    "pages": {
      "content/docs/synthetic/reference/measure.mdx": [
        "CompareOptions",
        "LayoutComparison",
        "LayoutSource",
        "LineDrift",
        "MeasuredLine",
        "MeasuredPage",
        "Measurement",
        "PlacedLine",
        "RepeatedLine",
        "compareLayouts",
        "measurePdf"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/degrade",
    "entrypoint": "../../packages/synthetic/src/degrade/index.ts",
    "pages": {
      "content/docs/synthetic/reference/degrade.mdx": [
        "BedKnobs",
        "DegradeOptions",
        "EncodeKnobs",
        "GeometryKnobs",
        "Matrix",
        "PaperKnobs",
        "Profile",
        "ProfileKey",
        "Range",
        "ResolvedKnobs",
        "Rgb",
        "degrade",
        "profiles",
        "transformBox"
      ],
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "ENGINE_RANGES"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/faker",
    "entrypoint": "../../packages/synthetic/src/faker/index.ts",
    "pages": {
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "ENGINE_RANGES"
      ],
      "content/docs/synthetic/reference/text-generators.mdx": [
        "fakerFor"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/node",
    "entrypoint": "../../packages/synthetic/src/node/index.ts",
    "pages": {
      "content/docs/synthetic/reference/node.mdx": [
        "CorpusPlan",
        "CorpusReport",
        "RenditionSpec",
        "scanLq",
        "writeCorpus"
      ],
      "content/docs/synthetic/reference/verify.mdx": [
        "digital"
      ],
      "content/docs/synthetic/reference/degrade.mdx": [
        "fax",
        "photo",
        "scan"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/llm",
    "entrypoint": "../../packages/synthetic/src/llm/index.ts",
    "pages": {
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "ENGINE_RANGES"
      ],
      "content/docs/synthetic/reference/text-generators.mdx": [
        "TextPoolCache",
        "TextPoolOptions",
        "llmTextPool"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/react-pdf",
    "entrypoint": "../../packages/synthetic/src/react-pdf/index.ts",
    "pages": {
      "content/docs/synthetic/reference/react-pdf.mdx": [
        "ENGINE_RANGES",
        "FieldComponent",
        "FieldPath",
        "FieldProps",
        "ReactFont",
        "ReactTemplate",
        "ReactTemplateDefinition",
        "ReactTemplateProps",
        "RenderReactPdfOptions",
        "Field",
        "defineReactTemplate",
        "renderReactPdf"
      ]
    }
  },
  {
    "packageName": "@docture/synthetic",
    "importPath": "@docture/synthetic/html",
    "entrypoint": "../../packages/synthetic/src/html/index.ts",
    "pages": {
      "content/docs/synthetic/reference/pdfkit.mdx": [
        "ENGINE_RANGES"
      ],
      "content/docs/synthetic/reference/html.mdx": [
        "HtmlTemplate",
        "HtmlTemplateDefinition",
        "RenderHtmlPdfOptions",
        "defineHtmlTemplate",
        "escapeHtml",
        "renderHtmlPdf"
      ]
    }
  }
];
