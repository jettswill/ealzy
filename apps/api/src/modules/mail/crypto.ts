import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";

export function mailEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, encrypted, tag]).toString("base64")}`;
}

export function decryptSecret(payload: string, secret: string) {
  if (!payload.startsWith(PREFIX)) throw new Error("Unsupported secret encoding");
  const raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (raw.length < 29) throw new Error("Invalid secret encoding");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", mailEncryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
