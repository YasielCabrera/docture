import type { DocumentElement, DoctureDocument, ElementProvenance, LayoutPage, ListElement, ProvenanceSegment, TableElement } from "../../core/domain/conversion.js";
import type { CellSourceId, ElementSourceId, EvidenceLocation, SourceEvidence } from "../../core/domain/evidence.js";
import type { LayoutBox, LoadedPage, LoadedSource } from "../../core/domain/geometry.js";
import { sha256Bytes, sha256Hex } from "../../core/conversion/sha256.js";
import { tableIssues } from "../../core/conversion/tables.js";
import { inferForm } from "../../core/pipeline/features.js";
import { canonicalJson, checkedLimits, DoclingImportError, finite, integer, list, record, text, type DoclingImportLimits, type JsonRecord } from "./boundary.js";

export { DoclingImportError } from "./boundary.js";
export type { DoclingImportLimits } from "./boundary.js";

export interface DoclingDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface DoclingImportOptions {
  readonly strict?: boolean;
  readonly limits?: DoclingImportLimits;
  readonly coordinateSpace?: { readonly unit: "points" } | { readonly unit: "pixels"; readonly pixelsPerPoint: number };
  readonly physicalSource?: { readonly bytes: Uint8Array; readonly attestExportMatchesSource: true };
  readonly pageImages?: readonly { readonly pageNumber: number; readonly bytes: Uint8Array; readonly sourceDigest: string }[];
}

export interface DoclingNativeSource {
  readonly pointer: string;
  readonly provenanceIndex?: number;
  readonly pageNumbers: readonly number[];
  readonly bbox?: JsonRecord;
  readonly charspan?: readonly number[];
  readonly utf16Charspan?: readonly number[];
  readonly segments?: readonly { readonly pageNumber: number; readonly bbox?: JsonRecord; readonly charspan?: readonly number[]; readonly utf16Charspan?: readonly number[] }[];
  readonly metadata?: JsonRecord;
}

export interface DoclingProvenance {
  readonly version: 1;
  readonly schemaVersion: "1.10.0";
  readonly sourceDigest: string;
  readonly documentDigest: string;
  readonly physicalSourceDigest?: string;
  readonly origin?: JsonRecord;
  readonly sources: Readonly<Record<string, DoclingNativeSource>>;
}

export interface ImportedDoclingDocument {
  readonly document: DoctureDocument;
  readonly source: LoadedSource;
  readonly diagnostics: readonly DoclingDiagnostic[];
  readonly provenance: DoclingProvenance;
}

