export function nativeDocument(kind: "report" | "letter" = "report") {
  const text = kind === "report" ? "Pressure report 😀AlphaBeta" : "Dear Ada, appointment Tuesday";
  const pages: Record<string, { page_no: number; size: { width: number; height: number }; rotation?: number }> = { "2": { page_no: 2, size: { width: 600, height: 800 } }, "5": { page_no: 5, size: { width: 600, height: 800 } } };
  return {
    schema_name: "DoclingDocument", version: "1.10.0", name: kind,
    origin: { filename: `${kind}.pdf`, mimetype: "application/pdf", binary_hash: 123 },
    body: { self_ref: "#/body", children: [{ $ref: "#/texts/0" }, { $ref: "#/texts/1" }, { $ref: "#/tables/0" }] },
    furniture: { self_ref: "#/furniture", children: [{ $ref: "#/texts/2" }] },
    pages,
    texts: [
      { self_ref: "#/texts/0", label: "section_header", level: 1, text: kind === "report" ? "Lab report" : "Appointment letter", prov: [{ page_no: 2, bbox: { l: 10, t: 20, r: 300, b: 40, coord_origin: "TOPLEFT" }, charspan: [0, kind === "report" ? 10 : 18] }] },
      { self_ref: "#/texts/1", label: "text", text, prov: [{ page_no: 2, bbox: { l: 10, t: 80, r: 400, b: 60, coord_origin: "BOTTOMLEFT" }, charspan: [0, Array.from(text).length] }] },
      { self_ref: "#/texts/2", label: "page_header", text: "Internal", content_layer: "furniture", prov: [{ page_no: 2, bbox: { l: 10, t: 2, r: 100, b: 12, coord_origin: "TOPLEFT" }, charspan: [0, 8] }] },
    ],
    tables: [{ self_ref: "#/tables/0", label: "table", prov: [{ page_no: 2, bbox: { l: 10, t: 100, r: 300, b: 180, coord_origin: "TOPLEFT" }, charspan: [0, 0] }], data: { num_rows: 2, num_cols: 2, table_cells: [
      { text: "Measurements", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 2, row_span: 1, col_span: 2, column_header: true, bbox: { l: 10, t: 100, r: 300, b: 120, coord_origin: "TOPLEFT" } },
      { text: kind === "report" ? "Pressure" : "Room", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1, row_span: 1, col_span: 1 },
      { text: kind === "report" ? "100" : "42", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2, row_span: 1, col_span: 1 },
    ] } }], groups: [], pictures: [],
  };
}
