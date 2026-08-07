// Crockford base32, per the ULID spec (no I, L, O, U).
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a ULID: 48-bit millisecond timestamp + 80 bits of randomness,
 * Crockford-base32 encoded into 26 characters. Monotonicity within the same
 * millisecond is not guaranteed (fine for v0.1 dedup/receipt use).
 */
export function ulid(now: number = Date.now()): string {
  let time = BigInt(now);
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[Number(time % 32n)] + timePart;
    time /= 32n;
  }
  // Global WebCrypto (runtime-agnostic: Node 22 + Cloudflare Workers) instead of
  // node:crypto, so @hauddy/protocol carries no Node-only imports.
  let rand = 0n;
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) {
    rand = (rand << 8n) | BigInt(byte);
  }
  let randPart = "";
  for (let i = 0; i < 16; i++) {
    randPart = ENCODING[Number(rand % 32n)] + randPart;
    rand /= 32n;
  }
  return timePart + randPart;
}
