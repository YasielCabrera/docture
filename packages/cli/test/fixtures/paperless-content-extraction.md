# Saved Paperless content extraction

`paperless-content-extraction.json` is the actual output record from the deterministic
Paperless example run on 2026-10-28. The local mock Paperless 3.3.4/API 10 server
returned the complete stored OCR content. A deterministic AI SDK provider mock
extracted invoiceNumber and sellerName through the ordinary extraction pipeline.

The sourceText field is the exact content used for extraction. Its SHA-256 over
UTF-8 matches source.digest. Source identity retains the root document, selected
file version, instance, API/server versions and metadata snapshot. The localhost
port records that mock run and is not contacted by review.

This content source has no positioned or native evidence. Fields remain uncited,
citationSources is empty, and review displays logical text without physical pages
or invented source IDs. The fixture does not certify a live Paperless deployment.
