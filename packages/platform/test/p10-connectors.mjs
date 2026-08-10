// P10 connectors — scoped connector tokens + the public /v1 REST API + /mcp.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p10-connectors.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";

const base = process.argv[2] ?? "http://localhost:8787";
const wsUrl = base.replace(/^http/, "ws");
const post = (p, body, key) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
const postJson = (p, body, key) => post(p, body, key).then((r) => r.json());
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const getJson = (p, key) => get(p, key).then((r) => r.json());
const rpc = (method, params, key, id = 1) =>
  fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const hit = await pred();
    if (hit) return hit;
    await wait(30);
  }
  return null;
}
/** tools/call → parse the JSON we stuffed into the text content block. */
const toolBody = async (res) => {
  const j = await res.json();
  const text = j?.result?.content?.[0]?.text;
  // Success results stuff JSON into the text block; error results (isError) put a
  // plain-text message there — so parse leniently and expose both.
  let obj = null;
  try {
    obj = text ? JSON.parse(text) : null;
  } catch {
    obj = null;
  }
  return { isError: !!j?.result?.isError, obj, text, raw: j };
};

const tag = Math.random().toString(36).slice(2, 6);
const acct = await postJson("/accounts", { username: `me${tag}`, email: `me${tag}@x.test`, password: "pw123456" });

console.log("P10 connectors @", base);

// A same-account bot agent on a live WS — the other party the connector talks to.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const gs = `gs_bot_${tag}`;
const bot = await postJson("/register", { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `bot${tag}` }, acct.api_key);
const botNick = `@bot${tag}`;
const delivers = [];
const ws = new WebSocket(wsUrl);
await new Promise((resolve) => {
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "auth_challenge") ws.send(JSON.stringify({ type: "auth_response", signature: sign(null, Buffer.from(msg.nonce, "base64url"), privateKey).toString("base64url") }));
    else if (msg.type === "auth_ok") resolve();
    else if (msg.type === "deliver") {
      delivers.push(msg.envelope);
      ws.send(JSON.stringify({ type: "ack", id: msg.envelope.id }));
    }
  });
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: bot.agent_id, grant_scope_id: gs })));
});
const botSend = (to, payload) => ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id: `msg_${Math.random().toString(36).slice(2)}${Date.now()}`, type: "sms", from: bot.agent_id, to, ts: new Date().toISOString(), payload, sig: null } }));

// ── mint a full-scope connector with a fixed @handle identity ──────────────
const handle = `gpt${tag}`;
const mint = await postJson("/accounts/connectors", { label: "test-gpt", scope: ["send", "read", "files"], handle }, acct.api_key);
check("mint returns a ct_live_ token + the bound @handle", mint.token?.startsWith("ct_live_") && mint.handle === `@${handle}`);
const CT = mint.token;

// ── whoami reflects the FIXED identity + the profile's available handles ───
const who = await getJson("/v1/whoami", CT);
check("whoami reports the connector's fixed @handle", who.handle === `@${handle}`);
check("whoami lists the account's other profile handles", Array.isArray(who.profile_handles) && who.profile_handles.some((h) => h.handle === botNick));
check("whoami reports the granted scope", JSON.stringify(who.scope) === JSON.stringify(["send", "read", "files"]));

// ── REST: connector → agent SMS, signed as the connector's handle ──────────
delivers.length = 0;
const sent = await postJson("/v1/messages", { to: botNick, body: "hi from the connector" }, CT);
check("POST /v1/messages delivers, signed as the connector handle", sent.status === "delivered" && sent.from === `@${handle}`);
check("the agent received it FROM the connector's identity", await waitFor(() => delivers.find((e) => e.payload.body === "hi from the connector")));

// ── the agent replies to the connector's @handle; check_messages sees it ───
botSend(`@${handle}`, { body: "reply to the connector" });
const inbox = await waitFor(async () => {
  const r = await getJson("/v1/messages", CT);
  return r.messages.some((m) => m.body === "reply to the connector") ? r : null;
});
check("GET /v1/messages (non-destructive) returns the reply to the connector", !!inbox);
// The connector has its OWN inbox identity, browsable via the dashboard's
// view-as-agent — the read above never drained it.
const asConn = await getJson(`/console/thread/${encodeURIComponent(botNick)}?as=${encodeURIComponent(`@${handle}`)}`, acct.api_key);
check("the connector's inbox is browsable via the dashboard (view-as-agent)", asConn.messages?.some((m) => m.body === "reply to the connector"));

