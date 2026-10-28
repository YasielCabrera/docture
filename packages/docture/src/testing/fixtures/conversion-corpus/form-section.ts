import type { ConversionCase } from "./case.js";
import { corpusDocument, type CorpusCell, type CorpusLine } from "./layout.js";

const receipt = (y: number, fontSize: number, height: number, ...cells: readonly CorpusCell[]): CorpusLine => ({ y, cells, fontSize, height });

export const formSection: ConversionCase = {
  id: "form-section",
  description: "A hotel receipt puts `Booking ID` and `Payment Mode` with their values under the `Check In`/`Check Out`/`Rooms` table, in the same columns. They are a separate form section, so no table takes them. Without them the two `Check In` rows are not table evidence either, so both groups stay text in reading order, as MuPDF reads them. The lines are the invoice-oyo receipt as read by PDF.js.",
  loaded: corpusDocument({
    width: 595,
    height: 842,
    lines: [
      receipt(41.8, 8.32, 8.3, ["PAYMENT RECEIPT", 119.8, 79.9]),
      receipt(77, 8.32, 8.3, ["Guest Name: Sanjay", 42.4, 77.1], ["Date: 31/12/2017", 420, 63.5]),
      receipt(107.7, 8.32, 8.3, ["Hotel Details", 45.6, 50], ["Check In", 317, 34.5], ["Check Out", 404.6, 41.1], ["Rooms", 492.3, 28.3]),
      receipt(118.6, 8.32, 8.3, ["OYO 4189 Resort Nanganallur,", 45.6, 114.3], ["31/12/2017", 317, 41.1], ["01/01/2018", 404.6, 41.1], ["1", 492.3, 4.6]),
      receipt(129.4, 8.32, 8.3, ["25,Vembuliamman Koil Street,, Pazhavanthangal, Chennai", 45.6, 217.5]),
      receipt(142.2, 8.32, 8.3, ["Booking ID", 317, 44.4], ["Payment Mode", 404.6, 59]),
      receipt(153.1, 8.32, 8.3, ["IBZY2087", 317, 37.2], ["Cash at Hotel", 404.6, 50.5]),
      receipt(192.2, 8.32, 8.3, ["DESCRIPTION", 54.6, 57.2], ["RATE", 448.2, 22.1], ["AMOUNT", 497.4, 35.8]),
      receipt(229.3, 7.68, 8.3, ["Room Charges", 51.4, 53.1], ["Rs 1939 x 1 Night x 1 Room", 356, 104.8, 8.32], ["Rs 1939", 502.6, 30.8, 8.32]),
      receipt(266.4, 7.68, 8.3, ["Grand Total", 51.4, 40.7], ["Rs 1939", 502.6, 30.8, 8.32]),
      receipt(303.5, 7.68, 8.3, ["Payment received by OYO", 51.4, 91.7], ["Paid through Cash At Hotel (Rs 1939)", 321.4, 139.7, 8.32], ["Rs 1939", 502.6, 30.8, 8.32]),
      receipt(341.3, 8.96, 9, ["Balance ( if any )", 54.6, 73.4], ["Rs 0", 520.5, 19]),
      receipt(393.1, 8.96, 9, ["Please Note:", 41.1, 54.8], ["Amount payable is inclusive of Central & State Goods & Services Tax at applicable slab rates. Please ask Hotel", 98.7, 448.1]),
      receipt(405.3, 8.96, 9, ["for invoice at the time of check-out.", 41.1, 142]),
      receipt(443.7, 8.32, 8.3, ["Note : All Payment to be made in favor of", 58.4, 163.4]),
      receipt(454.6, 8.32, 8.3, ["Oravel Stays Pvt. Ltd.", 58.4, 85.5]),
      receipt(487.2, 7.68, 7.7, ["Bank Name", 58.4, 42.6], ["Account No.", 318.2, 45]),
      receipt(497.4, 8.32, 8.3, ["HDFC Bank", 58.4, 43.8], ["00030340067212", 318.2, 62.8]),
      receipt(520.5, 7.68, 7.7, ["Address", 58.4, 31.1], ["IFSC CODE", 318.9, 41.6]),
      receipt(530.7, 8.32, 8.3, ["209-214, Kailash Building26, Kasturba Gandhi Marg,", 58.4, 193.7], ["HDFC0000003", 318.9, 53.9]),
      receipt(541.6, 8.32, 8.3, ["New Delhi,", 58.4, 39.4]),
      receipt(552.5, 8.32, 8.3, ["New Delhi - 110001", 58.4, 71.8]),
      receipt(580.6, 8.96, 9, ["GSTIN", 57.1, 27.5], ["CIN", 301.6, 15.4]),
      receipt(601.1, 8.32, 8.3, ["06AABCO6063D1ZQ", 57.1, 78.1], ["U63090DL2012PTC231770", 301.6, 100.6]),
      receipt(633.1, 8.32, 8.3, ["Oravel Stays Private Limited", 240.8, 112.6]),
      receipt(652.3, 8.32, 8.3, ["Registered Office:", 76, 70.6], ["Delhi Rectangle Regus, Level 4, Rectangle 1, Commercial Complex D-4, Saket, New Delhi - 110017", 149, 369.4]),
      receipt(671.5, 8.32, 8.3, ["Corporate Office:", 57.1, 67.4], ["9th floor, Spaze Palazo, Southern Peripheral Road, Sec-69, Gurgaon -122001 | Phone: 080 100 444 66 | Email:", 126.9, 410]),
      receipt(682.4, 8.32, 8.3, ["contactus@oyorooms.com", 247.2, 99.7]),
    ],
  }),
  checks: [
    { id: "form-section/booking-id-outside-tables", kind: "absent", text: "Booking ID", element: "table" },
    { id: "form-section/stay-dates-before-booking", kind: "order", before: "01/01/2018", after: "Booking ID" },
    { id: "form-section/booking-id-kept", kind: "present", text: "Booking ID", page: 1 },
    { id: "form-section/booking-before-charges", kind: "order", before: "IBZY2087", after: "Room Charges" },
  ],
};
