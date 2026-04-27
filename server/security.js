import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function generateApiKey(scope) {
  return `do_${scope}_${randomBytes(32).toString("base64url")}`;
}

export function generateSessionToken() {
  return `do_session_${randomBytes(32).toString("base64url")}`;
}

export function generateId(prefix) {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

export function hashSecret(secret) {
  return createHash("sha256").update(String(secret)).digest("hex");
}

export function getSecretPrefix(secret) {
  return String(secret).slice(0, 16);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(String(password), salt, PASSWORD_KEY_LENGTH);
  return `scrypt:${salt}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash ?? "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(String(password), salt, expected.length);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
