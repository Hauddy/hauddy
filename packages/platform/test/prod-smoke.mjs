// Production smoke over the custom domain: seed an invited email → signup →
// register → WSS auth (Ed25519) → presence. Usage:
//   node packages/platform/test/prod-smoke.mjs https://api.hauddy.com <ADMIN_TOKEN>
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";

const base = process.argv[2];
const adminToken = process.argv[3];
const wsUrl = base.replace(/^http/, "ws");
const tag = Math.random().toString(36).slice(2, 8);
const email = `smoke-${tag}@hauddy-smoke.test`;

const j = (r) => r.json();
const post = (p, body, key) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }).then(j);

console.log("prod smoke @", base, "as", email);
// Seed the throwaway email through the invite gate.
const seed = await post("/admin/invites", { email }, adminToken);
assert.ok(seed.ok, "admin seed failed: " + JSON.stringify(seed));

const acct = await post("/accounts", { username: `smoke${tag}`, email, password: "pw123456" });
assert.ok(acct.api_key, "signup failed (gate?): " + JSON.stringify(acct));
console.log("  ✓ signup through the gate → account", acct.account_id);

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const gs = `gs_smoke_${tag}`;
const reg = await post("/register", { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `smoke${tag}` }, acct.api_key);
console.log("  ✓ register → agent", reg.agent_id);

const authOk = await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(() => reject(new Error("WS auth timeout")), 15000);
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "auth_challenge") ws.send(JSON.stringify({ type: "auth_response", signature: sign(null, Buffer.from(msg.nonce, "base64url"), privateKey).toString("base64url") }));
    else if (msg.type === "auth_ok") { clearTimeout(timer); ws._smoke = true; resolve(msg); setTimeout(() => ws.close(), 500); }
  });
  ws.on("error", reject);
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: reg.agent_id, grant_scope_id: gs })));
});
assert.equal(authOk.nickname, `@smoke${tag}`);
console.log("  ✓ WSS Ed25519 auth_ok → nickname", authOk.nickname);

const presence = await fetch(`${base}/presence/${reg.agent_id}`).then(j);
console.log("  ✓ presence:", presence.state, JSON.stringify(presence.capabilities));
console.log("\nPROD SMOKE PASSED ✅  (HTTP + WSS + DO SQLite + Ed25519 over api.hauddy.com)");
process.exit(0);
