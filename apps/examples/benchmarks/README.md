# benchmarks: concurrency and raster memory

> Batch, text chunk, and vision request concurrency, Tesseract and PaddleOCR page concurrency, and raster DPI and `maxEdge`.

**Needs:** the workspace install. No API key, no corpus download. The first OCR run downloads the
Tesseract and PaddleOCR models into `~/.cache`.

```sh
pnpm --filter @docture/examples exec node benchmarks/concurrency.ts
pnpm --filter @docture/examples exec node benchmarks/concurrency.ts --reps 7 --only ocr
```

Docs: [`guides/performance`](../../docs/content/docs/extraction/performance.mdx)

Run it with plain `node`, which strips the TypeScript types on Node 22.18 or later. A
TypeScript loader such as `tsx` adds several hundred MiB to max RSS once PDF.js loads,
which hides the memory differences this script reports.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--reps <n>` | `5` | Reported runs per variant. One extra round runs first and is discarded. |
| `--only <groups>` | `model,ocr,raster` | Comma-separated scenario groups. |
| `--latency <ms>` | `100` | Fixed response time of the mock model. |
| `--json` | off | Also print every run as one JSON line. |

## What it reports

The script prints its conditions first: the command, the docture version and commit, engine
versions, CPU, memory, platform, and the load average. Then it prints one row per scenario
and variant, with the median and range of the cold time, warm time, warm throughput, CPU
cores used, max RSS, error count, and a check that the work ran. Units are the work the warm
pass completed: correct batch results, model requests, OCR pages with recognised text, or
rendered pages. Errors count every intended unit that the cold or warm pass did not
complete. When any run completed less than intended, the script lists those rows and exits
with status 1.

Each run is a fresh Node process. Cold time includes engine setup in that process, such as
loading PDF.js or starting OCR workers. Warm time repeats the same work with the same
objects. Max RSS is the peak resident memory of the whole process, worker threads included.
Variants alternate within each repetition so drift and caches favor neither.

Model rows use a deterministic mock provider built on the AI SDK's `MockLanguageModelV4`.
It waits a fixed latency and returns a fixed object. Those rows measure how docture
schedules requests. They say nothing about a real provider's speed or rate limits.
