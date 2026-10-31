import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(provider: string) {
  if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required for integration encryption");
  return createHash("sha256").update(`lifeos-${provider}:${process.env.BETTER_AUTH_SECRET}`).digest();
}
export function sealIntegration(provider: string, value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(provider), iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
export function openIntegration(provider: string, value: string) {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 28) throw new Error("Invalid encrypted integration token");
  const decipher = createDecipheriv("aes-256-gcm", key(provider), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}
