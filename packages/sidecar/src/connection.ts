import { EventEmitter } from "node:events";
import { sign, type KeyObject } from "node:crypto";
import { WebSocket } from "ws";
import {
  controlFrameSchema,
  mintMessageId,
  nowIso,
  PROTOCOL_VERSION,
  type Attachment,
  type AuthRejectedFrame,
  type Envelope,
  type NicknameStatus,
  type Presence,
  type ReceiptStatus,
} from "@hauddy/protocol";
import { SIDECAR_VERSION } from "./version.js";

export interface HubConnectionOptions {
  endpoint: string;
  agentId: string;
  grantScopeId: string;
  privateKey: KeyObject;
  /** Optional local nickname claim sent in auth_hello (spec §2.4). */
  nickname?: string;
  /**
   * Bridge mode: this connection is the daemon's upstream link to the platform
   * on behalf of an exposed agent, not an interactive session. Every delivered
   * envelope (sms OR any call frame) is acked and re-emitted verbatim as
   * `"envelope"` for the daemon to inject into the local hub — nothing is
   * buffered for check_messages / the call tools (that happens on the agent's
   * own session connection to the *local* hub).
   */
  raw?: boolean;
}

export interface SmsReceipt {
  id: string;
  status: ReceiptStatus;
}

/** A frame of a synchronous call (spec §Calls), carried on an sms envelope's payload. */
export interface CallFrame {
  id: string;
  kind: "invite" | "accept" | "frame" | "close";
  from: string; // agent_id, hub-asserted
  body?: string;
  /** Files sent with this spoken line (fetch with receive_file). */
  attachments?: Attachment[];
}

interface PendingReceipt {
  resolve: (receipt: SmsReceipt) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * One persistent outbound WebSocket per grant scope (spec §3.2, §8). Runs the
 * Ed25519 challenge-response handshake, reconnects with exponential backoff,
 * acks deliveries immediately, and buffers them locally for check_messages.
 *
 * Events: "ready" (presence snapshot), "message" (Envelope), "disconnected",
 * "protocol_error" (ErrorFrame), "socket_error" (Error).
 */
export class HubConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;
  private ready = false;
  private rejection: Pick<AuthRejectedFrame, "reason" | "min_version" | "latest_version"> | null = null;
  private inbox: Envelope[] = [];
  /** Buffered incoming call frames (spec §Calls), drained by the call tools. */
  private calls: CallFrame[] = [];
  /** The call this session is currently on, or null. */
  activeCall: { id: string; peer: string } | null = null;
  private pendingReceipts = new Map<string, PendingReceipt>();
  /** Verification state of our nickname, updated from each auth_ok (spec §2.4). */
  private nickname: string | null = null;
  private nicknameStatus: NicknameStatus = "none";
  /** The bare nickname claim re-sent in auth_hello on every (re)connect. */
  private nicknameClaim: string | null;

