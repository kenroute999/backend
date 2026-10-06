import crypto from "node:crypto";
import { config } from "./config";

// Passenger phone numbers and ID proofs are stored encrypted (AES-256-GCM).
// The "v1" prefix names the key, so a future key can be introduced beside it.
const KEY_ID = "v1";

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [KEY_ID, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decrypt(stored: string): string {
  const [keyId, iv, tag, body] = stored.split(":");
  if (keyId !== KEY_ID || !iv || !tag || !body) throw new Error("Unreadable encrypted value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", config.encryptionKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** Same phone always gives the same hash, so passengers can be found by phone without decrypting. */
export function phoneHash(phone: string): string {
  return crypto.createHmac("sha256", config.phoneHashKey).update(phone).digest("hex");
}
