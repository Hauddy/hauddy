import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hauddyHome } from "./account.js";

/** Grant scopes enrolled on this machine, so the per-machine daemon knows what
 *  to connect. Written by `init`, read by `daemon` (spec §3.2). */
export interface RegistryAgent {
  grant_scope_id: string;
  local_id: string;
  identity_file: string;
}

export interface Registry {
  account_id?: string;
  agents: RegistryAgent[];
}

export function registryFile(): string {
  return path.join(hauddyHome(), "agents.json");
}

export function loadRegistry(): Registry {
  const file = registryFile();
  if (!existsSync(file)) return { agents: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Registry;
    return { account_id: parsed.account_id, agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch {
    return { agents: [] };
  }
}

export function saveRegistry(registry: Registry): void {
  mkdirSync(hauddyHome(), { recursive: true });
  writeFileSync(registryFile(), JSON.stringify(registry, null, 2));
}

/** Insert or update a grant scope's registry entry (idempotent by grant_scope_id). */
export function upsertAgent(entry: RegistryAgent, accountId?: string): void {
  const registry = loadRegistry();
  if (accountId) registry.account_id = accountId;
  const i = registry.agents.findIndex((a) => a.grant_scope_id === entry.grant_scope_id);
  if (i >= 0) registry.agents[i] = entry;
  else registry.agents.push(entry);
  saveRegistry(registry);
}