  constructor(private readonly opts: HubConnectionOptions) {
    super();
    this.nicknameClaim = opts.nickname ?? null;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.failPending(new Error("connection stopped"));
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Coarse lifecycle state for the local UI. */
  getConnectionState(): "connected" | "connecting" | "disconnected" | "rejected" {
    if (this.ready) return "connected";
    if (this.rejection) return "rejected";
    if (this.stopped || !this.ws) return "disconnected";
    return "connecting";
  }

  getRejection(): Pick<AuthRejectedFrame, "reason" | "min_version" | "latest_version"> | null {
    return this.rejection;
  }

  getNickname(): string | null {
    return this.nickname;
  }

  getNicknameStatus(): NicknameStatus {
    return this.nicknameStatus;
  }

  /** Reflect a nickname claim that succeeded out-of-band (HTTP rename), so
   *  state is current immediately and the new claim survives a reconnect. */
  setVerifiedNickname(nickname: string): void {
    this.nickname = nickname;
    this.nicknameStatus = "verified";
    this.nicknameClaim = nickname.startsWith("@") ? nickname.slice(1) : nickname;
    this.emit("nickname", { nickname, status: this.nicknameStatus });
  }

  private connect(): void {
    const ws = new WebSocket(this.opts.endpoint);
    this.ws = ws;
    ws.on("open", () => {
      this.sendRaw({
        type: "auth_hello",
        agent_id: this.opts.agentId,
        grant_scope_id: this.opts.grantScopeId,
        ...(this.nicknameClaim ? { nickname: this.nicknameClaim } : {}),
        client_version: SIDECAR_VERSION,
      });
    });
    ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    ws.on("error", (err: Error) => this.emit("socket_error", err));
    ws.on("close", () => {
      this.ready = false;
      this.failPending(new Error("hub connection closed"));
      this.emit("disconnected");
      if (!this.stopped) {
        // Exponential backoff is the sidecar's job (spec §8).
        const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    });
  }

  private onMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = controlFrameSchema.safeParse(json);
    if (!parsed.success) return;
    const frame = parsed.data;

    switch (frame.type) {
      case "auth_challenge": {
        const signature = sign(null, Buffer.from(frame.nonce, "base64url"), this.opts.privateKey).toString(
          "base64url",
        );
        this.sendRaw({ type: "auth_response", signature });
        return;
      }
      case "auth_rejected": {
        this.rejection = { reason: frame.reason, min_version: frame.min_version, latest_version: frame.latest_version };
        this.stopped = true; // no retry storm — this is operator-action-required
        this.emit("auth_rejected", this.rejection);
        return;
      }
      case "auth_ok": {
        this.rejection = null;
        this.attempt = 0;
        this.ready = true;
        this.nickname = frame.nickname;
        this.nicknameStatus = frame.nickname_status;
        this.emit("ready", frame.presence as Presence[]);
        this.emit("nickname", { nickname: this.nickname, status: this.nicknameStatus });
        return;
      }
      case "deliver": {
        this.sendRaw({ type: "ack", id: frame.envelope.id });
        // Bridge (upstream) connections are a dumb pipe: hand the whole envelope
        // to the daemon, which re-injects it into the local hub. Don't buffer.
        if (this.opts.raw) {
          this.emit("envelope", frame.envelope);
          return;
        }
        const payload = frame.envelope.payload as {
          body?: unknown;
          call?: { id?: unknown; kind?: unknown };
          attachments?: Attachment[];
        };
        const call = payload?.call;
        if (call && typeof call.id === "string" && typeof call.kind === "string") {
          // Call frame (sync) — rides on the envelope's payload. Only an *invite*
          // rings (injects); accept/frame/close are fetched by the blocking tools.
          const cf: CallFrame = {
            id: call.id,
            kind: call.kind as CallFrame["kind"],
            from: frame.envelope.from,
            body: typeof payload.body === "string" ? payload.body : undefined,
            ...(Array.isArray(payload.attachments) && payload.attachments.length
              ? { attachments: payload.attachments }
              : {}),
          };
          this.calls.push(cf);
          if (cf.kind === "invite") this.emit("ring", cf);
        } else {
          this.inbox.push(frame.envelope); // SMS (async) — read via check_messages
          this.emit("message", frame.envelope);
        }
        return;
      }
      case "receipt": {
        const pending = this.pendingReceipts.get(frame.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingReceipts.delete(frame.id);
          pending.resolve({ id: frame.id, status: frame.status });
        }
        return;
      }
      case "error": {
        this.emit("protocol_error", frame);
        return;
      }
      default:
        return;
    }
  }

  private sendRaw(frame: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private failPending(err: Error): void {
    for (const pending of this.pendingReceipts.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingReceipts.clear();
  }

  /** Send an `sms` envelope and wait for the hub's receipt (delivered | queued). */
  sendSms(to: string, body: string, attachments?: Attachment[]): Promise<SmsReceipt> {
    if (!this.ready || !this.ws) return Promise.reject(new Error("not connected to the hub"));
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      id: mintMessageId(),
      type: "sms",
      from: this.opts.agentId,
      to,
      ts: nowIso(),
      payload: { body, ...(attachments && attachments.length ? { attachments } : {}) },
      sig: null,
    };
    return new Promise<SmsReceipt>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReceipts.delete(envelope.id);
        reject(new Error(`timed out waiting for receipt of ${envelope.id}`));
      }, 15_000);
      this.pendingReceipts.set(envelope.id, { resolve, reject, timer });
      this.sendRaw({ type: "send", envelope });
    });
  }

  /** Claim inbound ownership of one of this agent's nicknames (spec §2.3). */
  claim(nickname: string): void {
    this.sendRaw({ type: "claim", nickname: nickname.replace(/^@/, "") });
  }

  /** Release a previously-claimed nickname. */
  release(nickname: string): void {
    this.sendRaw({ type: "release", nickname: nickname.replace(/^@/, "") });
  }

  /** Tell the platform whether this session can be rung for a call (spec §Calls). */
  reportCallReady(call: boolean): void {
    this.sendRaw({ type: "capability", call });
  }

  /**
   * Forward an envelope's payload upstream verbatim (the daemon's relay path):
   * re-`from`'d to this connection's authenticated agent so the platform accepts
   * it, `to` kept as the target reference (a global `@nickname` the platform
   * resolves). Carries both plain SMS bodies and `payload.call` frames.
   */
  relay(to: string, payload: Record<string, unknown>): void {
    if (!this.ready || !this.ws) return;
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      id: mintMessageId(),
      type: "sms",
      from: this.opts.agentId,
      to,
      ts: nowIso(),
      payload,
      sig: null,
    };
    this.sendRaw({ type: "send", envelope });
  }

  /** Send a call frame — rides on an sms envelope, distinguished by payload.call.
   *  A spoken line may carry attachments (same reference mechanism as SMS). */
  sendCall(to: string, call: { id: string; kind: CallFrame["kind"] }, body?: string, attachments?: Attachment[]): void {
    if (!this.ready || !this.ws) return;
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      id: mintMessageId(),
      type: "sms",
      from: this.opts.agentId,
      to,
      ts: nowIso(),
      payload: {
        ...(body !== undefined ? { body } : {}),
        call,
        ...(attachments && attachments.length ? { attachments } : {}),
      },
      sig: null,
    };
    this.sendRaw({ type: "send", envelope });
  }

  /** Block-poll for the next matching call frame, up to `attempts` × `intervalMs`. */
  async awaitCall(pred: (f: CallFrame) => boolean, intervalMs: number, attempts: number): Promise<CallFrame | null> {
    for (let i = 0; i <= attempts; i++) {
      const idx = this.calls.findIndex(pred);
      if (idx >= 0) return this.calls.splice(idx, 1)[0]!;
      if (i < attempts) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }

  /** Take the most recent pending call invite (for pickup_call). */
  takeInvite(): CallFrame | null {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      if (this.calls[i]!.kind === "invite") return this.calls.splice(i, 1)[0]!;
    }
    return null;
  }

  /** Drain the local buffer of delivered envelopes, marking them read (spec §9). */
  checkMessages(since?: string): Envelope[] {
    const messages = this.inbox;
    this.inbox = [];
    return since ? messages.filter((m) => m.ts > since) : messages;
  }
}
