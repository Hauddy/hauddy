import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/** Machine-level account config at `~/.hauddy/account.toml` (spec §2.5).
 *  Holds the platform API key the whole daemon rides on — never per-project. */
export interface AccountConfig {
  endpoint: string;
  account_id?: string;
  email?: string;
  api_key?: string;
}

export function hauddyHome(): string {
  return path.join(os.homedir(), ".hauddy");
}

export function accountFile(): string {
  return path.join(hauddyHome(), "account.toml");
}

export function loadAccount(): AccountConfig | null {
  const file = accountFile();
  if (!existsSync(file)) return null;
  const doc = parseToml(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (typeof doc.endpoint !== "string" || doc.endpoint.length === 0) return null;
  const cfg: AccountConfig = { endpoint: doc.endpoint };
  if (typeof doc.account_id === "string") cfg.account_id = doc.account_id;
  if (typeof doc.email === "string") cfg.email = doc.email;
  if (typeof doc.api_key === "string") cfg.api_key = doc.api_key;
  return cfg;
}

export function saveAccount(cfg: AccountConfig): void {
  mkdirSync(hauddyHome(), { recursive: true });
  const doc: Record<string, string> = { endpoint: cfg.endpoint };
  if (cfg.account_id) doc.account_id = cfg.account_id;
  if (cfg.email) doc.email = cfg.email;
  if (cfg.api_key) doc.api_key = cfg.api_key;
  writeFileSync(accountFile(), stringifyToml(doc), { mode: 0o600 });
}

/** Drop the platform link (disconnect). The account still exists on the
 *  platform — reconnect with the same key to re-attach. */
export function clearAccount(): void {
  const file = accountFile();
  if (existsSync(file)) rmSync(file);
}

/** Display form of an API key, e.g. `sk_live_••••3f2a`. */
export function maskKey(apiKey: string): string {
  return `sk_live_••••${apiKey.replace(/[^a-z0-9]/gi, "").slice(-4) || "0000"}`;
}
