// P14 Version enforcement — auth_rejected for client_version < MIN_CLIENT_VERSION.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 \
//     --var MIN_CLIENT_VERSION:0.2.0 --var LATEST_CLIENT_VERSION:0.2.0
//   node packages/platform/test/p14-version.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";

const base = process.argv[2] ?? "http://localhost:8787";
const wsUrl = base.replace(/^http/, "ws");
const post = (p, body, key) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};

const tag = Math.random().toString(36).slice(2, 8);
async function profile(name) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const acct = await post("/accounts", { username: `${name}${tag}`, email: `${name}-${tag}@x.test`, password: "pw123456" });
  const gs = `gs_${name}_${tag}`;
  const reg = await post(
    "/register",
    { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `${name}${tag}` },
    acct.api_key,
  );
  return { key: acct.api_key, agentId: reg.agent_id, gs, privateKey };
}

/** Connect and wait for the first meaningful control frame (auth_ok or auth_rejected). */
function connectExpect(a, clientVersion) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout waiting for auth frame"));
    }, 4000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_challenge") {
        const signature = sign(null, Buffer.from(msg.nonce, "base64url"), a.privateKey).toString("base64url");
        ws.send(JSON.stringify({ type: "auth_response", signature }));
      } else if (msg.type === "auth_ok" || msg.type === "auth_rejected") {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });

    ws.on("open", () => {
      const hello = { type: "auth_hello", agent_id: a.agentId, grant_scope_id: a.gs };
      if (clientVersion !== undefined) hello.client_version = clientVersion;
      ws.send(JSON.stringify(hello));
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

console.log("\nP14 — version enforcement (MIN_CLIENT_VERSION=0.2.0)\n");
console.log("NOTE: start wrangler dev with --var MIN_CLIENT_VERSION:0.2.0 --var LATEST_CLIENT_VERSION:0.2.0\n");

const a = await profile("ver");

// 1. Old version (below floor) → rejected
const rejected = await connectExpect(a, "0.1.0");
check("old version gets auth_rejected", rejected.type === "auth_rejected");
check("reason is client_outdated", rejected.reason === "client_outdated");
check("min_version present in rejection", rejected.min_version === "0.2.0");
check("latest_version present in rejection", rejected.latest_version === "0.2.0");

// 2. Exactly at minimum → accepted
const atMin = await connectExpect(a, "0.2.0");
check("version == floor gets auth_ok", atMin.type === "auth_ok");

// 3. Above minimum → accepted
const above = await connectExpect(a, "0.3.0");
check("version > floor gets auth_ok", above.type === "auth_ok");

// 4. No client_version → treated as 0.0.0 → rejected
const noVer = await connectExpect(a, undefined);
check("missing version gets auth_rejected", noVer.type === "auth_rejected");
check("missing version reason is client_outdated", noVer.reason === "client_outdated");

console.log(`\n${passed}/6 passed\n`);
