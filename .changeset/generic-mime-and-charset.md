---
"docture": patch
---

`application/octet-stream`, `binary/octet-stream` and empty declarations no longer override the file signature or extension, and known types are matched case-insensitively. A declared `charset` now decodes text in `DocumentLoaderData`, except that a UTF-8 or UTF-16 byte order mark decides the encoding over it and is dropped from the text. `DocumentLoaderData` also reads `text/html` and `application/xhtml+xml` as HTML whatever their case or parameters, such as `Text/HTML; charset=windows-1252`, and email attachments keep the sender's file extension so an octet-stream DOCX still resolves.
