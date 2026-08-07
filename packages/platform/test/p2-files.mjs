// P2 file attachments — R2 + attachments table. Runs against a live `wrangler dev`.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p2-files.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8787";
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
const pem = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
async function profile(name) {
  const acct = await post("/accounts", { username: `${name}${tag}`, email: `${name}-${tag}@x.test`, password: "pw123456" });
  const reg = await post("/register", { grant_scope_id: `gs_${name}_${tag}`, public_key: pem(), nickname: `${name}${tag}` }, acct.api_key);
  return { key: acct.api_key, accountId: acct.account_id, agentId: reg.agent_id, nickname: `${name}${tag}` };
}

const uploadFile = (bytes, { name, mime, owner, to }, key) =>
  fetch(`${base}/files?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}&owner=${encodeURIComponent(owner)}${to ? `&to=${encodeURIComponent(to)}` : ""}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/octet-stream" },
    body: bytes,
  });

console.log("P2 file attachments @", base);

const A = await profile("owner");
const B = await profile("recip");
const C = await profile("stranger");

// ── upload (owner A, recipient @recip) ────────────────────────────────────
const payload = new TextEncoder().encode("hello hauddy 📎 attachment");
const up = await uploadFile(payload, { name: "note.txt", mime: "text/plain", owner: A.agentId, to: `@${B.nickname}` }, A.key);
const upJson = await up.json();
check("upload returns file_ id + size", up.status === 200 && upJson.file_id.startsWith("file_") && upJson.size === payload.byteLength);
const fileId = upJson.file_id;

// ── owner can download; bytes round-trip; filename header present ──────────
const dlA = await fetch(`${base}/files/${fileId}`, { headers: { authorization: `Bearer ${A.key}` } });
const back = new Uint8Array(await dlA.arrayBuffer());
check("owner downloads (200)", dlA.status === 200);
check("bytes round-trip intact", back.length === payload.length && back.every((b, i) => b === payload[i]));
check("x-hauddy-filename header returned", decodeURIComponent(dlA.headers.get("x-hauddy-filename")) === "note.txt");
check("content-type preserved", dlA.headers.get("content-type") === "text/plain");

// ── recipient (resolved via to=@recip) can download ───────────────────────
const dlB = await fetch(`${base}/files/${fileId}`, { headers: { authorization: `Bearer ${B.key}` } });
check("recipient downloads (200)", dlB.status === 200);

// ── stranger + unauth are forbidden ───────────────────────────────────────
const dlC = await fetch(`${base}/files/${fileId}`, { headers: { authorization: `Bearer ${C.key}` } });
check("stranger forbidden (403)", dlC.status === 403);
const dlNo = await fetch(`${base}/files/${fileId}`);
check("unauthenticated forbidden (403)", dlNo.status === 403);

// ── unknown id → 404 ──────────────────────────────────────────────────────
const dl404 = await fetch(`${base}/files/file_does_not_exist`, { headers: { authorization: `Bearer ${A.key}` } });
check("missing file → 404", dl404.status === 404);

// ── over-cap upload → 413 (declared content-length short-circuits) ────────
const big = new Uint8Array(10 * 1024 * 1024 + 1);
const upBig = await uploadFile(big, { name: "big.bin", mime: "application/octet-stream", owner: A.agentId, to: null }, A.key);
check("over-cap upload → 413", upBig.status === 413);

// ── upload without a key → 401 ────────────────────────────────────────────
const upNoAuth = await fetch(`${base}/files?name=x&mime=text/plain&owner=${A.agentId}`, {
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: new TextEncoder().encode("x"),
});
check("upload without key → 401", upNoAuth.status === 401);

console.log(`\nP2: ${passed} checks passed ✅`);
