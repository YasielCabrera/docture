"""Generate bounded protocol fixtures with docling-core==2.104.0; no converter or service."""

import json
from importlib.metadata import version
from pathlib import Path

from docling_core.types.doc import BoundingBox, DoclingDocument, DocItemLabel, Size
from docling_core.types.doc.common.content_layer import ContentLayer
from docling_core.types.doc.common.origin import DocumentOrigin
from docling_core.types.doc.common.reference import ProvenanceItem
from docling_core.types.doc.items.table.table_data import TableCell, TableData


if version("docling-core") != "2.104.0":
    raise RuntimeError("Generate this compatibility fixture only with docling-core==2.104.0")


def provenance(page, content, start=0, end=None):
    return ProvenanceItem(
        page_no=page,
        bbox=BoundingBox(l=10, t=20, r=300, b=40, coord_origin="TOPLEFT"),
        charspan=(start, len(content) if end is None else end),
    )


document = DoclingDocument(
    name="pinned-lab-report",
    origin=DocumentOrigin(filename="lab-report.pdf", mimetype="application/pdf", binary_hash=123),
)
document.add_page(page_no=2, size=Size(width=600, height=800))
document.add_page(page_no=5, size=Size(width=600, height=800))
heading = "Laboratory report"
document.add_heading(text=heading, level=1, prov=provenance(2, heading))
paragraph = "The measured pressure is 100. 😀Further analysis continues on the next page."
split = paragraph.index("😀")
item = document.add_text(label=DocItemLabel.TEXT, text=paragraph, prov=provenance(2, paragraph, end=split))
item.prov.append(provenance(5, paragraph, start=split))
cells = [
    TableCell(text="Measurements", start_row_offset_idx=0, end_row_offset_idx=1, start_col_offset_idx=0, end_col_offset_idx=2, col_span=2, column_header=True),
    TableCell(text="Pressure", start_row_offset_idx=1, end_row_offset_idx=2, start_col_offset_idx=0, end_col_offset_idx=1),
    TableCell(text="100", start_row_offset_idx=1, end_row_offset_idx=2, start_col_offset_idx=1, end_col_offset_idx=2),
]
document.add_table(data=TableData(num_rows=2, num_cols=2, table_cells=cells), prov=provenance(2, ""))
header = "Internal laboratory"
document.add_text(label=DocItemLabel.PAGE_HEADER, text=header, content_layer=ContentLayer.FURNITURE, prov=provenance(2, header))
native = document.export_to_dict()
target = Path(__file__).resolve().parent
(target / "report-python.json").write_text(json.dumps(native, indent=2, ensure_ascii=False) + "\n")
(target / "report-service.json").write_text(json.dumps({"status": "success", "document": {"json_content": native}, "errors": [], "processing_time": 0.0}, indent=2, ensure_ascii=False) + "\n")
letter = DoclingDocument(name="appointment-letter", origin=DocumentOrigin(filename="appointment.epub", mimetype="application/epub+zip", binary_hash=456))
letter.add_text(label=DocItemLabel.TEXT, text="Dear Ada, your research appointment is Tuesday in room 42. Bring your laboratory report.")
letter.add_table(data=TableData(num_rows=1, num_cols=2, table_cells=[
    TableCell(text="Room", start_row_offset_idx=0, end_row_offset_idx=1, start_col_offset_idx=0, end_col_offset_idx=1),
    TableCell(text="42", start_row_offset_idx=0, end_row_offset_idx=1, start_col_offset_idx=1, end_col_offset_idx=2),
]))
(target / "letter-python.json").write_text(json.dumps(letter.export_to_dict(), indent=2, ensure_ascii=False) + "\n")

ordered_list = DoclingDocument(name="ordered-list")
group = ordered_list.add_list_group()
for index, word in enumerate(["Collect", "Analyze", "Publish"]):
    ordered_list.add_list_item(text=word, enumerated=True, marker=f"{index + 1}. ", parent=group)
ordered_list.validate_tree(ordered_list.body, raise_on_error=True)
(target / "list-python.json").write_text(json.dumps(ordered_list.export_to_dict()) + "\n")

vertical_header = DoclingDocument(name="vertical-header")
vertical_header.add_table(data=TableData(num_rows=3, num_cols=1, table_cells=[
    TableCell(text="Header", start_row_offset_idx=0, end_row_offset_idx=2, start_col_offset_idx=0, end_col_offset_idx=1, row_span=2, column_header=True),
    TableCell(text="42", start_row_offset_idx=2, end_row_offset_idx=3, start_col_offset_idx=0, end_col_offset_idx=1),
]))
vertical_header.validate_tree(vertical_header.body, raise_on_error=True)
(target / "vertical-header-python.json").write_text(json.dumps(vertical_header.export_to_dict()) + "\n")

separate_lists = DoclingDocument(name="separate-lists")
for words in [["Collect", "Analyze"], ["Publish", "Archive"]]:
    group = separate_lists.add_list_group()
    for index, word in enumerate(words):
        separate_lists.add_list_item(text=word, enumerated=True, marker=f"{index + 1}. ", parent=group)
separate_lists.validate_tree(separate_lists.body, raise_on_error=True)
(target / "separate-lists-python.json").write_text(json.dumps(separate_lists.export_to_dict()) + "\n")

nested_list = DoclingDocument(name="nested-list")
outer = nested_list.add_list_group()
nested_list.add_list_item(text="Collect", parent=outer)
inner = nested_list.add_list_group(parent=outer)
nested_list.add_list_item(text="Check", parent=inner)
nested_list.add_list_item(text="Publish", parent=outer)
nested_list.validate_tree(nested_list.body, raise_on_error=True)
(target / "nested-list-python.json").write_text(json.dumps(nested_list.export_to_dict()) + "\n")

continued_list = DoclingDocument(name="continued-list")
group = continued_list.add_list_group()
for index, word in enumerate(["Publish", "Archive"], start=3):
    continued_list.add_list_item(text=word, enumerated=True, marker=f"{index}. ", parent=group)
continued_list.validate_tree(continued_list.body, raise_on_error=True)
(target / "continued-list-python.json").write_text(json.dumps(continued_list.export_to_dict()) + "\n")
print(f"Exported schema {native['version']} with docling-core {version('docling-core')}")
