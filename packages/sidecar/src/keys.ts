import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Keypair {
  privateKey: KeyObject;
  /** PEM (SPKI) — safe to send to the hub at registration. */
  publicKeyPem: string;
}

/** Spec §3.2 — the private key lives at `~/.hauddy/keys/<grant_scope_id>.key`, mode 0600. */
export function keyPathFor(grantScopeId: string): string {
  return path.join(os.homedir(), ".hauddy", "keys", `${grantScopeId}.key`);
}

export function loadOrCreateKeypair(grantScopeId: string): Keypair {
  const file = keyPathFor(grantScopeId);
  if (existsSync(file)) {
    const privateKey = createPrivateKey(readFileSync(file, "utf8"));
    return { privateKey, publicKeyPem: exportPublicKeyPem(privateKey) };
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { privateKey, publicKeyPem: exportPublicKeyPem(privateKey) };
}

function exportPublicKeyPem(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
}
