# Implemented eval API

Status: implementation reference for T-164/P1 revision 2, 2026-10-28. Source declarations in `packages/eval/src` are authoritative. This replaces the design sketch.

## Contracts and result format

The portable root exports `Dataset<T>`, `EvalCase<T>`, `CaseDocument`, `EvalExtractor<Raw, T>`, `EvalSpec<T>`, `Reporter`, `RunStore`, and `EvalResult`. These are structural contracts. Projects own layout and truth; eval owns `docture-eval-result`, version 1. `parseEvalResult` validates saved data against the same contract as the published `result-v1.schema.json`.

`defineEval(schema, rules)` resolves schema defaults, annotations, and explicit field rules. Every unresolved string or row array is an error. `spec.validate(expected)` returns a discriminated validation result. `spec.score(expected, actual, extras?)` returns `CaseScore`; async comparators require `spec.scoreAsync`. `looseEval(options?)` compares exploratory JSON without a schema. `CaseScore.metrics` holds `precision`, `recall`, `f1`, `exact`, `anls`, and `critical`; undefined denominators are null.

Fields use `match`, `mismatch`, `omission`, and `hallucination`. A `FieldResult` records paths, values, comparator, similarity, weight, segment, and optional hints, confidence and evidence. `byIndex`, `ordered`, and `hungarian` configure arrays. Alignment reports distinguish `index`, `ordered`, `exact-key`, `hungarian`, `greedy`, and `ordered-greedy`. The last two indicate a cost-matrix budget fallback; `ordered-greedy` preserves order.

`buildResult({ run, cases, metrics?, slices?, ...sections })` constructs summaries per experiment, segment, slice, path, field type and epoch. It does not execute extraction. Raw processor outputs belong to the store and can be re-scored through `rescore`.

## Execution, history and comparison

`runEval({ dataset, spec, experiments, ...options })` supports multiple experiments, concurrency, epochs, selection, cancellation, resume, reporters, custom metrics and result sections. `EvalExtractor.extract(item, context)` returns `{ raw, usage?, method?, fallback?, confidence?, evidence?, diagnostics? }`. Its optional `project(raw)` produces the comparable view. Preflight runs before jobs, and dispose runs after success, error or abort. `OutOfScopeError` produces a skipped row. Other processing errors produce errored rows whose omitted ground truth contributes to quality metrics.

`inMemoryDataset(id, cases)` is a root helper. `folderDataset(root, options)` and `jsonlDataset` are Node conveniences. `defineMigration` declares id, description, allowed targets, and an idempotent transformation. `runMigration` previews by default, validates every case before writing when `options.spec` is supplied, and rejects changes outside the targets. `draftExpected` writes proposals without signing them off.

`fileRunStore(root)` implements `RunStore`; `readEvalResult` and `writeEvalResult` use `result.json` plus `cases.jsonl`. Root `resolveBaseline` selects compatible history and requires provenance for automatic branch-based selection.

`compareRuns(baseline, candidate, options?)` compares each common experiment separately by default. `options.experiment` selects one id or a baseline/candidate pair. Each experiment carries paired metric deltas, outcomes and paths. Seeded cluster bootstrap resamples groups, not independent renditions. Exact McNemar handles paired binary outcomes. The seven `DeltaVerdict` values are `improved`, `regressed`, `unchanged`, `inconclusive`, `insufficient`, `not-tested`, and `incomparable`. Missing support is not a positive result. Root `gate` consumes thresholds and optional comparison-based regression budgets.

## Calibration, grounding and reports

`calibrate(result, options?)` reports confidence coverage, reliability bins, ECE, MCE, Brier score, AUROC, average precision and risk/coverage. Auto-accept requires a one-sided 95% Clopper-Pearson lower bound. `mergeCalibration` retains exact confidence ties. `calibrationSection` integrates with the runner's sections hook. `grounding` scores only fields with expected location labels and reports unlabelled support separately.

Every reporter reads only `EvalResult`. Terminal, JSON, Markdown, CSV, JUnit, HTML and template entries are independent. Columns return raw sortable cells. Markdown supports sections; HTML supports data panels, themes and replacement shells. The HTML client is prebuilt and embedded for offline packed installs. Each reporter entry is Node-only because it also exports a file-writing factory that imports `node/artifacts`. The pure `render*` implementations have no Node imports; this does not make their entry points browser-safe.

## Judge and structural framework adapters

`judge({ model, rubric, cache? })` is an async string comparator. A fixed structured schema constrains match, similarity and reason. Calls use temperature zero and hash-keyed verdict caching; providers can still vary. The cache exposes `get(key)` and `set(key, comparison)` and may be persistent. The default is an in-memory map per comparator. The optional AI SDK loads on use; its absence is `MissingEngineError`. The root does not import the judge. Aligned rows still need a weighted synchronous field for pairing; judge-only row features fail closed.

