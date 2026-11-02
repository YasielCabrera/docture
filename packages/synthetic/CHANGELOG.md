# @docture/synthetic

## Unreleased

- Compose IBAN strings from caller-generated country and BBAN fields with `gen.iban({ country, bban })`. Record shapes and national formatting stay in the consuming schema.
- Build validated structured pools with `valuePool` and `llmObjectPool`, including offline cache-only reads and schema transformations.
- Track declared model and corpus dependencies in case freshness and hashed corpus provenance. Record optional peer versions, including Faker and AI, without loading their engines.