interface NativePage {
  readonly number: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

interface Segment {
  readonly pageNumber: number;
  readonly native?: JsonRecord;
  readonly bbox?: JsonRecord;
  readonly charspan?: readonly [number, number];
  readonly utf16Charspan?: readonly [number, number];
  readonly text: string;
  readonly location: EvidenceLocation;
}

const ZERO_BOX: LayoutBox = { x: 0, y: 0, width: 0, height: 0 };
const SUPPORTED_TEXT = new Set(["text", "paragraph", "title", "section_header", "list_item", "code", "page_header", "page_footer", "caption", "footnote", "reference", "formula"]);
const COLLECTIONS = ["groups", "texts", "tables", "pictures", "key_value_items", "form_items", "field_regions", "field_items"];

/** Import the bounded DoclingDocument 1.10.0 subset without engines, I/O or fabricated lines. */
export function importDoclingDocument(raw: unknown, options: DoclingImportOptions = {}): ImportedDoclingDocument {
  const limits = checkedLimits(options.limits);
  const serialized = canonicalJson(raw, limits);
  const data = record(JSON.parse(serialized), "$" );
  if (data.schema_name !== "DoclingDocument" || data.version !== "1.10.0") throw new DoclingImportError("version", "only DoclingDocument schema 1.10.0 is supported (modelled on docling-core 2.104.0)");
  const sourceDigest = `sha256:${sha256Hex(serialized)}`;
  const diagnostics: DoclingDiagnostic[] = [];
  const diagnostic = (code: string, path: string, message: string, unsupported = false): void => {
    if (unsupported && options.strict === true) throw new DoclingImportError(path, message);
    diagnostics.push({ code, path, message });
  };
  const space = options.coordinateSpace;
  const scale = space?.unit === "points" ? 1 : space?.unit === "pixels" ? finite(space.pixelsPerPoint, "coordinateSpace.pixelsPerPoint") : undefined;
  if (scale !== undefined && scale <= 0) throw new DoclingImportError("coordinateSpace.pixelsPerPoint", "must be positive");
  const binding = options.physicalSource;
  if (binding !== undefined && (binding.attestExportMatchesSource !== true || !(binding.bytes instanceof Uint8Array) || binding.bytes.length === 0 || binding.bytes.length > limits.maxBytes)) throw new DoclingImportError("physicalSource", "requires bounded original bytes and an explicit export/source attestation");
  const physicalSourceDigest = binding === undefined ? undefined : `sha256:${sha256Bytes(binding.bytes)}`;
  const pages = new Map<number, NativePage>();
  const rawPages = record(data.pages ?? {}, "pages");
  for (const [key, value] of Object.entries(rawPages)) {
    const item = record(value, `pages.${key}`);
    const number = integer(item.page_no, `pages.${key}.page_no`, 1);
    if (String(number) !== key) throw new DoclingImportError(`pages.${key}`, "page key and page_no differ");
    const size = record(item.size, `pages.${key}.size`);
    const width = finite(size.width, `pages.${key}.size.width`);
    const height = finite(size.height, `pages.${key}.size.height`);
    if (width <= 0 || height <= 0) throw new DoclingImportError(`pages.${key}.size`, "page dimensions must be positive");
    pages.set(number, { number, width, height, rotation: finite(item.rotation ?? 0, `pages.${key}.rotation`) });
    if (pages.size > limits.maxPages) throw new DoclingImportError("pages", "page limit exceeded");
  }
  const logical = pages.size === 0;
  if (logical) {
    pages.set(1, { number: 1, width: 0, height: 0, rotation: 0 });
    diagnostic("LOGICAL_PAGES", "pages", "No native pages exist; page 1 is a logical text container with no physical coordinates.");
  }
  const numbers = [...pages.keys()].sort((a, b) => a - b);
  const firstPage = numbers[0] ?? 1;
  if (scale === undefined) diagnostic("UNKNOWN_UNITS", "pages", "Native units were not supplied; physical boxes are unavailable.");
  if (binding === undefined) diagnostic("PHYSICAL_SOURCE_UNBOUND", "origin", "No original-byte binding was attested; native boxes cannot authorize physical highlights.");
  const imageByPage = new Map<number, Uint8Array>();
  let imageBytes = 0;
  for (const image of options.pageImages ?? []) {
    imageBytes += image.bytes.byteLength;
    if (physicalSourceDigest === undefined || image.sourceDigest !== physicalSourceDigest || !pages.has(image.pageNumber) || imageBytes > limits.maxBytes) throw new DoclingImportError("pageImages", "bounded images must name known pages and match the bound original-byte digest");
    imageByPage.set(image.pageNumber, new Uint8Array(image.bytes));
  }
  const boxOf = (value: unknown, pageNumber: number, path: string): { native: JsonRecord; location: EvidenceLocation } => {
    const box = record(value, path);
    const l = finite(box.l, `${path}.l`); const t = finite(box.t, `${path}.t`);
    const r = finite(box.r, `${path}.r`); const b = finite(box.b, `${path}.b`);
    if (box.coord_origin !== "TOPLEFT" && box.coord_origin !== "BOTTOMLEFT") throw new DoclingImportError(`${path}.coord_origin`, "must be TOPLEFT or BOTTOMLEFT");
    const top = box.coord_origin === "TOPLEFT" ? t : b;
    const bottom = box.coord_origin === "TOPLEFT" ? b : t;
    const page = pages.get(pageNumber);
    if (l < 0 || top < 0 || r < l || bottom < top || page === undefined || !logical && (r > page.width || bottom > page.height)) throw new DoclingImportError(path, "impossible box or unknown page");
    if (page.rotation !== 0) diagnostic("UNSUPPORTED_ROTATION", path, "Rotated native page boxes are retained only in the sidecar.", true);
    if (logical || scale === undefined || physicalSourceDigest === undefined || page.rotation !== 0) return { native: box, location: { kind: "logical", pageNumber } };
    return { native: box, location: { kind: "physical", pageNumber, sourceDigest: physicalSourceDigest, box: { x: l / scale, y: (box.coord_origin === "TOPLEFT" ? t : page.height - t) / scale, width: (r - l) / scale, height: (bottom - top) / scale } } };
  };
  const segmentsOf = (item: JsonRecord, pointer: string, content: string): Segment[] => {
    const points = Array.from(content);
    const native = list(item.prov ?? [], `${pointer}.prov`);
    if (native.length === 0) return [{ pageNumber: firstPage, text: content, location: { kind: "logical", pageNumber: firstPage } }];
    const segments: Segment[] = native.map((value, index) => {
      const path = `${pointer}.prov.${index}`; const entry = record(value, path);
      const pageNumber = integer(entry.page_no, `${path}.page_no`, 1);
      if (!pages.has(pageNumber) || logical) throw new DoclingImportError(path, "provenance must name an actual exported page");
      const span = list(entry.charspan, `${path}.charspan`);
      if (span.length !== 2) throw new DoclingImportError(`${path}.charspan`, "expected [start,end] codepoint offsets");
      const start = integer(span[0], `${path}.charspan.0`); const end = integer(span[1], `${path}.charspan.1`);
      if (end < start || end > points.length) throw new DoclingImportError(`${path}.charspan`, "outside the native text's codepoint range");
      const box = boxOf(entry.bbox, pageNumber, `${path}.bbox`);
      return { pageNumber, native: entry, bbox: box.native, charspan: [start, end], utf16Charspan: [points.slice(0, start).join("").length, points.slice(0, end).join("").length], text: points.slice(start, end).join(""), location: box.location };
    });
    let covered = 0;
    for (const segment of [...segments].sort((a, b) => (a.charspan?.[0] ?? 0) - (b.charspan?.[0] ?? 0))) {
      if (segment.charspan === undefined) continue;
      if (segment.charspan[0] < covered && segment.charspan[1] > segment.charspan[0]) throw new DoclingImportError(`${pointer}.prov`, "overlapping charspans are unsupported");
      if (segment.charspan[0] > covered) break;
      covered = Math.max(covered, segment.charspan[1]);
    }
    if (covered !== points.length) throw new DoclingImportError(`${pointer}.prov`, "charspans do not cover the complete native text");
    return segments;
  };
  const index = new Map<string, JsonRecord>();
  for (const root of ["body", "furniture"]) if (data[root] !== undefined) index.set(`#/${root}`, record(data[root], root));
  for (const collection of COLLECTIONS) list(data[collection] ?? [], collection).forEach((value, position) => {
    const pointer = `#/${collection}/${position}`; const item = record(value, pointer);
    if (item.self_ref !== pointer) throw new DoclingImportError(pointer, "self_ref must equal its canonical pointer");
    index.set(pointer, item);
  });
  const resolve = (value: unknown, path: string): { pointer: string; item: JsonRecord } => {
    const pointer = text(record(value, path).$ref, `${path}.$ref`);
    const item = index.get(pointer);
    if (item === undefined) throw new DoclingImportError(path, `broken or unsupported reference ${pointer}`);
    return { pointer, item };
  };
  for (const [pointer, item] of index) {
    if (item.parent !== undefined && item.parent !== null) resolve(item.parent, `${pointer}.parent`);
    for (const field of ["children", "captions", "footnotes", "references"]) list(item[field] ?? [], `${pointer}.${field}`).forEach((value, position) => resolve(value, `${pointer}.${field}.${position}`));
  }
  const elements = new Map<number, DocumentElement[]>(numbers.map((number) => [number, []]));
  const evidence = new Map<number, SourceEvidence[]>(numbers.map((number) => [number, []]));
  const listGroupByElement = new Map<string, string>();
  const nativeSources: Record<string, DoclingNativeSource> = {};
  let order = 0;
  const addEvidence = (source: SourceEvidence, pointer: string, segments: readonly Segment[], provenanceIndex?: number): void => {
    evidence.get(source.pageNumber)?.push(source);
    const segment = provenanceIndex === undefined ? undefined : segments[provenanceIndex];
    nativeSources[source.id] = {
      pointer, pageNumbers: [...new Set(segments.map((entry) => entry.pageNumber))],
      ...(provenanceIndex === undefined ? {} : { provenanceIndex }),
      ...(segment?.bbox === undefined ? {} : { bbox: segment.bbox }),
      ...(segment?.charspan === undefined ? {} : { charspan: segment.charspan }),
      ...(segment?.utf16Charspan === undefined ? {} : { utf16Charspan: segment.utf16Charspan }),
    };
  };
  const provenanceOf = (pointer: string, segment: Segment): ProvenanceSegment => ({ pageNumber: segment.pageNumber, box: segment.location.kind === "physical" ? segment.location.box : ZERO_BOX, sourceIds: [pointer] });
  const idFor = (pointer: string, pageNumber: number, content: unknown, part: number): ElementSourceId => `p${pageNumber}-element-${sha256Hex(JSON.stringify([pointer, pageNumber, content, part])).slice(0, 12)}`;
  const addItem = (pointer: string, item: JsonRecord, listGroup?: string): void => {
    const label = text(item.label, `${pointer}.label`);
    if (label === "table") {
      const segments = segmentsOf(item, pointer, "").sort((a, b) => a.pageNumber - b.pageNumber);
      const first = segments[0]; if (first === undefined) return;
      const segmentPages = [...new Set(segments.map((segment) => segment.pageNumber))];
      const start = numbers.indexOf(first.pageNumber);
      if (segmentPages.some((number, offset) => number !== numbers[start + offset])) throw new DoclingImportError(pointer, "a multipage table may not skip an existing normalized page; cell-to-page placement is unavailable");
      const tableData = record(item.data, `${pointer}.data`);
      if (tableData.orientation !== undefined && tableData.orientation !== "rot_0") diagnostic("UNSUPPORTED_TABLE_ORIENTATION", pointer, "Rotated table orientation is retained only in native source metadata; normalized rows keep native logical order.", true);
      const rows = integer(tableData.num_rows, `${pointer}.data.num_rows`); const cols = integer(tableData.num_cols, `${pointer}.data.num_cols`);
      if (rows > limits.maxTableCells || cols > limits.maxTableCells || rows * cols > limits.maxTableCells) throw new DoclingImportError(pointer, "table grid limit exceeded");
      const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
      const occupied = new Set<string>();
      const spans: { row: number; col: number; rowSpan: number; colSpan: number }[] = [];
      const cells = list(tableData.table_cells ?? [], `${pointer}.data.table_cells`).map((rawCell, position) => {
        const cellPath = `${pointer}/data/table_cells/${position}`; const cell = record(rawCell, cellPath);
        const row = integer(cell.start_row_offset_idx, `${cellPath}.start_row_offset_idx`); const col = integer(cell.start_col_offset_idx, `${cellPath}.start_col_offset_idx`);
        const rowEnd = integer(cell.end_row_offset_idx, `${cellPath}.end_row_offset_idx`, row + 1); const colEnd = integer(cell.end_col_offset_idx, `${cellPath}.end_col_offset_idx`, col + 1);
        if (rowEnd > rows || colEnd > cols || integer(cell.row_span ?? 1, `${cellPath}.row_span`, 1) !== rowEnd - row || integer(cell.col_span ?? 1, `${cellPath}.col_span`, 1) !== colEnd - col) throw new DoclingImportError(cellPath, "cell span is outside the grid or contradicts offsets");
        if (cell.ref !== undefined) { resolve(cell.ref, `${cellPath}.ref`); diagnostic("UNSUPPORTED_RICH_CELL", cellPath, "Rich cell content requires native serialization; its plain text is not treated as authoritative evidence.", true); }
        const content = text(cell.text, `${cellPath}.text`);
        for (let r = row; r < rowEnd; r++) for (let c = col; c < colEnd; c++) {
          const key = `${r},${c}`; if (occupied.has(key)) throw new DoclingImportError(cellPath, "overlapping cell spans"); occupied.add(key);
        }
        const target = grid[row]; if (target !== undefined) target[col] = content;
        if (rowEnd - row > 1 || colEnd - col > 1) spans.push({ row, col, rowSpan: rowEnd - row, colSpan: colEnd - col });
        return { cell, cellPath, content, row, col, rowSpan: rowEnd - row, colSpan: colEnd - col, rich: cell.ref !== undefined };
      });
      let headerRows = 0;
      while (headerRows < rows && cells.some((cell) => cell.row <= headerRows && cell.row + cell.rowSpan > headerRows && cell.cell.column_header === true)) headerRows++;
      const id = idFor(pointer, first.pageNumber, grid, 0);
      const pageSegments = segmentPages.map((pageNumber): ProvenanceSegment => {
        const boxes = segments.flatMap((segment) => segment.pageNumber === pageNumber && segment.location.kind === "physical" ? [segment.location.box] : []);
        if (boxes.length === 0) return { pageNumber, box: ZERO_BOX, sourceIds: [pointer] };
        const x = Math.min(...boxes.map((box) => box.x));
        const y = Math.min(...boxes.map((box) => box.y));
        return { pageNumber, box: { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y }, sourceIds: [pointer] };
      });
      const provenance: ElementProvenance = { ...provenanceOf(pointer, first), ...pageSegments[0], ...(pageSegments.length <= 1 ? {} : { continuations: pageSegments.slice(1) }) };
      const element: TableElement = { id, kind: "table", rows: grid, headerRows, provenance, ...(spans.length === 0 ? {} : { spans: spans.sort((a, b) => a.row - b.row || a.col - b.col) }) };
      const issues = tableIssues(element, pointer); if (issues.length > 0) throw new DoclingImportError(pointer, issues.map((issue) => issue.message).join("; "));
      elements.get(first.pageNumber)?.push(element);
      nativeSources[id] = { pointer, pageNumbers: segmentPages, segments: segments.map((segment) => ({ pageNumber: segment.pageNumber, ...(segment.bbox === undefined ? {} : { bbox: segment.bbox }), ...(segment.charspan === undefined ? {} : { charspan: segment.charspan }), ...(segment.utf16Charspan === undefined ? {} : { utf16Charspan: segment.utf16Charspan }) })), metadata: { contentLayer: item.content_layer ?? "body", orientation: tableData.orientation ?? "rot_0" } };
      if (segmentPages.length > 1) diagnostic("UNLOCATED_TABLE_CELLS", pointer, "Native cells have no page number; their text is citeable but physical placement across table pages is unknown.");
      for (const cell of cells) {
        if (cell.rich) continue;
        const location: EvidenceLocation = segmentPages.length > 1 ? { kind: "unlocated", pageNumbers: segmentPages } : cell.cell.bbox === undefined || cell.cell.bbox === null ? { kind: "logical", pageNumber: first.pageNumber } : boxOf(cell.cell.bbox, first.pageNumber, `${cell.cellPath}.bbox`).location;
        const cellId: CellSourceId = `p${first.pageNumber}-cell-${sha256Hex(JSON.stringify([pointer, cell.row, cell.col, cell.content])).slice(0, 12)}`;
        addEvidence({ id: cellId, granularity: "table-cell", pageNumber: first.pageNumber, elementId: id, text: cell.content, order: order++, location, row: cell.row, column: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan }, cell.cellPath, segments);
        if (cell.cell.bbox !== undefined && cell.cell.bbox !== null) nativeSources[cellId] = { ...nativeSources[cellId], pointer: cell.cellPath, pageNumbers: segmentPages, bbox: record(cell.cell.bbox, `${cell.cellPath}.bbox`) };
      }
      return;
    }
    const content = text(item.text ?? "", `${pointer}.text`);
    if (!SUPPORTED_TEXT.has(label) && label !== "picture") { diagnostic("UNSUPPORTED_ITEM", pointer, `Unsupported native label ${label}; its text is retained as a paragraph.`, true); }
    const segments = segmentsOf(item, pointer, content);
    if (segments.length > 1) diagnostic("ITEM_SPLIT_AT_PAGE_BOUNDARY", pointer, "Native multipage item was split into page-local elements using exact charspans.");
    for (const [part, segment] of segments.entries()) {
      const id = idFor(pointer, segment.pageNumber, segment.text, part);
      const provenance = provenanceOf(pointer, segment);
      const base = { id, provenance }; const runs = [{ text: segment.text }];
      let element: DocumentElement;
      if (label === "title" || label === "section_header") {
        const level = integer(item.level ?? 1, `${pointer}.level`, 1);
        if (level > 6) throw new DoclingImportError(pointer, "heading levels above 6 are unsupported");
        element = { ...base, kind: "heading", level: level === 1 ? 1 : level === 2 ? 2 : level === 3 ? 3 : level === 4 ? 4 : level === 5 ? 5 : 6, text: segment.text, runs };
      } else if (label === "code") element = { ...base, kind: "code", text: segment.text };
      else if (label === "list_item") element = { ...base, kind: "list", ordered: item.enumerated === true, items: [{ text: segment.text, runs, ...(typeof item.marker === "string" ? { marker: item.marker } : {}) }] };
      else if (label === "page_header" || label === "page_footer") element = { ...base, kind: label === "page_header" ? "page-header" : "page-footer", text: segment.text, runs, evidence: "tagged" };
      else if (label === "picture") {
        const captions = list(item.captions ?? [], `${pointer}.captions`).map((value, position) => { const caption = resolve(value, `${pointer}.captions.${position}`); return text(caption.item.text, `${caption.pointer}.text`); }).join("\n");
        element = { ...base, kind: "figure", assetId: id, ...(captions === "" ? {} : { caption: captions }) };
        diagnostic("UNSUPPORTED_ASSET", pointer, "Figure metadata/captions are retained; assets are never fetched automatically.");
      } else element = { ...base, kind: "paragraph", text: segment.text, runs };
      elements.get(segment.pageNumber)?.push(element);
      if (segment.text !== "") addEvidence({ id, granularity: "element", pageNumber: segment.pageNumber, elementId: id, text: segment.text, order: order++, location: segment.location }, pointer, segments, part);
      else nativeSources[id] = { pointer, pageNumbers: [segment.pageNumber], provenanceIndex: part, ...(segment.bbox === undefined ? {} : { bbox: segment.bbox }), ...(segment.charspan === undefined ? {} : { charspan: segment.charspan }), metadata: { contentLayer: item.content_layer ?? "body", label } };
      if (element.kind === "list" && listGroup !== undefined) {
        listGroupByElement.set(id, listGroup);
        const source = nativeSources[id];
        if (source !== undefined) nativeSources[id] = { ...source, metadata: { ...source.metadata, listGroup } };
      }
    }
  };
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (pointer: string, depth: number, enclosingList?: string): void => {
    if (depth > limits.maxDepth || visiting.has(pointer)) throw new DoclingImportError(pointer, "cyclic reference or hierarchy depth limit exceeded");
    if (visited.has(pointer)) return;
    const item = index.get(pointer); if (item === undefined) throw new DoclingImportError(pointer, "missing hierarchy root");
    visiting.add(pointer);
    const listGroup = pointer.startsWith("#/groups/") && item.label === "list" ? pointer : enclosingList;
    if (listGroup === pointer && enclosingList !== undefined) diagnostic("UNSUPPORTED_LIST_NESTING", pointer, "Nested native list groups retain their source pointers; normalized lists are flat.", true);
    if (!pointer.startsWith("#/groups/") && pointer !== "#/body" && pointer !== "#/furniture") addItem(pointer, item, listGroup);
    for (const [position, value] of list(item.children ?? [], `${pointer}.children`).entries()) visit(resolve(value, `${pointer}.children.${position}`).pointer, depth + 1, listGroup);
    visiting.delete(pointer); visited.add(pointer);
  };
  visit("#/body", 0);
  if (index.has("#/furniture")) visit("#/furniture", 0);
  const groupedLists = (pageNumber: number): DocumentElement[] => {
    const input = elements.get(pageNumber) ?? [];
    const output: DocumentElement[] = [];
    const mergedElementByItem = new Map<string, string>();
    for (let position = 0; position < input.length; position++) {
      const first = input[position];
      if (first === undefined) continue;
      if (first.kind !== "list") { output.push(first); continue; }
      const group = listGroupByElement.get(first.id);
      const members: ListElement[] = [first];
      while (group !== undefined && position + 1 < input.length) {
        const next = input[position + 1];
        if (next?.kind !== "list" || next.ordered !== first.ordered || listGroupByElement.get(next.id) !== group) break;
        members.push(next); position++;
      }
      const items = members.flatMap((member) => member.items);
      if (first.ordered && items.some((item, itemIndex) => {
        const marker = item.marker?.trim();
        return marker !== undefined && marker !== "" && marker !== `${itemIndex + 1}.` && marker !== `${itemIndex + 1})`;
      })) diagnostic("UNSUPPORTED_LIST_NUMBERING", group ?? nativeSources[first.id]?.pointer ?? first.id, "Normalized ordered lists start at 1; original nonsequential or nonnumeric markers are retained in list items.", true);
      if (members.length === 1 || group === undefined) { output.push(first); continue; }
      const memberIds = new Set(members.map((member) => member.id));
      const id = idFor(group, pageNumber, [...memberIds], 0);
      const boxes = members.map((member) => member.provenance.box).filter((box) => box.width > 0 || box.height > 0);
      const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y));
      const box = boxes.length === 0 ? ZERO_BOX : { x, y, width: Math.max(...boxes.map((entry) => entry.x + entry.width)) - x, height: Math.max(...boxes.map((entry) => entry.y + entry.height)) - y };
      output.push({ id, kind: "list", ordered: first.ordered, items, provenance: { pageNumber, box, sourceIds: [group, ...members.flatMap((member) => member.provenance.sourceIds)] } });
      for (const memberId of memberIds) mergedElementByItem.set(memberId, id);
      const nativeGroup = index.get(group);
      nativeSources[id] = { pointer: group, pageNumbers: [pageNumber], metadata: { itemSourceIds: [...memberIds], ...(nativeGroup?.parent === undefined ? {} : { parent: nativeGroup.parent }) } };
    }
    evidence.set(pageNumber, (evidence.get(pageNumber) ?? []).map((source) => {
      const elementId = mergedElementByItem.get(source.elementId);
      return elementId === undefined ? source : { ...source, elementId };
    }));
    return output;
  };
  const layout: LayoutPage[] = numbers.map((number) => {
    const page = pages.get(number);
    const pageElements = groupedLists(number);
    return { pageNumber: number, width: scale === undefined ? 0 : (page?.width ?? 0) / scale, height: scale === undefined ? 0 : (page?.height ?? 0) / scale, elements: pageElements, evidence: evidence.get(number) ?? [] };
  });
  const document: DoctureDocument = { schemaVersion: 2, sourceDigest, ...(physicalSourceDigest === undefined ? {} : { physicalSourceDigest }), loader: "docling", method: "native-import", pages: layout, assets: [], warnings: diagnostics.map((entry) => ({ code: entry.code === "UNSUPPORTED_ASSET" ? "UNSUPPORTED_ASSET" : "LAYOUT_DEGRADED", message: `${entry.path}: ${entry.message}` })) };
  const provenance: DoclingProvenance = { version: 1, schemaVersion: "1.10.0", sourceDigest, documentDigest: `sha256:${sha256Hex(canonicalJson(document, limits))}`, sources: nativeSources, ...(physicalSourceDigest === undefined ? {} : { physicalSourceDigest }), ...(data.origin === undefined || data.origin === null ? {} : { origin: record(data.origin, "origin") }) };
  const loadedPages: LoadedPage[] = layout.map((page) => {
    const pageText = (page.evidence ?? []).map((source) => source.text).join("\n"); const image = imageByPage.get(page.pageNumber);
    return { pageNumber: page.pageNumber, width: page.width, height: page.height, text: pageText, layout: page.elements, evidence: page.evidence ?? [], ...(image === undefined ? {} : { image: async (_options, call) => { call?.signal?.throwIfAborted(); return new Uint8Array(image); } }) };
  });
  const pagesWithText = loadedPages.filter((page) => page.evidence?.some((source) => source.text.trim() !== "") === true).length;
  const form = pagesWithText === 0 ? inferForm(loadedPages.map((page) => page.text.length)) : pagesWithText === loadedPages.length ? "digital" : "mixed";
  return {
    document, diagnostics, provenance,
    source: { mimeType: typeof record(data.origin ?? {}, "origin").mimetype === "string" ? text(record(data.origin, "origin").mimetype, "origin.mimetype") : "application/vnd.docling+json", ...(typeof data.name === "string" ? { fileName: data.name } : {}), loaded: { loader: "docling", pages: loadedPages, text: loadedPages.map((page) => page.text).join("\f"), form, sourceDigest, ...(physicalSourceDigest === undefined ? {} : { physicalSourceDigest }), conversionWarnings: document.warnings, sourceMetadata: { doclingProvenance: provenance, diagnostics } } },
  };
}
