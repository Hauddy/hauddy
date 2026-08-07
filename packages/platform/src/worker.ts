import type { Env } from "./env.js";
import { HubDO } from "./hub-do.js";

// Wrangler needs the DO class exported from the entry module (class_name in wrangler.toml).
export { HubDO };

const UPLOAD_HARD_CAP = 12 * 1024 * 1024; // reject before buffering (10MB file cap + slack)

function corsHeaders(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.CORS_ORIGIN ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-hauddy-filename",
    "access-control-max-age": "86400",
  };
}

/**
 * The Worker router: terminates HTTP + WS at the edge, handles CORS preflight,
 * and forwards everything to the single global HubDO (plan §1). The DO owns all
 * state; the Worker is a thin front door. Non-GET bodies are buffered here before
 * forwarding so an early return in the DO never leaves a half-read Worker→DO
 * request stream (workerd throws "can't read request stream after response sent").
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    // Reject a truly oversized upload before buffering it into memory.
    if (url.pathname === "/files" && request.method === "POST") {
      if (Number(request.headers.get("content-length") ?? 0) > UPLOAD_HARD_CAP) {
        return new Response(JSON.stringify({ error: "file exceeds the 10485760-byte limit" }), {
          status: 413,
          headers: { "content-type": "application/json", ...corsHeaders(env) },
        });
      }
    }

    const stub = env.HUB.get(env.HUB.idFromName("global"));
    const isWs = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (isWs || request.method === "GET" || request.method === "HEAD") {
      return stub.fetch(request);
    }
    // Buffer the body, then forward a self-contained request.
    const body = await request.arrayBuffer();
    const forwarded = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: body.byteLength ? body : undefined,
    });
    return stub.fetch(forwarded);
  },
};
