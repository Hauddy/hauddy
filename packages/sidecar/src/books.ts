import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { slugifyNickname } from "@hauddy/protocol";
import { hauddyHome } from "./account.js";

export type BookPresence = "online" | "delay" | "offline";

/** One entry in an agent's contact book, resolved for the UI. */
export interface BookContact {
  /** Display handle, e.g. `@ada`. */
  handle: string;
  presence: BookPresence;
  /** `local` = resolves to an agent on this machine; `network` = a handle we
   *  don't hold locally (reachable once the platform tier ships). */
  origin: "local" | "network";
  description: string | null;
}

/** Minimal shape of a hub agent needed to resolve a book handle. */
export interface AgentLike {
  nickname?: string | null;
  nicknames?: string[];
  attached?: boolean;
  description?: string | null;
}

/**
 * Per-agent contact books, persisted to `~/.hauddy/books.json` as
 * `{ [agentId]: handle[] }`. A book is the human-curated address list the app
 * shows for one local agent; a handle is a plain `@nickname` that may or may
 * not resolve on this machine (local vs. web — see {@link resolveBook}). This
 * class is persistence only; presence/origin resolution is the pure
 * {@link resolveBook} helper so it can be exercised without a running hub.
 */
export class ContactBookStore {
  private readonly file: string;
  private data: Record<string, string[]> | null = null;

  constructor(dir: string = hauddyHome()) {
    this.file = path.join(dir, "books.json");
  }

  private load(): Record<string, string[]> {
    if (this.data) return this.data;
    try {
      this.data = existsSync(this.file)
        ? (JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string[]>)
        : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.load(), null, 2));
  }

  list(agentId: string): string[] {
    return [...(this.load()[agentId] ?? [])];
  }

  /** Add a handle (slug-normalised, `@` stripped) to an agent's book. Idempotent. */
  add(agentId: string, rawHandle: string): { ok: boolean; handle?: string; error?: string } {
    const handle = slugifyNickname(rawHandle);
    if (!handle) return { ok: false, error: "invalid handle" };
    const data = this.load();
    const book = (data[agentId] ??= []);
    if (!book.includes(handle)) {
      book.push(handle);
      this.save();
    }
    return { ok: true, handle };
  }

  remove(agentId: string, rawHandle: string): void {
    const handle = slugifyNickname(rawHandle) ?? rawHandle.trim().toLowerCase().replace(/^@+/, "");
    const data = this.load();
    const book = data[agentId];
    if (!book) return;
    const next = book.filter((h) => h !== handle);
    if (next.length !== book.length) {
      data[agentId] = next;
      this.save();
    }
  }

  /** Remove a handle from **every** agent's book — the "unlink everywhere" the
   *  pool exposes on a contact. Returns how many books it was removed from. */
  removeEverywhere(rawHandle: string): number {
    const handle = slugifyNickname(rawHandle) ?? rawHandle.trim().toLowerCase().replace(/^@+/, "");
    const data = this.load();
    let removed = 0;
    for (const id of Object.keys(data)) {
      const book = data[id]!;
      const next = book.filter((h) => h !== handle);
      if (next.length !== book.length) {
        data[id] = next;
        removed += 1;
      }
    }
    if (removed > 0) this.save();
    return removed;
  }

  /** Drop an agent's own book wholesale (used when the agent is deleted). */
  dropAgent(agentId: string): void {
    const data = this.load();
    if (data[agentId]) {
      delete data[agentId];
      this.save();
    }
  }
}

const bareHandle = (s: string | null | undefined) => (s ?? "").replace(/^@+/, "");

/** Resolve stored bare handles against the machine's agents into UI contacts.
 *  Agent nicknames from the hub are `@`-prefixed (see `formatNickname`); stored
 *  handles are bare — so both sides are normalised before comparison. */
export function resolveBook(handles: string[], agents: AgentLike[]): BookContact[] {
  return handles.map((handle) => {
    const match = agents.find(
      (a) => bareHandle(a.nickname) === handle || (a.nicknames ?? []).some((n) => bareHandle(n) === handle),
    );
    if (match) {
      return {
        handle: `@${handle}`,
        presence: match.attached ? "online" : "delay",
        origin: "local",
        description: match.description ?? null,
      };
    }
    return { handle: `@${handle}`, presence: "offline", origin: "network", description: null };
  });
}

/** One entry in the machine's **profile pool** — the finite address list every
 *  agent's book is picked from. In the friendship model the pool is *derived*,
 *  not hand-curated: local agents (origin `local`) ∪ your friends' agents
 *  (origin `network`). `removable` stays for UI compat but is always false —
 *  you change the pool by adding/removing *friends*, not handles. */
export interface PoolContact extends BookContact {
  removable: boolean;
}

/** A friend's agent, reachable through the relay (spec §"friends" allow-all). */
export interface RemoteFriend {
  /** `@handle` (or bare). */
  handle: string;
  online: boolean;
  description?: string | null;
}

/** Bare nicknames of every agent on this machine (they auto-join the pool). */
export function localAgentHandles(agents: AgentLike[]): string[] {
  const out = new Set<string>();
  for (const a of agents) {
    const primary = bareHandle(a.nickname);
    if (primary) out.add(primary);
    for (const n of a.nicknames ?? []) {
      const b = bareHandle(n);
      if (b) out.add(b);
    }
  }
  return [...out];
}

/** Build the profile pool: this machine's agents (local) ∪ friend agents
 *  (network), deduped by handle (a local agent wins over a same-named friend). */
export function buildPool(agents: AgentLike[], remotes: RemoteFriend[]): PoolContact[] {
  const local: PoolContact[] = resolveBook(localAgentHandles(agents), agents).map((c) => ({ ...c, removable: false }));
  const seen = new Set(local.map((c) => bareHandle(c.handle)));
  const remote: PoolContact[] = [];
  for (const r of remotes) {
    const bare = bareHandle(r.handle);
    if (!bare || seen.has(bare)) continue;
    seen.add(bare);
    // A friend that's offline is still reachable with delay (messages queue).
    remote.push({ handle: `@${bare}`, presence: r.online ? "online" : "delay", origin: "network", description: r.description ?? null, removable: false });
  }
  return [...local, ...remote];
}

/** Resolve an agent's stored book handles against the current pool (so both
 *  local agents and remote friends get live presence/origin). */
export function resolveBookAgainstPool(handles: string[], pool: PoolContact[]): BookContact[] {
  return handles.map((h) => {
    const bare = bareHandle(h);
    const match = pool.find((c) => bareHandle(c.handle) === bare);
    return match
      ? { handle: match.handle, presence: match.presence, origin: match.origin, description: match.description }
      : { handle: `@${bare}`, presence: "offline", origin: "network", description: null };
  });
}
