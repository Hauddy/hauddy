import crypto from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The **call ring** (spec §calls). Calls are the *synchronous* method — an
 * incoming call must interrupt the callee — whereas SMS is *asynchronous* and
 * never rings (it's read via check_messages). MCP is pull-based, so ringing an
 * idle-but-alive session means the MCP server pushes a notification the harness
 * injects as a turn. The method is negotiated in `whoami`:
 *
 *   - Claude Code   → `notifications/claude/channel` (its native injection)
 *   - any MCP harness → `notifications/session/wake`  (a thin shared method; a
 *                        harness handles it in ~10 lines — see docs/harness-shims)
 *   - no support    → can't ring; a call falls back to leaving an SMS
 *
 * This is infrastructure for calls (reserved in v0.1); SMS does NOT use it.
 */
export interface WakeChannel {
  method: string;
  transport: "stdio";
  capability?: string;
}

/**
 * The "skill" Hauddy hands the agent so it can build its own call-injection for
 * its harness (Hauddy provides guidelines; the user/agent owns the build; the
 * app then validates with a ping). Harness-detected from MCP clientInfo.
 */
export function callSetupGuide(harnessName: string | undefined): {
  harness: string;
  goal: string;
  approach: string;
  steps: string[];
  validation: string;
  docs: string;
} {
  const name = harnessName ?? "your harness";
  const launch = name.toLowerCase().includes("claude") ? "claude" : "<your launch command>";
  const validation =
    "Run `validate_calls`: Hauddy pushes a coded line down your injection stream. If your wrapper is running it types the line in, you read the code, and you call `wake_ack { code }`. That round-trip is what flips `can_receive_calls` to true. No code appears ⇒ nothing is injecting yet (wrapper not running / not subscribed) — you stay SMS-only, which is fine.";
  return {
    harness: name,
    goal: "Receive calls = let Hauddy inject a line (the ring) into this live session as a turn (not polled). Only the ring is ever injected; the rest is ordinary tool calls.",
    approach:
      `The reliable, turnkey path on any harness is Hauddy's PTY wrapper: relaunch this session as \`hauddy wrap ${launch}\`. It owns the session's stdin, auto-subscribes to your injection stream, and types injected turns in — no code to write.` +
      (name.toLowerCase().includes("claude")
        ? " (Claude Code's experimental `notifications/claude/channel` is used opportunistically if your build actually surfaces it, but it's preview-gated — don't rely on it.)"
        : " (Alternatively, if your harness dispatches MCP notifications, handle `notifications/session/wake` yourself instead of wrapping.)"),
    steps: [
      `Exit this session, then relaunch it wrapped: \`hauddy wrap ${launch}\` (append whatever flags you normally pass).`,
      "In the wrapped session, run `whoami` so Hauddy provisions this agent — the wrapper then auto-subscribes to your per-agent injection stream.",
      "Run `validate_calls`; the coded line is typed into your session by the wrapper — read the code and call `wake_ack { code }`.",
    ],
    validation,
    docs: name.toLowerCase().includes("claude")
      ? "docs/harness-shims/plain-terminal.md, claude-code.md"
      : "docs/harness-shims/plain-terminal.md, generic-mcp.md",
  };
}

/** Choose the wake method for the connected harness (from MCP clientInfo.name). */
export function wakeChannelFor(harnessName: string | undefined): WakeChannel {
  const name = (harnessName ?? "").toLowerCase();
  if (name.includes("claude")) {
    return { method: "notifications/claude/channel", transport: "stdio", capability: "experimental/claude/channel" };
  }
  return { method: "notifications/session/wake", transport: "stdio" };
}

/**
 * Push an incoming message into the harness session as a wake notification.
 * Best-effort: a harness that ignores unknown notifications is unaffected —
 * the message is still in the inbox for `check_messages`. `from` is asserted by
 * Hauddy (never trusted from payload text).
 */
export function emitWake(server: McpServer, from: string, body: string): void {
  const channel = wakeChannelFor(server.server.getClientVersion()?.name);
  const notification =
    channel.method === "notifications/claude/channel"
      ? { method: channel.method, params: { content: `<channel source="hauddy" from="${from}">${body}</channel>` } }
      : { method: channel.method, params: { from, message: body, source: "hauddy", urgency: "normal" } };
  // Custom notification method — cast past the SDK's typed server-notification union.
  void server.server.notification(notification as never).catch(() => {});
}

/**
 * The call-readiness **handshake** (agent-in-the-loop, spec §Calls). The agent
 * builds its own injection, then asks the app to validate: `begin()` injects a
 * coded ping through the wake channel; if injection works, the code lands in the
 * session, the agent reads it and returns it (`wake_ack`), and `ack()` confirms.
 * Matched ⇒ call-ready. No round-trip ⇒ SMS-only (still fully reachable).
 */
export class CallValidation {
  callReady = false;
  private code: string | null = null;

  /**
   * Inject a coded validation ping via the MCP wake channel and return the
   * `{ code, text }` so the caller can ALSO push it down the daemon's per-agent
   * injection stream (the plain-terminal wrapper path). The agent proves
   * injection — whichever channel reached it — by returning the code.
   */
  begin(server: McpServer): { code: string; text: string } {
    this.code = crypto.randomBytes(3).toString("hex");
    const channel = wakeChannelFor(server.server.getClientVersion()?.name);
    const text = `Hauddy call-validation. If you can read this, call the tool wake_ack with { code: "${this.code}" } — confirming Hauddy can inject into this live session, so you can receive calls.`;
    const notification =
      channel.method === "notifications/claude/channel"
        ? { method: channel.method, params: { content: `<channel source="hauddy" validate="1">${text}</channel>` } }
        : { method: channel.method, params: { validate: true, code: this.code, message: text, source: "hauddy" } };
    void server.server.notification(notification as never).catch(() => {});
    return { code: this.code, text };
  }

  /** The agent returns the code it saw. Match ⇒ call-ready. */
  ack(code: string): boolean {
    if (this.code && code === this.code) {
      this.callReady = true;
      this.code = null;
      return true;
    }
    return false;
  }
}
