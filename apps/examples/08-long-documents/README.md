# 08-long-documents — Long documents

> the three completion strategies, chunking at page boundaries, `relaxJsonSchema`, `mergePartials`.

**Needs:** `pnpm fetch`. The chunking half runs with no key; the model runs need `AI_GATEWAY_API_KEY`.

```sh
pnpm --filter @docture/examples long
```

Docs: [`guides/long-documents`](../../docs/content/docs/guides/long-documents.mdx)

## What you learn

| `completion` | Requests for the 6-page statement | Use when |
|---|---|---|
| `"forbidden"` *(default)* | 1 | it fits. Most of the time |
| `"paginate"` | 6 | pages are self-contained rows |
| `"concatenate"` | 2 | many small pages |

`forbidden` is the default and it is the right default: most documents fit, and a library
that silently split them would make a cost report a guess.

## The chunker refuses to cut a page

```
    budget    chunks    largest chunk  over budget?
     6,000         2            7,698  yes
       500         6            7,698  yes — a whole page
```

7,698 characters in **both** rows. That is page 6, and it is over budget either way — so
it was sent whole rather than cut. Half a table is not half an answer; it is no answer,
twice. What the budget changes is the *count*: pages get packed under it, never sliced to
fit it.

## The subtlety that makes multi-request extraction work

Page 4 of a statement has no `accountNumber` on it — that is on page 1. Send page 4
against the full schema and the model is being asked for a field the fragment does not
contain, so it either fails or invents one.

So every fragment request goes against a **relaxed** schema — `required` stripped, types
kept — and only the **merge** is validated against the real contract. "Any subset is
acceptable" is exactly true of a fragment and exactly false of the whole.

## And the failure mode to watch for

A per-page request cannot see page 1 while reading page 3, so a total that has to
reconcile against earlier rows is exactly what pagination gets wrong. Reconcile the merge
— example 12.

## What to read next

[`09-scanned-and-ocr`](../09-scanned-and-ocr) — no text layer.
