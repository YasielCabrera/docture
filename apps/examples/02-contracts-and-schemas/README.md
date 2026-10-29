# 02-contracts-and-schemas — Contracts and schemas

> `contract()` vs a bare schema, `null` vs absent, inferred types, any schema library, `resolveSchema`, typed violations.

**Needs:** `pnpm run fetch`. No API key.

```sh
pnpm --filter @docture/examples contracts
```

Docs: [`concepts/contracts`](../../docs/content/docs/extraction/schemas.mdx)

## Imports and installs

Contracts and schema helpers come from `docture`; the PDF loader comes from
`docture/loaders/pdfjs`.

For a separate application:

```sh
pnpm add docture pdfjs-dist zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

A bare Zod object is a complete, valid thing to hand `extract`. A `contract()` adds three
things only a human or a model reads — `name`, `description`, `hints` — and changes the
output type not at all.

## The part worth slowing down for

The Odoo invoice has four line items. Three carry a tax percentage; the fourth's tax
column is **blank on the page**. Those are different facts, so they get different values:

```
description               taxPercent  what that means
Beeswax XL                     15.00  taxed at this rate
Luxury Truffles                 null  no tax column on this row
```

And the document agrees, which the example checks rather than asserts: the invoice's own
tax line reads "Tax 15% on $ 112.90", and the three taxed lines come to exactly 112.90.

This is why `taxPercent` is `.nullable()` and not defaulted to `0`. A parser that silently
dropped a column and a document that genuinely has no such column **must not look the
same**. invoice2data's published truth reports `0.0` here; that is its regex defaulting,
not what the page says.

## Also in here

- The same extraction driven by raw JSON Schema instead of Zod, because the contract type
  is the AI SDK's `FlexibleSchema` — so Valibot and ArkType work unchanged too.
- `resolveSchema` → `{ flexible, jsonSchema, validate }`, which is what a strategy is
  actually handed.
- A deliberate `ContractViolationError`, with the field name and the reason.

## What to read next

[`03-loaders-and-sources`](../03-loaders-and-sources) — where the bytes come from.
