import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Attachment } from "@hauddy/protocol";

export interface HauddyClientOptions {
  /**
   * Hauddy MCP server endpoint URL.
   * Default: http://localhost:7700/mcp
   */
  hub?: string;
  /**
   * Optional Bearer token if connecting to a platform connector (https://api.hauddy.com/mcp).
   */
  bearerToken?: string;
  /**
   * Optional custom agent handle or session ID prefix.
   */
  handle?: string;
}

export interface WhoAmIResult {
  agent_id: string;
  local_id: string | null;
  display_name: string | null;
  description: string | null;
  nickname: string | null;
  online_locally: boolean;
  can_receive_calls: boolean;
  local_peers?: Array<{ nickname: string | null; description: string | null; online: boolean }>;
}

export interface SetNicknameResult {
  ok: boolean;
  nickname?: string;
  reason?: string;
  message?: string;
}

export interface ContactItem {
  agent_id: string;
  display_name: string | null;
  nickname: string | null;
  kind?: "human" | "agent";
  presence?: { state: string };
}

export interface ContactsResult {
  contacts: ContactItem[];
  pending?: string[];
}

export interface MessageEnvelope {
  id: string;
  from?: string;
  peer?: string;
  to?: string;
  ts: string;
  payload?: {
    body?: string;
    attachments?: Attachment[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CheckMessagesResult {
  messages: MessageEnvelope[];
  pending_call?: unknown;
}

export interface SendSmsResult {
  status: string;
  attachments?: Attachment[];
  error?: string;
}

export interface ConversationTurn {
  from: string;
  to: string;
  body: string | null;
  attachments?: Attachment[] | null;
  ts: string;
}

export interface ConversationResult {
  contact: string;
  messages: ConversationTurn[];
}

export interface CallTranscriptResult {
  call_id: string;
  caller: string;
  callee: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  turns: Array<{
    seq: number;
    from: string;
    body: string | null;
    attachments?: Attachment[] | null;
    ts: string;
  }>;
}

/**
 * Typed async TypeScript client for Hauddy agent messaging.
 */
export class HauddyClient {
  private client: Client;
  private transport: SSEClientTransport | null = null;
  private endpoint: string;
  private bearerToken?: string;

  constructor(options?: HauddyClientOptions) {
    const rawEndpoint = options?.hub ?? "http://localhost:7700/mcp";
    const endpointUrl = new URL(rawEndpoint);
    if (options?.handle) {
      endpointUrl.searchParams.set("id", options.handle);
    }
    this.endpoint = endpointUrl.toString();
    this.bearerToken = options?.bearerToken;

    this.client = new Client(
      { name: "hauddy-ts-sdk", version: "0.1.8" },
      { capabilities: {} }
    );
  }

  /**
   * Connect to the Hauddy MCP server endpoint via SSE/Streamable HTTP transport.
   */
  async connect(): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    }

    this.transport = new SSEClientTransport(new URL(this.endpoint), {
      requestInit: { headers }
    });

    await this.client.connect(this.transport);
  }

  /**
   * Close the MCP connection session.
   */
  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  private parseContent<T>(result: unknown): T {
    const res = result as { content?: Array<{ type: string; text?: string }> };
    if (!res || !Array.isArray(res.content) || res.content.length === 0) {
      return {} as T;
    }
    const text = res.content[0]?.text;
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /**
   * Auto-provisions the agent session and returns identity and reachability metadata.
   */
  async whoami(): Promise<WhoAmIResult> {
    const res = await this.client.callTool({ name: "whoami", arguments: {} });
    return this.parseContent<WhoAmIResult>(res);
  }

  /**
   * Sets or renames this agent's local `@nickname`.
   */
  async setNickname(nickname: string): Promise<SetNicknameResult> {
    const res = await this.client.callTool({
      name: "set_nickname",
      arguments: { nickname }
    });
    return this.parseContent<SetNicknameResult>(res);
  }

  /**
   * Declares or updates this agent's display name and description.
   */
  async setIdentity(options: { display_name?: string; description?: string }): Promise<{ ok: boolean }> {
    const res = await this.client.callTool({
      name: "set_identity",
      arguments: options
    });
    return this.parseContent<{ ok: boolean }>(res);
  }

  /**
   * Lists reachable contacts and presence status on the network.
   */
  async listContacts(): Promise<ContactsResult> {
    const res = await this.client.callTool({ name: "list_contacts", arguments: {} });
    return this.parseContent<ContactsResult>(res);
  }

  /**
   * Polls inbox for unread envelopes and marks them read.
   */
  async checkMessages(since?: string): Promise<CheckMessagesResult> {
    const res = await this.client.callTool({
      name: "check_messages",
      arguments: since ? { since } : {}
    });
    return this.parseContent<CheckMessagesResult>(res);
  }

  /**
   * Sends a message to a contact by `@nickname` or agent ID, with optional file attachments.
   */
  async sendSms(to: string, body: string, attachments?: string[]): Promise<SendSmsResult> {
    const res = await this.client.callTool({
      name: "send_sms",
      arguments: {
        to,
        body,
        ...(attachments && attachments.length ? { attachments } : {})
      }
    });
    return this.parseContent<SendSmsResult>(res);
  }

  /**
   * Pulls a structured message thread with a contact, ordered chronologically.
   */
  async getConversation(options: { with: string; from?: string; to?: string; limit?: number }): Promise<ConversationResult> {
    const res = await this.client.callTool({
      name: "get_conversation",
      arguments: options
    });
    return this.parseContent<ConversationResult>(res);
  }

  /**
   * Retrieves the spoken transcript of a call session by call ID.
   */
  async getCallTranscript(callId: string): Promise<CallTranscriptResult> {
    const res = await this.client.callTool({
      name: "get_call_transcript",
      arguments: { call_id: callId }
    });
    return this.parseContent<CallTranscriptResult>(res);
  }
}
