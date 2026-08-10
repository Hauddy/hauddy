import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MAX_ATTACHMENTS_BYTES, type Attachment } from "@hauddy/protocol";
import type { Daemon } from "./daemon.js";
import { createMcpServer } from "./mcp.js";
import { CallValidation } from "./wake.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export interface LocalApiOptions {
  daemon: Daemon;
  port?: number;
  host?: string;
}

export interface LocalApiHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * The sidecar daemon's localhost control surface for the desktop app (@hauddy/app-ui)
 * (127.0.0.1 only). Mirrors the app's `api` contract 1:1; every route is
 * backed by real account/agent/nickname/claim state from the {@link Daemon}.
 * Dependency-free (node:http).
 */
export async function startLocalApi(opts: LocalApiOptions): Promise<LocalApiHandle> {
  const { daemon } = opts;

  // One transport per MCP session — each new Claude Code window gets its own
  // agent identity (matching the stdio `hauddy mcp` per-directory behaviour).
  const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

  const json = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify(body ?? null));
  };
  const readBody = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    let text = "";
    for await (const chunk of req) text += chunk;
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };
  const readRaw = async (req: http.IncomingMessage, max: number): Promise<Buffer | null> => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max) over = true;
      if (!over) chunks.push(chunk as Buffer);
    }
    return over ? null : Buffer.concat(chunks);
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    const method = req.method ?? "GET";
    const inject = p.match(/^\/api\/inject\/([^/]+)$/);
    const contacts = p.match(/^\/api\/agents\/([^/]+)\/contacts(\/remove)?$/);
    const bookable = p.match(/^\/api\/agents\/([^/]+)\/bookable$/);
    const description = p.match(/^\/api\/agents\/([^/]+)\/description$/);
    const del = p.match(/^\/api\/agents\/([^/]+)\/delete$/);
    const agentLog = p.match(/^\/api\/agents\/([^/]+)\/log$/);
    const netAgentRemove = p.match(/^\/api\/platform\/agents\/([^/]+)\/remove$/);
    const netAgentNick = p.match(/^\/api\/platform\/agents\/([^/]+)\/nickname$/);
    const netAgentSettings = p.match(/^\/api\/platform\/agents\/([^/]+)\/settings$/);
    const netAgentBook = p.match(/^\/api\/platform\/agents\/([^/]+)\/book$/);
    const netAgentBookRemove = p.match(/^\/api\/platform\/agents\/([^/]+)\/book\/remove$/);
    const netAgent = p.match(/^\/api\/platform\/agents\/([^/]+)$/);
    const humanFile = p.match(/^\/api\/human\/file\/([^/]+)$/);
    const humanThread = p.match(/^\/api\/human\/thread\/([^/]+)$/);
    try {
      // ---- call injection stream (the plain-terminal wrapper delivery pipe) ----
      // GET  = subscribe (SSE): the wrapper writes each event's `text` into the PTY.
      // POST = publish { type?, text, code? }: the MCP process pushes a validation
      //        code here so the readiness handshake can traverse the wrapper path.
      if (inject) {
        const agentId = decodeURIComponent(inject[1]!);
        if (method === "GET") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            ...CORS,
          });
          res.write(`event: ready\ndata: ${JSON.stringify({ agent_id: agentId })}\n\n`);
          const unsubscribe = daemon.injections.subscribe(agentId, res);
          const keepAlive = setInterval(() => {
            try {
              res.write(": keep-alive\n\n");
            } catch {
              /* pruned on close */
            }
          }, 15_000);
          keepAlive.unref?.();
          req.on("close", () => {
            clearInterval(keepAlive);
            unsubscribe();
          });
          return; // stream stays open — never json()/end here
        }
        if (method === "POST") {
          const body = await readBody(req);
          const delivered = daemon.injections.publish(agentId, {
            type: body.type === "validate" ? "validate" : "ring",
            text: String(body.text ?? ""),
            ...(typeof body.code === "string" ? { code: body.code } : {}),
          });
          return json(res, 200, { delivered });
        }
      }

      // ---- platform link ("go online": connect + expose) ----
      if (method === "GET" && p === "/api/platform") return json(res, 200, daemon.getPlatform());
      if (method === "POST" && p === "/api/platform/connect") {
        const body = await readBody(req);
        return json(res, 200, await daemon.connectPlatform({
          email: typeof body.email === "string" ? body.email : undefined,
          apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        }));
      }
      if (method === "POST" && p === "/api/platform/disconnect") {
        await daemon.disconnectPlatform();
        return json(res, 200, { ok: true });
      }
      if (method === "POST" && p === "/api/platform/rotate") return json(res, 200, await daemon.rotatePlatformKey());
      if (method === "GET" && p === "/api/platform/exposure") return json(res, 200, await daemon.listExposure());
      // The account's platform-only agents (connectors + agents exposed elsewhere).
      if (method === "GET" && p === "/api/platform/agents") return json(res, 200, await daemon.listNetworkAgents());
      if (method === "POST" && netAgentRemove) {
        return json(res, 200, await daemon.removeNetworkAgent(decodeURIComponent(netAgentRemove[1]!)));
      }
      if (method === "POST" && netAgentNick) {
        const body = await readBody(req);
        return json(res, 200, await daemon.setNetworkAgentNickname(decodeURIComponent(netAgentNick[1]!), String(body.nickname ?? "")));
      }
      if (method === "POST" && netAgentSettings) {
        const body = await readBody(req);
        const patch: { bio?: string; listed?: boolean } = {};
        if (typeof body.bio === "string") patch.bio = body.bio;
        if (typeof body.listed === "boolean") patch.listed = body.listed;
        return json(res, 200, await daemon.setNetworkAgentSettings(decodeURIComponent(netAgentSettings[1]!), patch));
      }
      if (method === "GET" && netAgentBook) {
        return json(res, 200, await daemon.networkAgentBook(decodeURIComponent(netAgentBook[1]!)));
      }
      if (method === "POST" && netAgentBookRemove) {
        const body = await readBody(req);
        return json(res, 200, await daemon.removeNetworkAgentContact(decodeURIComponent(netAgentBookRemove[1]!), String(body.handle ?? "")));
      }
      if (method === "POST" && netAgentBook) {
        const body = await readBody(req);
        return json(res, 200, await daemon.addNetworkAgentContact(decodeURIComponent(netAgentBook[1]!), String(body.handle ?? "")));
      }
      if (method === "GET" && netAgent) {
        return json(res, 200, await daemon.getNetworkAgent(decodeURIComponent(netAgent[1]!)));
      }
      if (method === "POST" && p === "/api/platform/expose") {
        const body = await readBody(req);
        return json(res, 200, await daemon.expose(String(body.localId ?? "")));
      }
      if (method === "POST" && p === "/api/platform/unexpose") {
        const body = await readBody(req);
        return json(res, 200, await daemon.unexpose(String(body.localId ?? "")));
      }

      // ---- friends (profile↔profile links on the platform) ----
      if (method === "GET" && p === "/api/friends") return json(res, 200, await daemon.listFriends());
      if (method === "POST" && p === "/api/friends/request") {
        const body = await readBody(req);
        return json(res, 200, await daemon.requestFriend(String(body.handle ?? "")));
      }
      if (method === "POST" && p === "/api/friends/respond") {
        const body = await readBody(req);
        return json(res, 200, await daemon.respondFriend(String(body.accountId ?? ""), Boolean(body.accept)));
      }
      if (method === "POST" && p === "/api/friends/auto-accept") {
        const body = await readBody(req);
        return json(res, 200, await daemon.setAutoAccept(Boolean(body.autoAccept)));
      }

      // ---- human console (message/call agents as the person) ----
      if (method === "GET" && p === "/api/human") return json(res, 200, await daemon.humanIdentity());
      if (method === "POST" && p === "/api/human/sms") {
        const body = await readBody(req);
        const attachments = Array.isArray(body.attachments) ? (body.attachments as Attachment[]) : undefined;
        return json(res, 200, await daemon.humanSms(String(body.to ?? ""), String(body.body ?? ""), attachments));
      }
      // Stage a file the human is about to send. Bytes in the body; name/mime/to
      // as query params (so the browser needs no custom request headers → no CORS
      // preflight snags). Returns the attachment reference for /api/human/sms.
      if (method === "POST" && p === "/api/human/upload") {
        const bytes = await readRaw(req, MAX_ATTACHMENTS_BYTES);
        if (!bytes) return json(res, 413, { error: "file exceeds the 10MB limit" });
        const name = url.searchParams.get("name") ?? "file";
        const mime = url.searchParams.get("mime") ?? "application/octet-stream";
        const to = url.searchParams.get("to") ?? "";
        return json(res, 200, await daemon.stageHumanAttachment(bytes, { name, mime }, to));
      }
      if (method === "GET" && p === "/api/human/inbox") return json(res, 200, await daemon.humanInbox());
      // Browsable history (spec §E). `?as=<agentId>` = view-as-agent inbox.
      if (method === "GET" && p === "/api/human/threads") return json(res, 200, await daemon.humanThreads(url.searchParams.get("as")));
      if (method === "GET" && humanThread) {
        const beforeRaw = url.searchParams.get("before");
        return json(res, 200, await daemon.humanThread(decodeURIComponent(humanThread[1]!), {
          viewAs: url.searchParams.get("as"),
          before: beforeRaw && Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : undefined,
        }));
      }
      if (method === "GET" && p === "/api/human/calls") {
        return json(res, 200, await daemon.humanCalls({
          viewAs: url.searchParams.get("as"),
          withFrames: url.searchParams.get("withFrames") === "1",
        }));
      }
      if (method === "GET" && p === "/api/human/notifications") return json(res, 200, await daemon.humanNotifications());
      if (method === "POST" && p === "/api/human/notifications/seen") return json(res, 200, await daemon.humanNotificationsSeen());
      // Download a received attachment (the daemon fetches from whichever hub holds it).
      if (method === "GET" && humanFile) {
        const file = await daemon.fetchHumanFile(decodeURIComponent(humanFile[1]!));
        if (!file) return json(res, 404, { error: "file not found or expired" });
        res.writeHead(200, {
          "content-type": file.mime,
          "content-length": String(file.bytes.length),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          ...CORS,
        });
        res.end(file.bytes);
        return;
      }
      if (method === "POST" && p === "/api/human/call") {
        const body = await readBody(req);
        return json(res, 200, await daemon.humanCall(String(body.to ?? "")));
      }
      if (method === "POST" && p === "/api/human/call/say") {
        const body = await readBody(req);
        const attachments = Array.isArray(body.attachments) ? (body.attachments as Attachment[]) : undefined;
        return json(res, 200, await daemon.humanSay(String(body.text ?? ""), attachments));
      }
      if (method === "GET" && p === "/api/human/call/poll") return json(res, 200, await daemon.humanPollCall());
      if (method === "POST" && p === "/api/human/call/pickup") {
        const body = await readBody(req);
        return json(res, 200, await daemon.humanPickup(String(body.call_id ?? ""), String(body.peer ?? ""), body.hub === "platform" ? "platform" : "local"));
      }
      if (method === "POST" && p === "/api/human/call/hangup") return json(res, 200, await daemon.humanHangup());

      // ---- profile contact pool (derived: local agents ∪ friends' agents) ----
      // GET /api/contacts → the whole pool. You change it via the Friends screen
      // (/api/friends/*), not by adding handles here.
      if (method === "GET" && p === "/api/contacts") return json(res, 200, await daemon.listPool());
      // POST /api/contacts/remove-everywhere { handle } → unlink a pooled contact
      // from every agent's book at once (the pool row's "Remove" action).
      if (method === "POST" && p === "/api/contacts/remove-everywhere") {
        const body = await readBody(req);
        return json(res, 200, await daemon.removeContactEverywhere(String(body.handle ?? "")));
      }

      // ---- per-agent contact books ----
      // GET  /api/agents/:id/bookable          → pool entries not yet in the book
      // GET  /api/agents/:id/contacts          → the agent's book (resolved)
      // POST /api/agents/:id/contacts { handle } → add a pool contact to the book
      // POST /api/agents/:id/contacts/remove { handle } → remove one
      if (bookable && method === "GET") {
        return json(res, 200, await daemon.listBookable(decodeURIComponent(bookable[1]!)));
      }

      // ---- per-agent profile / lifecycle / log ----
      // POST /api/agents/:id/description { description } → set the bio (shared on expose)
      // POST /api/agents/:id/delete                     → permanently delete the agent
      // GET  /api/agents/:id/log                        → recent activity for this agent
      if (description && method === "POST") {
        const body = await readBody(req);
        return json(res, 200, await daemon.setAgentDescription(decodeURIComponent(description[1]!), String(body.description ?? "")));
      }
      if (del && method === "POST") {
        return json(res, 200, await daemon.deleteAgent(decodeURIComponent(del[1]!)));
      }
      if (agentLog && method === "GET") {
        return json(res, 200, await daemon.agentLog(decodeURIComponent(agentLog[1]!)));
      }
      if (contacts) {
        const localId = decodeURIComponent(contacts[1]!);
        const isRemove = Boolean(contacts[2]);
        if (method === "GET" && !isRemove) return json(res, 200, await daemon.listBook(localId));
        if (method === "POST" && isRemove) {
          const body = await readBody(req);
          await daemon.removeContact(localId, String(body.handle ?? ""));
          return json(res, 200, { ok: true });
        }
        if (method === "POST") {
          const body = await readBody(req);
          return json(res, 200, await daemon.addContact(localId, String(body.handle ?? "")));
        }
      }

      // ---- agents & nicknames ----
      if (method === "GET" && p === "/api/agents") return json(res, 200, await daemon.listAgents());
      if (method === "GET" && p === "/api/account-nicknames") return json(res, 200, await daemon.listAccountNicknames());
      if (method === "POST" && p === "/api/link") {
        const body = await readBody(req);
        const result = await daemon.linkNickname(
          String(body.localId ?? ""),
          String(body.nickname ?? ""),
          Boolean(body.replace),
        );
        return json(res, 200, result);
      }
      if (method === "POST" && p === "/api/speaking-as") {
        const body = await readBody(req);
        await daemon.setSpeakingAs(String(body.localId ?? ""), String(body.nickname ?? ""));
        return json(res, 200, { ok: true });
      }

      // ---- claims ----
      if (method === "GET" && p === "/api/claims") return json(res, 200, await daemon.listClaims());
      if (method === "GET" && p === "/api/claim-log") return json(res, 200, await daemon.listClaimLog());
      if (method === "GET" && p === "/api/flash-claim") return json(res, 200, daemon.getFlashClaim());
      if (method === "POST" && p === "/api/claims/force") {
        const body = await readBody(req);
        await daemon.forceClaim(String(body.nickname ?? ""));
        return json(res, 200, { ok: true });
      }
      if (method === "POST" && p === "/api/claims/release") {
        const body = await readBody(req);
        await daemon.releaseClaim(String(body.nickname ?? ""));
        return json(res, 200, { ok: true });
      }

      // ---- diagnostics ----
      if (method === "GET" && p === "/api/routing") return json(res, 200, await daemon.getRouting());
      if (method === "GET" && p === "/api/activity") return json(res, 200, daemon.listActivity());

      // ---- HTTP MCP endpoint (/mcp) ----
      // Each new Claude Code window starts a fresh MCP session and gets its own
      // agent identity — matching the per-directory behaviour of `hauddy mcp`
      // (stdio). Existing sessions are routed by Mcp-Session-Id header.
      // Usage: claude mcp add --transport http hauddy http://localhost:7700/mcp
      if (p === "/mcp" || p.startsWith("/mcp/")) {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId) {
          const transport = mcpSessions.get(sessionId);
          if (!transport) {
            res.writeHead(404, { "content-type": "application/json", ...CORS });
            res.end(JSON.stringify({ error: "session not found" }));
            return;
          }
          const body = method === "POST" ? await readBody(req) : undefined;
          void transport.handleRequest(req, res, body);
          return;
        }
        // New session — derive a stable localId from the optional ?id= query param.
        // Defaults to "http-default" so reconnects in the same project reuse the
        // same agent identity instead of creating a new one each time.
        const reqUrl = new URL(req.url ?? "/mcp", "http://localhost");
        const idParam = reqUrl.searchParams.get("id")?.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
        const localId = idParam ?? "claude";
        const provision = daemon.createHttpMcpProvision(localId);
        const mcpServer = createMcpServer(provision, new CallValidation(), { transport: "http" });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        transport.onclose = () => { if (transport.sessionId) mcpSessions.delete(transport.sessionId); };
        await mcpServer.connect(transport);
        const body = method === "POST" ? await readBody(req) : undefined;
        await transport.handleRequest(req, res, body);
        if (transport.sessionId) mcpSessions.set(transport.sessionId, transport);
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const server = http.createServer((req, res) => void handle(req, res));
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.HAUDDY_LOCAL_PORT ?? 7700);
  // Reject (don't crash the process) if the port is taken — the caller degrades.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const actual = server.address();
  const boundPort = typeof actual === "object" && actual !== null ? actual.port : port;

  return {
    port: boundPort,
    url: `http://${host}:${boundPort}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
