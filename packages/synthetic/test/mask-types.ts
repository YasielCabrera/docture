import { gen, prints, type ConcretePath, type Fields, type PathPattern, type PrintedMask, type ValueAt } from "../src/index.js";

interface Doc {
  id: string;
  total: number;
  note?: string;
  party: { name: string; address: { city: string } | null };
  rows: { label: string; amount: number }[];
}

export const complete: PrintedMask<Doc> = {
  id: true,
  total: prints((total: number) => total / 100),
  note: (note, _root, parent) => note.length > 0 && parent.total > 0,
  party: { name: true, address: { city: true } },
  rows: { items: { label: true, amount: (amount, _root, row) => amount > 0 && row.label !== "" } },
};

// @ts-expect-error A mask that leaves out `note`, an optional field, does not compile.
export const missingOptional: PrintedMask<Doc> = { id: true, total: true, party: true, rows: true };

// @ts-expect-error A nested object must declare every key, too.
export const missingNested: PrintedMask<Doc> = { id: true, total: true, note: false, party: { name: true }, rows: true };

export const patterns: PathPattern<Doc>[] = ["rows[].amount", "party.address.city", "rows"];
// @ts-expect-error A pattern names a schema position, not an index.
export const indexedPattern: PathPattern<Doc> = "rows[0].amount";
export const concrete: ConcretePath<Doc> = `rows[${3 as number}].amount`;

export const amount: ValueAt<Doc, "rows[].amount"> = 1;
// @ts-expect-error The value at `party.name` is a string.
export const wrongValue: ValueAt<Doc, "party.name"> = 1;

export const fields: Fields<Doc> = { "rows[].amount": gen.int(1, 9), rows: gen.array({ length: 3 }) };
// @ts-expect-error A generator must produce the position's type.
export const wrongGenerator: Fields<Doc> = { "rows[].amount": gen.pattern("##") };

export const concreteField: Fields<Doc> = { "rows[0].amount": gen.int(1, 2) };
// @ts-expect-error A concrete position's generator must produce that position's type.
export const wrongConcreteField: Fields<Doc> = { "rows[0].amount": gen.pattern("#") };
