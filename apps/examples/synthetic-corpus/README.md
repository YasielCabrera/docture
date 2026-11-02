# Generate a labelled PDF corpus

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Generate invoices from a schema and a PDF template, with known values and field locations.

```sh
pnpm --filter @docture/examples synthetic
pnpm --filter @docture/examples synthetic-eval
```

`model.ts` samples the customer, quantity and price, derives a consistent total, and draws the fields. `sample.pdf` and `sample.truth.json` are checked-in output for seed 1. Running the example writes fresh copies in `output/`, plus four corpus cases from two seeds in digital and scanned form.

`evaluate.ts` reads the generated PDFs with a text-layer processor. Its digital cases should score perfectly; scanned PDFs have no text layer and therefore report omitted fields. The rendition slices make that limitation visible.

Generation remains in the code because generating documents is this example's purpose. Repeating the corpus command skips unchanged cases.
