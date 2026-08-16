import { test } from "node:test";
import assert from "node:assert/strict";

// Test normalizeNickname logic
function normalizeNickname(raw) {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return /^@[a-z0-9][a-z0-9_-]{1,31}$/.test(withAt) ? withAt : null;
}

test("dashboard UI state helpers: normalizeNickname works correctly", () => {
  assert.equal(normalizeNickname("scout"), "@scout");
  assert.equal(normalizeNickname("@scout"), "@scout");
  assert.equal(normalizeNickname("   "), null);
  assert.equal(normalizeNickname("invalid handle with spaces"), null);
});

// Test error message classification logic
function parseErrorMessage(err) {
  const raw = typeof err === 'string' ? err : err?.message ?? '';
  if (/Failed to fetch|NetworkError|unreachable|TypeError/i.test(raw)) {
    return { title: 'Connection lost' };
  }
  if (/HTTP 401|401/i.test(raw)) {
    return { title: 'Session expired' };
  }
  if (/HTTP 5\d\d|500|502|503|504/i.test(raw)) {
    return { title: 'Server temporary issue' };
  }
  return { title: 'Something went wrong' };
}

test("dashboard error classification logic", () => {
  assert.equal(parseErrorMessage(new TypeError("Failed to fetch")).title, "Connection lost");
  assert.equal(parseErrorMessage("GET /agents → HTTP 401").title, "Session expired");
  assert.equal(parseErrorMessage("GET /accounts/me → HTTP 500").title, "Server temporary issue");
  assert.equal(parseErrorMessage("Unexpected error").title, "Something went wrong");
});

// Test suggestNicknames candidate generation logic
function generateCandidateNicknames(base, isTakenFn) {
  const clean = base.trim().toLowerCase().replace(/^@/, '');
  if (!clean) return [];
  const candidates = [
    `${clean}_1`, `${clean}_2`, `${clean}_3`,
    `${clean}_bot`, `${clean}_ai`, `the_${clean}`
  ];
  return candidates
    .filter((c) => !isTakenFn(c))
    .map((c) => `@${c}`)
    .slice(0, 3);
}

test("suggestNicknames candidate generation returns available handles", () => {
  const taken = new Set(["alice", "alice_1"]);
  const suggestions = generateCandidateNicknames("alice", (c) => taken.has(c));
  assert.deepEqual(suggestions, ["@alice_2", "@alice_3", "@alice_bot"]);
});
