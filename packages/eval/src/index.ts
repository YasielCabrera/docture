export type { JsonObject, JsonValue } from "./json.js";
export { toJsonValue, canonicalJson } from "./json.js";
export { fingerprintOf } from "./hash.js";
export { compareCodeUnits } from "./order.js";
export { formatPath, patternOf, type PathSegment } from "./path.js";

export {
  DatasetError,
  EvalSpecError,
  GroundTruthError,
  IncomparableRunsError,
  MigrationGuardError,
  OutOfScopeError,
  PreflightError,
  RunStoreError,
  type GroundTruthIssue,
  type GroundTruthIssueCode,
  type InvalidCaseTruth,
  type RunStoreFailure,
  type SpecProblem,
  type SpecProblemCode,
} from "./errors.js";

export { inMemoryDataset } from "./case.js";
export type { Box, CaseDocument, Dataset, EvalCase, ExpectedLocation, TagValue, WritableDataset } from "./case.js";
export type { EvalExtractor, ExtractContext, ExtractOutput, FieldEvidence, UsageInfo } from "./extractor.js";
export { defineReporter, type Progress, type Reporter } from "./reporter.js";
export { resolveBaseline, type BaselineQuery, type RawKey, type RunIndexEntry, type RunStore, type StoredRaw, type StoredRun } from "./store.js";
export { sliceValues, type SliceMap, type SliceSpec, type SliceValue } from "./slices.js";

export { defineComparator, describeComparator, type Comparator, type CompareContext, type Comparison, type RepairHint } from "./compare/types.js";
export { exact, type ExactNormalization } from "./compare/exact.js";
export { number, type NumberOptions } from "./compare/number.js";
export { date, type DateGranularity, type DateOptions } from "./compare/date.js";
export { identifier, text, type TextOptions } from "./compare/text.js";
export { oneOf, setOf } from "./compare/collections.js";
export { boxIoU, intersectionOverUnion } from "./compare/box.js";

export { DEFAULT_MAX_CELLS, byIndex, hungarian, ordered, type ArrayRule } from "./align/rules.js";
export type { AlignmentAlgorithm, AlignmentReport } from "./align/align.js";

export { defineEval } from "./spec/define.js";
export { looseEval, type LooseEvalOptions } from "./spec/loose.js";
export type { JsonSchemaObject, SchemaInput } from "./spec/schema-source.js";
export type {
  EvalRules,
  EvalSpec,
  FieldRule,
  FieldRuleOptions,
  FieldSource,
  FieldType,
  NullHandling,
  ResolvedArray,
  ResolvedField,
  ResolvedFieldInfo,
  ScoreExtras,
  SpecInfo,
  ValidationResult,
} from "./spec/types.js";

export { prf, type CaseScore, type EvidenceRef, type FieldResult, type FieldStatus, type Prf, type SegmentScore, type StatusCounts } from "./score/types.js";
export { groundingRule, isGrounded, supportsLocation, type GroundingRule, type ResolvedGroundingRule } from "./score/grounded.js";
export { defineAssertion, sumOf, type Assertion, type AssertionOutcome, type AssertionResult } from "./score/assertions.js";

export { defineMetric } from "./metrics/define.js";
export { builtinMetrics, omittedOf, runScopeOmissions, percentile, prfMetricId, prfOf, type PrfScope } from "./metrics/builtin.js";
export type { MetricContext, MetricDefinition, MetricFormat, MetricInfo } from "./metrics/types.js";

export { RESULT_FORMAT, RESULT_VERSION } from "./result/types.js";
export type {
  CaseResult,
  EpochSummary,
  ErroredCase,
  EvalResult,
  FieldGroupSummary,
  MetricValues,
  OmittedCount,
  OmittedLeaves,
  RunInfo,
  ScoredCase,
  SkippedCase,
  Summary,
} from "./result/types.js";
export type {
  CalibrationBin,
  CalibrationReport,
  CalibrationStats,
  CalibrationSummary,
  CaseDelta,
  ConfidenceCount,
  CoveragePoint,
  DeltaVerdict,
  ExperimentComparison,
  GroundingCounts,
  GroundingReport,
  GroundingScore,
  GroundingSummary,
  MetricDelta,
  OutcomeChange,
  PathDelta,
  RunComparison,
  SliceFilter,
} from "./result/sections.js";
export { buildResult, type BuildResultInput } from "./result/build.js";
export { parseCaseResult, parseEvalResult, parseRunInfo } from "./result/parse.js";

export { gate } from "./gate/gate.js";
export type { GateCheck, GateOptions, GateResult, GateThreshold } from "./gate/types.js";
