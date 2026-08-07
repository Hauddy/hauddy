// slugifyNickname coerces arbitrary folder names into a reachable @handle so
// every agent gets a default nickname (folder names with spaces used to yield
// null → the agent had no handle and showed offline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NICKNAME_RE, slugifyNickname, normalizeNickname } from "../packages/protocol/dist/index.js";

test("slugifyNickname turns folder-ish labels into valid handles", () => {
  assert.equal(slugifyNickname("philip test"), "philip-test");
  assert.equal(slugifyNickname("marc test"), "marc-test");
  assert.equal(slugifyNickname("My_Cool-Agent"), "my_cool-agent");
  assert.equal(slugifyNickname("  @Ada  "), "ada");
  assert.equal(slugifyNickname("weird!!name.js"), "weird-name-js");
  // Every non-null result is a valid nickname.
  for (const s of ["philip test", "a.b.c", "Foo Bar Baz"]) {
    const slug = slugifyNickname(s);
    assert.ok(slug && NICKNAME_RE.test(slug), `${s} -> ${slug}`);
  }
});

test("slugifyNickname returns null only when nothing usable remains", () => {
  assert.equal(slugifyNickname("x"), null); // single char < 2
  assert.equal(slugifyNickname("   "), null);
  assert.equal(slugifyNickname("!!!"), null);
});

test("normalizeNickname stays strict (validator, not a coercer)", () => {
  assert.equal(normalizeNickname("philip test"), null);
  assert.equal(normalizeNickname("ada"), "ada");
});
