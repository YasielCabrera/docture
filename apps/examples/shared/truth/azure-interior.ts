/**
 * Ground truth for the Odoo invoice (`invoice-odoo`). Inert data, kept out of the
 * examples so they stay readable; you never need to open this to follow one.
 *
 * Taken from `tests/compare/AzureInterior.json` in invoice2data, published beside the
 * PDF, and checked against the text layer by hand. It has to be COMPLETE:
 * `scoreExtraction` counts a field the extraction produced and the truth omits as a
 * hallucination, which is right for grading a real run and unhelpful if half the truth
 * is missing.
 */

export const AZURE_INTERIOR = {
  invoiceNumber: "INV/2023/03/0008",
  invoiceDate: "2023-03-20",
  dueDate: "2023-04-04",
  reference: "CUSTREF123",
  vendor: "Azure Interior",
  customer: "YourCompany, Mitchell Admin",
  currency: "USD",
  subtotal: 262.9,
  tax: 16.94,
  total: 279.84,
  lineItems: [
    {
      code: "17589684",
      description: "Beeswax XL",
      notes: "Acme beeswax",
      section: "Non Food",
      quantity: 1,
      unit: "kg",
      unitPrice: 42,
      discountPercent: 0,
      taxPercent: 15,
      amount: 42,
    },
    {
      code: "FURN_7777",
      description: "Office Chair",
      notes: null,
      section: "Non Food",
      quantity: 1,
      unit: "Units",
      unitPrice: 70,
      discountPercent: 0,
      taxPercent: 15,
      amount: 70,
    },
    {
      code: "987123",
      description: "Olive Oil",
      notes: "Our Olive Oil is delivered in a re-usable glass container",
      section: "Food Products",
      quantity: 1,
      unit: "L",
      unitPrice: 1,
      discountPercent: 10,
      taxPercent: 15,
      amount: 0.9,
    },
    {
      code: "LUX_TRF",
      description: "Luxury Truffles",
      notes: null,
      section: "Food Products",
      quantity: 15,
      unit: "g",
      unitPrice: 10,
      discountPercent: 0,
      // Genuinely untaxed, not "tax we failed to read". The invoice says "Tax 15% on
      // $ 112.90", and 112.00 + 0.90 is the other three lines, so the truffles were
      // outside the taxable base. invoice2data's own template reports 0.0 here, which
      // is its regex defaulting rather than what the page says.
      taxPercent: null,
      amount: 150,
    },
  ],
};
