---
"docture": minor
---

Give every `DoctureError` a `hint` naming the next step, serialize every diagnostic field and cause in `toJSON()`, and let `isDoctureError(error, code)` narrow to that code's error class. For a core code the check matches only an instance of that class, from any installed copy, so the narrowed fields exist at runtime: an error that copies its cause's code, such as eval's priced failure, does not match, while `errorCodeOf` still returns the copied code. `LOAD_FAILED` narrows to `LoadFailedError` with `attempts` always present. `PaperlessError` and `DoclingImportError` now extend `UnsupportedSourceError`, so they match `"UNSUPPORTED_SOURCE"`. `errorCodeOf` now returns the `DoctureErrorCode` union, and `isCallerAbort(error, signal)` tells a caller's cancel from a component's own timeout. The serialized fields can include `rawOutput` and validation `issues`, which may hold document text; redact them before shipping errors to an external log.

`DoclingServeError`, `MammothDocumentError` and `EmailInputError` now carry their own codes, `DOCLING_FAILED`, `DOCX_FAILED` and `EMAIL_INVALID`, each with a hint. Inside a pipeline they appear as a loader attempt's `errorCode`.