// ── files: upload via /v1/files, download identical bytes; auth enforced ───
const payload = Buffer.from("connector file payload — hello", "utf8");
const up = await fetch(base + `/v1/files?name=note.txt&mime=text/plain`, { method: "POST", headers: { authorization: `Bearer ${CT}`, "content-type": "application/octet-stream" }, body: payload }).then((r) => r.json());
check("POST /v1/files returns a file_id", typeof up.file_id === "string");
const dl = await get(`/v1/files/${up.file_id}`, CT);
const dlBytes = Buffer.from(await dl.arrayBuffer());
check("GET /v1/files/:id returns identical bytes", dlBytes.equals(payload));
check("file download without a token is rejected", (await get(`/v1/files/${up.file_id}`)).status === 401);

// ── scope enforcement: a read-only token cannot send ───────────────────────
const roMint = await postJson("/accounts/connectors", { label: "reader", scope: ["read"], handle: `ro${tag}` }, acct.api_key);
check("read-only token → POST /v1/messages is 403 insufficient_scope", (await post("/v1/messages", { to: botNick, body: "nope" }, roMint.token)).status === 403);
check("read-only token → GET /v1/messages still works", Array.isArray((await getJson("/v1/messages", roMint.token)).messages));

// ── MCP: initialize → tools/list (scoped) → tools/call send_sms + read ─────
const init = await (await rpc("initialize", { protocolVersion: "2025-06-18" }, CT)).json();
check("MCP initialize returns serverInfo + tools capability", init.result?.serverInfo?.name === "hauddy" && !!init.result?.capabilities?.tools);
const list = await (await rpc("tools/list", {}, CT)).json();
const toolNames = list.result.tools.map((t) => t.name);
check("MCP tools/list exposes whoami/list_contacts/send_sms/check_messages/share_file/read_file", ["whoami", "list_contacts", "send_sms", "check_messages", "share_file", "read_file"].every((n) => toolNames.includes(n)));
const roList = await (await rpc("tools/list", {}, roMint.token)).json();
const roNames = roList.result.tools.map((t) => t.name);
check("read-only token's tools/list omits send_sms + share_file + read_file", !roNames.includes("send_sms") && !roNames.includes("share_file") && !roNames.includes("read_file"));

delivers.length = 0;
const call = await toolBody(await rpc("tools/call", { name: "send_sms", arguments: { to: botNick, body: "mcp says hi" } }, CT));
check("MCP tools/call send_sms delivers", !call.isError && call.obj.status === "delivered");
check("the agent received the MCP-sent message", await waitFor(() => delivers.find((e) => e.payload.body === "mcp says hi")));
const cm = await toolBody(await rpc("tools/call", { name: "check_messages", arguments: {} }, CT));
check("MCP check_messages returns the account's messages + a `now` cursor", Array.isArray(cm.obj.messages) && typeof cm.obj.now === "number");

// ── MCP read_file: download a received file's content by file_id ────────────
const rf = await toolBody(await rpc("tools/call", { name: "read_file", arguments: { file_id: up.file_id } }, CT));
check("MCP read_file returns a text file's content inline", !rf.isError && rf.obj.content === "connector file payload — hello" && rf.obj.mime === "text/plain");
const rfBad = await toolBody(await rpc("tools/call", { name: "read_file", arguments: { file_id: "file_does_not_exist" } }, CT));
check("MCP read_file on an unknown file_id → isError", rfBad.isError);
const rfRo = await toolBody(await rpc("tools/call", { name: "read_file", arguments: { file_id: up.file_id } }, roMint.token));
check("read-only (no files scope) read_file → isError insufficient scope", rfRo.isError);

// ── revoke: the token (and its identity) stop working ──────────────────────
check("revoke returns ok", (await postJson("/accounts/connectors/revoke", { token: CT }, acct.api_key)).ok === true);
check("revoked token → /v1 is 401", (await get("/v1/whoami", CT)).status === 401);
check("revoked token → /mcp is 401", (await rpc("tools/list", {}, CT)).status === 401);
check("revoked connector no longer appears in the account's list", !(await getJson("/accounts/connectors", acct.api_key)).connectors.some((c) => c.masked.endsWith(CT.slice(-4))));

ws.close();
console.log(`\nP10 connectors: ${passed} checks passed`);
