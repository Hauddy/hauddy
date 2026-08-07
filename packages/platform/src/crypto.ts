// Runtime-agnostic crypto for the platform Worker (plan §4). Pure WebCrypto —
// no node:crypto, no scrypt. Ed25519 for the auth handshake, PBKDF2 for passwords.

const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** N random bytes as lowercase hex — for API keys, salts. */
export function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url string (auth nonce / signature) to bytes. */
export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A fresh base64url auth nonce (default 32 random bytes). */
export function randomNonceB64url(bytes = 32): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time-ish compare of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

/** PBKDF2-SHA256 → 256-bit hash. Pass an existing salt/iterations to verify. */
export async function hashPassword(
  password: string,
  saltHex?: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<PasswordHash> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt), iterations };
}

export async function verifyPassword(
  password: string,
  hashHex: string,
  saltHex: string,
  iterations: number,
): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex, iterations);
  return timingSafeEqualHex(hash, hashHex);
}

/** Strip a PEM SPKI wrapper and base64-decode the body to DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

/**
 * Verify an Ed25519 signature over `message` using a PEM SPKI public key
 * (the auth handshake: challenge nonce signed by the agent's key).
 */
export async function verifyEd25519(
  pemSpki: string,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(pemSpki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", key, signature, message);
  } catch {
    return false;
  }
}
