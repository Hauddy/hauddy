import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/** Spec §2.2 — contents of `<project-root>/.hauddy/identity.toml`. */
export interface Identity {
  grant_scope_id: string;
  /** Assigned by the hub on first registration; absent until then. */
  agent_id?: string;
  endpoint: string;
  /** Human-facing local label for this runtime (the UI's `localId`). */
  local_id?: string;
  /** Optional local nickname claim (spec §2.4), bare form without '@'.
   *  Verified against the hub registry on connect; may end up in conflict. */
  nickname?: string;
}

/** Locate `.hauddy/identity.toml` by walking up from `startDir`, like git locates `.git`. */
export function findIdentityFile(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".hauddy", "identity.toml");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Locate the active identity file for a project directory, prioritizing HTTP MCP agent file over stdio. */
export function resolveActiveIdentityFile(startDir: string = process.cwd()): string | null {
  const folderName = path.basename(path.resolve(startDir));
  // Replace non-alphanumeric chars for slug matching
  const slug = folderName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  if (slug) {
    const httpFile = path.join(process.env.HOME || process.env.USERPROFILE || "~", ".hauddy", "agents", slug, "identity.toml");
    if (existsSync(httpFile)) return httpFile;
  }
  return findIdentityFile(startDir);
}

export function loadIdentity(file: string): Identity {
  const doc = parseToml(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (typeof doc.grant_scope_id !== "string" || doc.grant_scope_id.length === 0) {
    throw new Error(`${file}: grant_scope_id is required`);
  }
  if (typeof doc.endpoint !== "string" || doc.endpoint.length === 0) {
    throw new Error(`${file}: endpoint is required`);
  }
  if (doc.agent_id !== undefined && typeof doc.agent_id !== "string") {
    throw new Error(`${file}: agent_id must be a string`);
  }
  if (doc.nickname !== undefined && typeof doc.nickname !== "string") {
    throw new Error(`${file}: nickname must be a string`);
  }
  const identity: Identity = {
    grant_scope_id: doc.grant_scope_id,
    endpoint: doc.endpoint,
  };
  if (typeof doc.agent_id === "string") identity.agent_id = doc.agent_id;
  if (typeof doc.local_id === "string") identity.local_id = doc.local_id;
  if (typeof doc.nickname === "string") identity.nickname = doc.nickname;
  return identity;
}

export function writeIdentity(file: string, identity: Identity): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const doc: Record<string, string> = { grant_scope_id: identity.grant_scope_id };
  if (identity.agent_id) doc.agent_id = identity.agent_id;
  doc.endpoint = identity.endpoint;
  if (identity.local_id) doc.local_id = identity.local_id;
  if (identity.nickname) doc.nickname = identity.nickname;
  writeFileSync(file, stringifyToml(doc));
}
