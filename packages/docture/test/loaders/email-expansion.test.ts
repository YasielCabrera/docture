import { describe, expect, it } from "vitest";
import { DocumentLoaderData, errorCodeOf, resolveSource, silentLogger } from "docture";
import { expandEmail } from "../../src/inputs/email/index.js";

const bytes = (text: string) => new TextEncoder().encode(text.replace(/\n/g, "\r\n"));
const source = (text: string) => ({ bytes: bytes(text), mimeType: "message/rfc822", fileName: "message.eml" });
const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255]);
const base64 = Buffer.from(pdf).toString("base64");
const mixed = `Message-ID: <fixture@example.test>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mixed"

--mixed
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=utf-8

Plain alternative
--alt
Content-Type: text/html; charset=utf-8

<h1>HTML body</h1><script>omit this script</script>
--alt--
--mixed
Content-Type: application/pdf
Content-Disposition: attachment; filename="../report.pdf"
Content-Transfer-Encoding: base64

${base64}
--mixed--
`;

describe("email input expansion", () => {
  it("chooses one body then preserves PDF bytes and message/part provenance", async () => {
    const expanded = await expandEmail(source(mixed));
    expect(expanded.parts).toHaveLength(2);
    const [body, attachment] = expanded.parts;
    expect(body).toMatchObject({ kind: "body", parentId: expanded.id, messageId: "<fixture@example.test>", document: { mimeType: "text/html", fileName: "body.html" } });
    expect(attachment).toMatchObject({ kind: "attachment", originalFileName: "../report.pdf", disposition: "attachment", parentId: expanded.id, document: { mimeType: "application/pdf", fileName: "attachment-1.pdf" } });
    expect(attachment?.document.bytes).toEqual(pdf);
    expect(new Set(expanded.parts.map((part) => part.id)).size).toBe(2);
    expect((await expandEmail(source(mixed))).id).toBe(expanded.id);
    expect((await expandEmail(source(mixed.replace("HTML body", "Different body")))).id).not.toBe(expanded.id);
    const loaded = await new DocumentLoaderData().load(body!.document, { signal: new AbortController().signal, logger: silentLogger });
    expect(loaded.text).toBe("# HTML body");
    expect((await resolveSource({ bytes: bytes(mixed), fileName: "message.eml" })).mimeType).toBe("message/rfc822");
    const preferred = await expandEmail(source(mixed), { bodyPreference: "text" });
    expect(preferred.parts[0]?.document.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(preferred.parts[0]?.document.bytes)).toContain("Plain alternative");
  });

  it("decodes a legacy body charset without losing characters", async () => {
    const raw = bytes("Subject: Legacy\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9");
    const result = await expandEmail({ bytes: raw, mimeType: "message/rfc822" });
    expect(new TextDecoder().decode(result.parts[0]?.document.bytes)).toBe("Café\n");
  });

  it("keeps inline CID bytes and duplicate or missing names as metadata", async () => {
    const attachment = (name: string | undefined, cid?: string) => `--m\nContent-Type: application/pdf\nContent-Disposition: ${cid ? "inline" : "attachment"}${name === undefined ? "" : `; filename="${name}"`}\n${cid ? `Content-ID: <${cid}>\n` : ""}Content-Transfer-Encoding: base64\n\n${base64}\n`;
    const message = source(`Subject: Attachments\nContent-Type: multipart/mixed; boundary=m\n\n--m\nContent-Type: text/html\n\n<p>Body<img src="cid:logo"></p>\n${attachment("same.pdf", "logo")}${attachment("same.pdf")}${attachment(undefined)}--m--\n`);
    const result = await expandEmail(message);
    expect(result.parts).toHaveLength(4);
    expect(result.parts.slice(1).map((part) => part.kind === "attachment" ? part.originalFileName : undefined)).toEqual(["same.pdf", "same.pdf", null]);
    expect(result.parts[1]).toMatchObject({ kind: "attachment", contentId: "<logo>", disposition: "inline", related: false });
    expect(result.parts.map((part) => part.document.fileName)).toEqual(["body.html", "attachment-1.pdf", "attachment-2.pdf", "attachment-3.pdf"]);
    expect((await expandEmail(message, { inlineAttachments: "omit" })).parts).toHaveLength(3);
  });

  it("keeps the sender's extension so a DOCX sent as octet-stream still resolves", async () => {
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]).toString("base64");
    const result = await expandEmail(source(`Subject: Report\nContent-Type: multipart/mixed; boundary=m\n\n--m\nContent-Type: text/plain\n\nSee attached\n--m\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="../Q3 Report.DOCX"\nContent-Transfer-Encoding: base64\n\n${docx}\n--m--\n`));
    const attachment = result.parts[1]!.document;
    expect(attachment.fileName).toBe("attachment-1.docx");
    expect((await resolveSource(attachment)).mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("keeps attached emails opaque instead of recursively expanding them", async () => {
    const result = await expandEmail(source("Subject: Forward\nContent-Type: multipart/mixed; boundary=m\n\n--m\nContent-Type: text/plain\n\nBody\n--m\nContent-Type: message/rfc822\nContent-Disposition: inline\n\nSubject: Inner\n\nInner body\n--m--\n"));
    expect(result.parts).toHaveLength(2);
    expect(result.parts[1]?.document.mimeType).toBe("message/rfc822");
    expect(new TextDecoder().decode(result.parts[1]?.document.bytes)).toContain("Subject: Inner");
  });

  it.each([
    ["maxInputBytes", 8], ["maxDecodedBytes", 8], ["maxAttachments", 0], ["maxParts", 1], ["maxHeadersBytes", 8], ["maxNestingDepth", 0],
  ] as const)("enforces the %s bound", async (key, value) => {
    const failure: unknown = await expandEmail(source(mixed), { [key]: value }).catch((error: unknown) => error);
    expect(errorCodeOf(failure)).toBe("EMAIL_INVALID");
  });

  it("rejects a headerless malformed message and preserves caller cancellation", async () => {
    await expect(expandEmail(source("not an RFC message"))).rejects.toMatchObject({
      code: "EMAIL_INVALID",
      hint: "Pass the raw RFC 822 message bytes, such as an .eml file. If the message is valid but large, raise maxInputBytes, maxAttachments or maxDecodedBytes.",
    });
    const controller = new AbortController();
    const reason = new Error("cancel email");
    controller.abort(reason);
    await expect(expandEmail(source(mixed), { signal: controller.signal })).rejects.toBe(reason);
  });
});
