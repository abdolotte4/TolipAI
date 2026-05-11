import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getKey(): Buffer {
  // Use a dedicated ENCRYPTION_KEY so rotating JWT_SECRET doesn't invalidate
  // AES-encrypted values (Twilio auth tokens, etc.) stored in the database.
  // Fall back to JWT_SECRET only for backward-compatibility with existing rows
  // that were encrypted before ENCRYPTION_KEY was introduced.
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set — cannot encrypt/decrypt values");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptPassword(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptPassword(ciphertext: string): string {
  const key = getKey();
  const [ivHex, encHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