`extractionMatchers()` supplies async `toMatchExtraction(actual, expected, spec, { minF1? })`; the receiver becomes actual through `expect.extend`. `describeEval(dataset, spec, processor, { test })` registers case tests with shared preflight and disposal. The async matcher requires `await expect(actual).toMatchExtraction(expected, spec, { minF1 })`; the adapter supplies Vitest's `Matchers` augmentation. `extractionScorer(spec, { metric? })` returns Evalite's structural name/scorer object. `extractionAssertion(spec, { threshold? })` reads promptfoo truth from `context.vars.expected` and returns `{ pass, score, reason }`. `ExtractionF1(spec)` accepts `{ output, expected }` and returns autoevals' `{ name, score, metadata }`. These entries import no host framework.

## Export inventory

### `@docture/eval`

- `AlignmentAlgorithm`
- `AlignmentReport`
- `ArrayRule`
- `Assertion`
- `AssertionOutcome`
- `AssertionResult`
- `BaselineQuery`
- `Box`
- `BuildResultInput`
- `CalibrationBin`
- `CalibrationReport`
- `CalibrationStats`
- `CalibrationSummary`
- `CaseDelta`
- `CaseDocument`
- `CaseResult`
- `CaseScore`
- `Comparator`
- `CompareContext`
- `Comparison`
- `ConfidenceCount`
- `CoveragePoint`
- `DEFAULT_MAX_CELLS`
- `Dataset`
- `DatasetError`
- `DateGranularity`
- `DateOptions`
- `DeltaVerdict`
- `EpochSummary`
- `ErroredCase`
- `EvalCase`
- `EvalExtractor`
- `EvalResult`
- `EvalRules`
- `EvalSpec`
- `EvalSpecError`
- `EvidenceRef`
- `ExactNormalization`
- `ExpectedLocation`
- `ExperimentComparison`
- `ExtractContext`
- `ExtractOutput`
- `FieldEvidence`
- `FieldGroupSummary`
- `FieldResult`
- `FieldRule`
- `FieldRuleOptions`
- `FieldSource`
- `FieldStatus`
- `FieldType`
- `GateCheck`
- `GateOptions`
- `GateResult`
- `GateThreshold`
- `GroundTruthError`
- `GroundTruthIssue`
- `GroundTruthIssueCode`
- `GroundingCounts`
- `GroundingReport`
- `GroundingRule`
- `GroundingScore`
- `GroundingSummary`
- `IncomparableRunsError`
- `InvalidCaseTruth`
- `JsonObject`
- `JsonSchemaObject`
- `JsonValue`
- `LooseEvalOptions`
- `MetricContext`
- `MetricDefinition`
- `MetricDelta`
- `MetricFormat`
- `MetricInfo`
- `MetricValues`
- `MigrationGuardError`
- `NullHandling`
- `NumberOptions`
- `OmittedCount`
- `OmittedLeaves`
- `OutOfScopeError`
- `OutcomeChange`
- `PathDelta`
- `PathSegment`
- `PreflightError`
- `Prf`
- `PrfScope`
- `Progress`
- `RESULT_FORMAT`
- `RESULT_VERSION`
- `RawKey`
- `RepairHint`
- `Reporter`
- `ResolvedArray`
- `ResolvedField`
- `ResolvedFieldInfo`
- `ResolvedGroundingRule`
- `RunComparison`
- `RunIndexEntry`
- `RunInfo`
- `RunStore`
- `RunStoreError`
- `RunStoreFailure`
- `SchemaInput`
- `ScoreExtras`
- `ScoredCase`
- `SegmentScore`
- `SkippedCase`
- `SliceFilter`
- `SliceMap`
- `SliceSpec`
- `SliceValue`
- `SpecInfo`
- `SpecProblem`
- `SpecProblemCode`
- `StatusCounts`
- `StoredRaw`
- `StoredRun`
- `Summary`
- `TagValue`
- `TextOptions`
- `UsageInfo`
- `ValidationResult`
- `WritableDataset`
- `boxIoU`
- `buildResult`
- `builtinMetrics`
- `byIndex`
- `canonicalJson`
- `compareCodeUnits`
- `date`
- `defineAssertion`
- `defineComparator`
- `defineEval`
- `defineMetric`
- `defineReporter`
- `describeComparator`
- `exact`
- `fingerprintOf`
- `formatPath`
- `gate`
- `groundingRule`
- `hungarian`
- `identifier`
- `inMemoryDataset`
- `intersectionOverUnion`
- `isGrounded`
- `looseEval`
- `number`
- `omittedOf`
- `oneOf`
- `ordered`
- `parseCaseResult`
- `parseEvalResult`
- `patternOf`
- `percentile`
- `prf`
- `prfMetricId`
- `prfOf`
- `resolveBaseline`
- `setOf`
- `sliceValues`
- `sumOf`
- `supportsLocation`
- `text`
- `toJsonValue`

