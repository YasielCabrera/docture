# Pinned Docling export fixtures

`report-python.json` is the real output of `DoclingDocument.export_to_dict()` in
`docling-core==2.104.0`. Its content is synthetic laboratory text and a merged-cell
table. The fixture includes sparse pages 2 and 5, a multipage paragraph with an
astral character, and native furniture.

`report-service.json` wraps that exact export in the documented docling-serve
1.38.2 v1 in-body response shape. It is a deterministic protocol fixture. A live
docling-serve conversion was not run, and this fixture does not certify that
release's OCR, format conversion, or deployment compatibility.

`letter-python.json` is a second real Python export with appointment text and a
room-number table. It has no physical pages and exercises logical-page import.

The additional Python exports exercise list and table fidelity:

- `vertical-header-python.json` has a column header spanning two rows.
- `list-python.json` has one three-step ordered list.
- `separate-lists-python.json` has adjacent independent list groups.
- `nested-list-python.json` preserves nested source groups and tests explicit degradation.
- `continued-list-python.json` starts numbering above one and tests its retained markers and diagnostic.

Regenerate all fixtures with the bounded generator:

```sh
uv run --with 'docling-core==2.104.0' python packages/docture/test/import/fixtures/generate.py
```

The generator checks the package version, builds a small model with public Python
APIs, validates the exported trees with `validate_tree(..., raise_on_error=True)`, and exports JSON. It does not open documents, launch conversion engines,
contact a service, or use a model.

Primary definitions used for this contract:

- [docling-core 2.104.0 document model](https://github.com/docling-project/docling-core/blob/v2.104.0/docling_core/types/doc/document.py).
- [Schema version 1.10.0](https://github.com/docling-project/docling-core/blob/v2.104.0/docling_core/types/doc/common/constants.py).
- [Native reference and provenance definitions](https://github.com/docling-project/docling-core/blob/v2.104.0/docling_core/types/doc/common/reference.py).
- [Native table cells](https://github.com/docling-project/docling-core/blob/v2.104.0/docling_core/types/doc/items/table/table_data.py).
- [docling-serve 1.38.2 routes](https://github.com/docling-project/docling-serve/blob/v1.38.2/docling_serve/app.py).
