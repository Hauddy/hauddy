import type { ServerResponse } from "node:http";

/**
 * One injection Hauddy pushes at a session — the delivery pipe's payload. The
 * text is fully pre-formatted so the wrapper stays trivial: it writes
 * `event.text` into the PTY verbatim and nothing else.
 *
 *   - `ring`     — an incoming call: "@caller is calling — run pickup_call …".
 *                  The ONLY unsolicited injection (spec §Calls). Everything after
 *                  is ordinary tool calls.
 *   - `validate` — a coded line for the readiness handshake; the agent reads the
 *                  code and returns it via `wake_ack` to prove injection lands.
 */
export interface Injection {
  type: "ring" | "validate";
  text: string;
  code?: string;
}

/**
 * The per-agent **injection stream** — the piece a plain-terminal PTY wrapper
 * subscribes to. MCP notifications reach the *harness's* MCP client, not a
 * wrapper that owns the session's stdin; so for the plain-terminal path the
 * daemon publishes rings (and validation codes) here instead, and the wrapper
 * writes each `text` into the PTY as a live turn.
 *
 * A dead-simple fan-out keyed by agent_id: subscribers are SSE responses; a
 * publish writes one `data:` frame to each. Zero subscribers ⇒ publish is a
 * no-op (the caller learns how many got it from the return count).
 */
export class InjectionBus {
  private sinks = new Map<string, Set<ServerResponse>>();

  /** Register an SSE response for an agent; returns an unsubscribe fn. */
  subscribe(agentId: string, res: ServerResponse): () => void {
    let set = this.sinks.get(agentId);
    if (!set) {
      set = new Set();
      this.sinks.set(agentId, set);
    }
    set.add(res);
    return () => {
      const s = this.sinks.get(agentId);
      if (!s) return;
      s.delete(res);
      if (s.size === 0) this.sinks.delete(agentId);
    };
  }

  /** How many wrappers are currently listening for this agent. */
  subscribers(agentId: string): number {
    return this.sinks.get(agentId)?.size ?? 0;
  }

  /** Push one injection to every wrapper on this agent; returns how many got it. */
  publish(agentId: string, event: Injection): number {
    const set = this.sinks.get(agentId);
    if (!set || set.size === 0) return 0;
    const frame = `event: inject\ndata: ${JSON.stringify(event)}\n\n`;
    let n = 0;
    for (const res of set) {
      try {
        res.write(frame);
        n++;
      } catch {
        /* the stream will be pruned on its own 'close' */
      }
    }
    return n;
  }
}
