// P5 human console — /console/* as a virtual HTTP client over the DB.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p5-console.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";

const base = process.argv[2] ?? "http://localhost:8787";
const wsUrl = base.replace(/^http/, "ws");
const post = (p, body, key) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

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

const tag = Math.random().toString(36).slice(2, 6);
const acct = await post("/accounts", { username: `me${tag}`, email: `me${tag}@x.test`, password: "pw123456" });
const postC = (p, body) => post(p, body, acct.api_key);
const getC = (p) => get(p, acct.api_key);

// The bot agent (the other party) on a live WS session.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const gs = `gs_bot_${tag}`;
const bot = await post("/register", { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `bot${tag}` }, acct.api_key);
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
const agentSend = (to, payload) => ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id: `msg_${Math.random().toString(36).slice(2)}${Date.now()}`, type: "sms", from: bot.agent_id, to, ts: new Date().toISOString(), payload, sig: null } }));

console.log("P5 human console @", base);

// Learn the human's derived @handle (from the account email local-part).
const me = await getC("/console/identity");
const meNick = me.nickname; // e.g. @meXXXX
check("console identity is a human with a derived @handle", me.kind === "human" && meNick === `@me${tag}`);
const botNick = `@bot${tag}`;

// ── human → agent SMS; agent reply lands in the console inbox ──────────────
delivers.length = 0;
check("human → agent SMS delivers", (await postC("/console/sms", { to: botNick, body: "hello bot" })).status === "delivered");
check("agent received the human's SMS", await waitFor(() => delivers.find((e) => e.payload.body === "hello bot" && e.to === bot.agent_id)));
agentSend(meNick, { body: "hi, I'm the bot" });
const inbox = await waitFor(async () => {
  const r = await getC("/console/inbox");
  return r.messages.some((m) => m.payload.body === "hi, I'm the bot") ? r : null;
});
check("agent reply reached the console inbox", inbox);

// ── live call: place → agent frames → human hears → say → agent hangs up ──
delivers.length = 0;
const placed = await postC("/console/call", { to: botNick });
check("place call → ringing + call_id", placed.status === "ringing" && placed.call_id);
const callId = placed.call_id;
check("agent was rung (invite)", await waitFor(() => delivers.find((e) => e.payload.call?.kind === "invite" && e.payload.call.id === callId)));

agentSend(meNick, { call: { id: callId, kind: "frame" }, body: "bot speaking" });
check("human hears the agent on the call (poll)", await waitFor(async () => {
  const r = await getC("/console/call/poll");
  return r.frames.find((f) => f.kind === "frame" && f.body === "bot speaking") ? r : null;
}));

await postC("/console/call/say", { text: "hi bot, human here" });
check("agent received the human's spoken line", await waitFor(() => delivers.find((e) => e.payload.call?.kind === "frame" && e.payload.body === "hi bot, human here")));

agentSend(meNick, { call: { id: callId, kind: "close" } });
check("human's poll reports the call ended", await waitFor(async () => {
  const r = await getC("/console/call/poll");
  return r.ended ? r : null;
}));

// ── presence: an operated console human is online + call-capable ──────────
const presence = await get(`/presence/${me.agent_id}`);
check("console human presence is online + call-capable", presence.state === "online" && presence.capabilities.includes("call"));

ws.close();
console.log(`\nP5: ${passed} checks passed ✅`);
process.exit(0);
