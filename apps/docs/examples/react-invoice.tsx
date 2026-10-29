import { writeFile } from "node:fs/promises";
import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { defineModel, gen, locales, sumOf, type Formatter } from "@docture/synthetic";
import { defineReactTemplate, type FieldComponent } from "@docture/synthetic/react-pdf";
import { assertVerified } from "@docture/synthetic/verify";
import { z } from "zod";

const Invoice = z.object({
	invoiceNumber: z.string(),
	issuedAt: z.string(),
	customer: z.object({ name: z.string(), city: z.string() }),
	paymentMethod: z.enum(["card", "transfer"]),
	items: z.array(z.object({ description: z.string(), quantity: z.number().int(), amountCents: z.number().int() })).min(1),
	totalCents: z.number().int(),
});
type Invoice = z.infer<typeof Invoice>;

const model = defineModel(Invoice, {
	fields: {
		invoiceNumber: gen.pattern("INV-######"),
		issuedAt: gen.date({ from: "2025-01-01", to: "2025-12-31" }),
		"customer.name": gen.pick(["Dana Whitfield", "Kenji Okafor", "Ruth Ellingsen"]),
		"customer.city": gen.pick(["Leeds", "Osaka", "Bergen"]),
		items: gen.array({ length: 40 }),
		"items[].description": gen.words(2, 4),
		"items[].quantity": gen.int(1, 9),
		"items[].amountCents": gen.int(500, 90_000),
	},
	derive: (value) => ({ ...value, totalCents: value.items.reduce((sum, item) => sum + item.amountCents, 0) }),
	constraints: [sumOf("items[].amountCents", "totalCents")],
});

const styles = StyleSheet.create({
	page: { padding: 48, paddingTop: 72, fontSize: 10, fontFamily: "Helvetica" },
	running: { position: "absolute", top: 32, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#666" },
	title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 16 },
	row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderColor: "#ccc" },
	head: { fontFamily: "Helvetica-Bold", borderColor: "#000" },
	description: { flexGrow: 1, flexBasis: 0 },
	quantity: { width: 50, textAlign: "right" },
	amount: { width: 90, textAlign: "right" },
	strong: { fontFamily: "Helvetica-Bold" },
});

// A component that prints fields takes the template's typed Field as a prop.
function ItemTable({ items, format, Field }: { items: Invoice["items"]; format: Formatter; Field: FieldComponent<Invoice> }) {
	return (
		<View>
			<View fixed style={[styles.row, styles.head]}>
				<Text style={styles.description}>Description</Text>
				<Text style={styles.quantity}>Qty</Text>
				<Text style={styles.amount}>Amount</Text>
			</View>
			{items.map((item, index) => (
				<View key={index} wrap={false} style={styles.row}>
					<Field path={`items[${index}].description`} style={styles.description}>{item.description}</Field>
					<Field path={`items[${index}].quantity`} style={styles.quantity}>{format.number(item.quantity)}</Field>
					<Field path={`items[${index}].amountCents`} style={styles.amount}>{format.money(item.amountCents)}</Field>
				</View>
			))}
		</View>
	);
}

const template = defineReactTemplate<Invoice>()({
	key: "react-invoice",
	family: "invoice",
	locale: locales["en-GB"],
	printed: {
		invoiceNumber: true,
		issuedAt: true,
		customer: { name: true, city: false },
		paymentMethod: true,
		items: { items: { description: true, quantity: true, amountCents: true } },
		totalCents: true,
	},
	render: ({ value, format, Field }) => (
		<Page size="A4" style={styles.page}>
			<View fixed style={styles.running}>
				<Field path="invoiceNumber">{value.invoiceNumber}</Field>
				<Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
			</View>
			<Text style={styles.title}>Invoice</Text>
			<Field path="customer.name">{value.customer.name}</Field>
			<Field path="issuedAt" style={{ marginBottom: 16 }}>Issued {format.date(value.issuedAt)}</Field>
			<ItemTable items={value.items} format={format} Field={Field} />
			<View wrap={false} style={{ marginTop: 12, marginLeft: "auto", width: 200 }}>
				<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
					<Text style={styles.strong}>Total</Text>
					<Field path="totalCents" style={styles.strong}>{format.money(value.totalCents)}</Field>
				</View>
				<Field path="paymentMethod">{value.paymentMethod === "card" ? "Paid by card" : "Pay by bank transfer"}</Field>
			</View>
		</Page>
	),
});

const document = await template.renderDocument(await model.sample({ seed: 7 }));
await assertVerified(document);
await writeFile("invoice.pdf", document.bytes);
console.log(`${document.pages.length} pages, ${document.labels.length} labels verified`);
