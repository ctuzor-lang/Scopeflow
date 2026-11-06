import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const hmac = (key: string, value: string) => createHmac("sha256", key).update(value).digest("hex");

/** URL-safe random token, used for session cookies and domain verification. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Six-digit numeric code, uniformly distributed, zero-padded. */
export const sixDigitCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
