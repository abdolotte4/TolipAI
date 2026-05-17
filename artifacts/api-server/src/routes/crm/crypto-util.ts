import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  type CipherGCM,
  type DecipherGCM,
} from "crypto";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set — cannot encrypt/decrypt values");
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM (authenticated encryption).
 * Output format: "gcm:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 *
 * The "gcm:" prefix distinguishes new values from legacy AES-CBC values so
 * decryptPassword can handle both transparently.
 */
export function encryptPassword(plaintext: string): string {
  const key = getKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv) as CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "gcm:" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Decrypt a value produced by encryptPassword.
 *
 * Handles both the new AES-256-GCM format ("gcm:iv:tag:ciphertext") and the
 * legacy AES-256-CBC format ("iv:ciphertext") so existing DB rows continue to
 * work after the upgrade without a data migration.
 */
export function decryptPassword(ciphertext: string): string {
  const key = getKey();

  if (ciphertext.startsWith("gcm:")) {
    const parts = ciphertext.split(":");
    if (parts.length !== 4) throw new Error("Invalid GCM ciphertext format");
    const iv        = Buffer.from(parts[1], "hex");
    const tag       = Buffer.from(parts[2], "hex");
    const encrypted = Buffer.from(parts[3], "hex");
    const decipher  = createDecipheriv("aes-256-gcm", key, iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  // Legacy AES-256-CBC — only for values encrypted before the GCM upgrade.
  // New writes always produce the "gcm:..." format.
  const parts = ciphertext.split(":");
  if (parts.length !== 2) throw new Error("Invalid CBC ciphertext format");
  const iv        = Buffer.from(parts[0], "hex");
  const encrypted = Buffer.from(parts[1], "hex");
  const decipher  = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
