/**
 * Generates an RFC 4122 v4 UUID that does not depend on a secure context.
 *
 * `crypto.randomUUID` is only exposed on HTTPS or localhost, so on an instance
 * served over plain HTTP it is `undefined` and calling it throws a TypeError.
 * In the task composer that happened before the request was issued, which is why
 * a click on Send could silently do nothing and leave no `POST /comments`
 * behind. `crypto.getRandomValues` is not restricted to secure contexts, so it
 * backs a spec-conformant UUID here, with `Math.random` as the last resort so an
 * identifier is always produced.
 */
export function randomUuid(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
