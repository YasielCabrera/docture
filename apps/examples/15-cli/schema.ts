/**
 * The schema module `docture extract --schema` points at.
 *
 * A schema module may export `default`, `schema`, or a single named export. Point at one
 * export explicitly with `--schema ./schema.ts#Invoice`.
 *
 * This is a plain module with no docture import in it beyond the contract helper — which
 * is the point: the thing the CLI needs from you is the shape you want, nothing else.
 */

export { Invoice as default, Invoice, ScoredInvoice } from "../shared/contracts.js";
