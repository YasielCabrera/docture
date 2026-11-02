import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineModel, defineTemplate, gen, isValidIban, locales, valuePool } from "@docture/synthetic";
import { writeCorpus } from "@docture/synthetic/node";
import { z } from "zod";

const Customer = z.object({
	name: z.string(),
	routingCode: z.string(),
	accountNumber: z.string(),
	iban: z.string(),
});
const customers = defineModel(Customer, {
	fields: {
		name: gen.pattern("Customer-AAAA"),
		routingCode: gen.pattern("AAAA######"),
		accountNumber: gen.pattern("########"),
		iban: gen.iban({ country: "GB", bban: gen.from((context) => context.sibling<string>("routingCode") + context.sibling<string>("accountNumber")) }),
	},
});
const profiles = await valuePool({
	schema: Customer, revision: "customer-1", count: 2,
	source: {
		kind: "generate", id: "seeded-customers-1",
		generate: (count) => Promise.all(Array.from({ length: count }, async (_, seed) => (await customers.sample({ seed })).value)),
	},
});
for (const profile of profiles) {
	assert.ok(isValidIban(profile.iban));
	assert.equal(profile.iban.slice(4, 14), profile.routingCode);
	assert.equal(profile.iban.slice(14), profile.accountNumber);
}

const Product = z.object({ sku: z.string(), stock: z.number().int().nonnegative(), labels: z.array(z.string()) });
const products = defineModel(Product, { fields: { sku: gen.pattern("SKU-AAAA-####"), stock: gen.int(0, 500), labels: gen.array({ length: [1, 3] }), "labels[]": gen.words(1, 2) } });
const inventory = await valuePool({
	schema: Product, revision: "inventory-1", count: 2,
	source: { kind: "generate", id: "seeded-inventory-1", generate: (count) => Promise.all(Array.from({ length: count }, async (_, seed) => (await products.sample({ seed })).value)) },
});
assert.equal(inventory.length, 2);
assert.notEqual(inventory[0]?.sku, inventory[1]?.sku);

const Statement = z.object({ number: z.string(), customer: Customer });
const model = defineModel(Statement, {
	fields: { number: gen.pattern("INV-######"), customer: gen.pick(profiles) },
	dependencies: { customerPolicy: "customer-1", profiles },
});
const template = defineTemplate<z.infer<typeof Statement>>()({
	key: "bank-statement", family: "example", locale: locales["de-DE"],
	printed: { number: true, customer: { name: true, routingCode: false, accountNumber: false, iban: true } },
	draw(page, value) {
		page.field("number", value.number, { x: 40, y: 40 });
		page.field("customer.name", value.customer.name, { x: 40, y: 70 });
		page.field("customer.iban", value.customer.iban, { x: 40, y: 100 });
	},
});
const directory = await mkdtemp(join(tmpdir(), "docture-synthetic-data-"));
try {
	const plan = { model, templates: [template], seeds: [1, 2], createdAt: "2025-01-01T00:00:00Z", dependencies: { rules: "v1" } };
	assert.deepEqual((await writeCorpus(directory, plan)).failed, []);
	assert.equal((await writeCorpus(directory, plan)).skipped, 2);
	assert.equal((await writeCorpus(directory, { ...plan, dependencies: { rules: "v2" } })).written, 2);
	const metadata: unknown = JSON.parse(await readFile(join(directory, "corpus.json"), "utf8"));
	assert.ok(metadata !== null && typeof metadata === "object" && "dependencies" in metadata);
	console.log("2 inventory records, 2 customer profiles, 2 unchanged cases skipped, 2 changed cases rebuilt");
} finally {
	await rm(directory, { recursive: true, force: true });
}
