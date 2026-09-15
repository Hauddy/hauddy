import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { act, create } from "react-test-renderer";
const dir = mkdtempSync(resolve("node_modules/.visual-state-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = resolve(dir, "version.mjs");
await build({
  stdin: {
    contents:
      "export * from './packages/app/src/version-store'; export {UpdateSection} from './packages/app/src/screens/Account';",
    resolveDir: process.cwd(),
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  define: { "import.meta.env": "{}" },
});
const { createVersionChecker, VERSION_MAX_AGE, semverLt, UpdateSection } =
  await import(pathToFileURL(outfile));

test("version failures are retryable and missing/malformed fields never mean current", async () => {
  let value = null;
  const checker = createVersionChecker(async () => {
    if (value === null) throw Error("offline");
    return Response.json(value);
  });
  await checker.check();
  assert.equal(checker.get().status, "error");
  assert.equal(checker.get().checkedAt, null);
  for (const invalid of [
    {},
    { latest: "0.1.21" },
    { latest: "garbage", min: "0.0.0" },
    { latest: "0.1.21", min: "2.0.0" },
  ]) {
    value = invalid;
    await checker.check(undefined, true);
    assert.equal(checker.get().status, "error");
  }
  value = { latest: "0.1.21", min: "0.0.0" };
  await checker.check(undefined, true);
  assert.equal(checker.get().status, "success");
  assert.equal(checker.get().latest, "0.1.21");
});
test("version cache expires and failed refresh preserves known minimum without claiming current", async () => {
  let now = 100,
    requests = 0,
    value = { latest: "0.1.21", min: "0.1.0" };
  const checker = createVersionChecker(
    async () => {
      requests++;
      if (value === null) throw Error("offline");
      return Response.json(value);
    },
    () => now,
  );
  await checker.check();
  await checker.check();
  assert.equal(requests, 1);
  now += VERSION_MAX_AGE + 1;
  value = { latest: "0.1.22", min: "0.1.1" };
  await checker.check();
  assert.equal(checker.get().latest, "0.1.22");
  value = null;
  await checker.check(undefined, true);
  assert.equal(checker.get().status, "error");
  assert.equal(checker.get().min, "0.1.1");
});
test("switching endpoints ignores an older in-flight response", async () => {
  let finish;
  const checker = createVersionChecker(async (url) =>
    url.includes("old.test")
      ? await new Promise((r) => (finish = r))
      : Response.json({ latest: "0.2.0", min: "0.1.0" }),
  );
  const old = checker.check("https://old.test");
  await checker.check("https://new.test");
  finish(Response.json({ latest: "0.1.0", min: "0.0.0" }));
  await old;
  assert.equal(checker.get().endpoint, "https://new.test");
  assert.equal(checker.get().latest, "0.2.0");
});

test("version comparison orders numeric components", () => {
  assert.equal(semverLt("0.1.9", "0.1.21"), true);
  assert.equal(semverLt("0.2.0", "0.1.99"), false);
  assert.equal(semverLt("1.0.0", "1.0.0"), false);
});
test("update UI distinguishes unknown, failed, current, available and installer states", async (t) => {
  const previousWindow = globalThis.window;
  let progress,
    ready,
    fail,
    downloads = 0,
    installs = 0,
    ui;
  globalThis.window = {
    hauddyDesktop: {
      onUpdateProgress: (fn) => {
        progress = fn;
      },
      onUpdateReady: (fn) => {
        ready = fn;
      },
      onUpdateError: (fn) => {
        fail = fn;
      },
      downloadUpdate: () => {
        downloads++;
      },
      installUpdate: () => {
        installs++;
      },
    },
  };
  t.after(async () => {
    if (ui) await act(async () => ui.unmount());
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const render = async (check, latestVersion = null) =>
    act(async () => {
      const element = React.createElement(UpdateSection, {
        currentVersion: "0.1.21",
        latestVersion,
        check,
      });
      if (ui) ui.update(element);
      else ui = create(element);
    });
  const text = (node) =>
    typeof node === "string" ? node : (node.children ?? []).map(text).join("");
  await render(null);
  assert.match(text(ui.root), /Checking for updates/);
  assert.doesNotMatch(text(ui.root), /Up to date/);
  await render({ status: "error" });
  assert.match(text(ui.root), /Could not check/);
  assert.doesNotMatch(text(ui.root), /Up to date/);
  await render({ status: "success" });
  assert.match(text(ui.root), /Up to date/);
  await render({ status: "success" }, "0.1.22");
  assert.match(text(ui.root), /An update is available/);
  await act(async () =>
    ui.root
      .findAllByType("button")
      .find((b) => text(b) === "Download & install")
      .props.onClick(),
  );
  assert.equal(downloads, 1);
  await act(async () => progress({ percent: 42 }));
  assert.match(text(ui.root), /42%/);
  assert.doesNotMatch(text(ui.root), /Up to date/);
  await act(async () => fail({ message: "offline" }));
  assert.match(text(ui.root), /Update failed: offline/);
  await act(async () =>
    ui.root
      .findAllByType("button")
      .find((b) => text(b) === "Retry")
      .props.onClick(),
  );
  assert.equal(downloads, 2);
  await act(async () => ready());
  assert.match(text(ui.root), /Restart to apply/);
  await act(async () =>
    ui.root
      .findAllByType("button")
      .find((b) => text(b) === "Restart to apply")
      .props.onClick(),
  );
  assert.equal(installs, 1);
});
