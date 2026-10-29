/** A value used to slice results: a tag, a group or a derived bucket. */
export type TagValue = string | number | boolean;

/** A rectangle on a page in PDF points with a top-left origin, Docture's layout convention. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where a ground-truth value appears in the document, for grounding. */
export interface ExpectedLocation {
  /** Physical page number, starting at 1. */
  readonly pageNumber: number;
  readonly box?: Box;
}

/** One input file of a case. Bytes load lazily so a dataset can list thousands of cases cheaply. */
export interface CaseDocument {
  readonly name: string;
  readonly mimeType: string;
  bytes(): Promise<Uint8Array>;
  /** Content hash when the dataset knows it; resume keys use it to detect a changed document. */
  readonly hash?: string;
}

/** What eval needs from a case. Nothing about how the project stores it. */
export interface EvalCase<T = unknown> {
  readonly id: string;
  readonly documents: readonly CaseDocument[];
  /** Ground truth, already in the comparable view the spec describes. */
  readonly expected: T;
  readonly status?: "signed-off" | "draft";
  readonly tags?: Readonly<Record<string, TagValue>>;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Cases that share one ground truth, such as renditions of one document. Also the bootstrap cluster key. */
  readonly group?: string;
  /** Expected locations keyed by concrete path, for grounding. */
  readonly locations?: Readonly<Record<string, readonly ExpectedLocation[]>>;
}

/** A project's corpus, in any layout, seen as a list of cases. */
export interface Dataset<T = unknown> {
  readonly id: string;
  cases(options?: { readonly signal?: AbortSignal }): Promise<readonly EvalCase<T>[]>;
}

/** A dataset that can also record drafted ground truth and sign-offs. Only drafting and migrations need it. */
export interface WritableDataset<T = unknown> extends Dataset<T> {
  writeExpected(caseId: string, value: T, options: { readonly draft: boolean }): Promise<void>;
  signOff(caseId: string): Promise<void>;
}

/** A dataset over cases already in memory, for tests and generated corpora. */
export function inMemoryDataset<T>(id: string, cases: readonly EvalCase<T>[]): Dataset<T> {
  const frozen = Object.freeze([...cases]);
  return {
    id,
    async cases(options) {
      options?.signal?.throwIfAborted();
      return frozen;
    },
  };
}