### `@docture/eval/config`

- `EvalConfig`
- `defineEvalConfig`

### `@docture/eval/dataset`

- `DraftableDataset`
- `Migration`
- `MigrationDiff`
- `MigrationReport`
- `PendingCase`
- `SampleOptions`
- `caseFingerprint`
- `datasetFingerprint`
- `defineMigration`
- `draftExpected`
- `runMigration`
- `sample`

### `@docture/eval/runner`

- `EvalExtractor`
- `ExtractContext`
- `ExtractOutput`
- `RescoreOptions`
- `ResultOptions`
- `ResultSection`
- `RunEvalOptions`
- `memoryRunStore`
- `rescore`
- `runEval`

### `@docture/eval/node`

- `FolderDatasetOptions`
- `LiveArtifact`
- `fileDocument`
- `fileRunStore`
- `folderDataset`
- `gitInfo`
- `jsonlDataset`
- `liveArtifact`
- `readEvalResult`
- `writeEvalResult`
- `writeFileAtomic`

### `@docture/eval/docture`

- `FromDoctureOptions`
- `FromDoctureProjection`
- `fromDocture`

### `@docture/eval/compare`

- `CompareOptions`
- `compareRuns`

### `@docture/eval/calibration`

- `CalibrationOptions`
- `calibrate`
- `calibrationSection`
- `mergeCalibration`

### `@docture/eval/grounding`

- `GroundingOptions`
- `grounding`
- `groundingSection`

### `@docture/eval/reporters/terminal`

- `CellValue`
- `Column`
- `ScoreboardOptions`
- `TerminalReporterOptions`
- `TerminalStream`
- `defaultColumns`
- `defineColumn`
- `renderScoreboard`
- `terminalReporter`

### `@docture/eval/reporters/json`

- `JsonReporterOptions`
- `jsonReporter`
- `renderJson`
- `renderJsonSplit`

### `@docture/eval/reporters/markdown`

- `CellValue`
- `Column`
- `MarkdownHelpers`
- `MarkdownOptions`
- `MarkdownReporterOptions`
- `MarkdownSection`
- `TableView`
- `defaultColumns`
- `defineColumn`
- `escapeMarkdown`
- `markdownReporter`
- `md`
- `renderMarkdown`

### `@docture/eval/reporters/csv`

- `CellValue`
- `Column`
- `CsvOptions`
- `CsvReporterOptions`
- `csvCell`
- `csvReporter`
- `defaultColumns`
- `defineColumn`
- `renderCsv`

### `@docture/eval/reporters/junit`

- `JunitOptions`
- `JunitReporterOptions`
- `escapeXml`
- `junitReporter`
- `renderJunit`

### `@docture/eval/reporters/html`

- `Bar`
- `BarData`
- `CellValue`
- `Column`
- `DocumentRow`
- `HTML_IDS`
- `HtmlOptions`
- `HtmlPanel`
- `HtmlParts`
- `HtmlReporterOptions`
- `HtmlTheme`
- `HtmlView`
- `PanelData`
- `SectionData`
- `Tile`
- `TileData`
- `Tone`
- `defaultColumns`
- `defineColumn`
- `embedJson`
- `htmlReporter`
- `panel`
- `renderHtml`
- `scoreTone`

### `@docture/eval/reporters/template`

- `TableView`
- `TemplateHelpers`
- `TemplateRender`
- `TemplateReporterOptions`
- `renderTemplate`
- `templateHelpers`
- `templateReporter`

### `@docture/eval/judge`

- `ENGINE_RANGES`
- `JudgeCache`
- `JudgeOptions`
- `judge`

### `@docture/eval/vitest`

- `describeEval`
- `extractionMatchers`
- `toMatchExtraction`

### `@docture/eval/evalite`

- `extractionScorer`

### `@docture/eval/promptfoo`

- `extractionAssertion`

### `@docture/eval/autoevals`

- `ExtractionF1`

### `@docture/eval/conversion`

- `AbsentCheck`
- `ConversionCheck`
- `ConversionCheckKind`
- `ConversionCheckResult`
- `ConversionReport`
- `ConvertedPages`
- `OrderCheck`
- `PresentCheck`
- `TableCheck`
- `checkConversion`
