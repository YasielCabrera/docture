const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    parts.push(
      ALPHABET[a >>> 2] ?? "",
      ALPHABET[((a & 3) << 4) | ((b ?? 0) >>> 4)] ?? "",
      b === undefined ? "=" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >>> 6)] ?? "",
      c === undefined ? "=" : ALPHABET[c & 63] ?? "",
    );
  }
  return parts.join("");
}
