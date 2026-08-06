import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

// Hashed once to always yield a valid 32-byte AES-256 key regardless of the
// raw secret's length/format in .env.
const key = crypto.createHash("sha256").update(env.API_KEY_ENCRYPTION_SECRET).digest();

/** Encrypts plaintext (e.g. a third-party API key) for storage at rest. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted payload format");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Last 4 characters only — safe to display/return to the client. */
export function maskKey(plaintext: string): string {
  const visible = plaintext.slice(-4);
  return `••••••••${visible}`;
}
