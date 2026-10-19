import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, detectInstall, lifecycle, lifecycleCommand, lifecycleUsage } from "../src/index.js";

const npmRoot = () => "/usr/lib/node_modules";
const detect = (script, exists = () => false) => detectInstall({ name: "readm3", script, exists, npmRoot });

test("finds how a copy was installed from where its script lives", () => {
  const share = "/home/a/.local/share/readm3";
  assert.deepEqual(detect(`${share}/lib/node_modules/@profullstack/readm3/bin/readm3.mjs`, (p) => p === `${share}/uninstall.sh`), { method: "installer", share });
  assert.equal(detect("/home/a/.bun/install/global/node_modules/@profullstack/readm3/bin/readm3.mjs").method, "bun");
  assert.equal(detect("/home/a/.local/share/pnpm/global/5/node_modules/@profullstack/readm3/bin/readm3.mjs").method, "pnpm");
  assert.equal(detect("/home/a/.config/yarn/global/node_modules/@profullstack/readm3/bin/readm3.mjs").method, "yarn");
  assert.equal(detect("/usr/lib/node_modules/@profullstack/readm3/bin/readm3.mjs").method, "npm");
  assert.equal(detect("/home/a/project/node_modules/@profullstack/readm3/bin/readm3.mjs").method, "local");
  assert.equal(detect("/home/a/src/readm3/bin/readm3.mjs").method, "unknown");
  assert.equal(detect(undefined).method, "unknown");
});

test("a folder named like the tool without uninstall.sh is not the installer", () => {
  assert.equal(detect("/home/a/readm3/node_modules/x/bin.js").method, "local");
});

test("update and uninstall use the same tool that installed it", () => {
  const opts = { package: "@profullstack/readm3", installer: "https://readm3.com/install.sh" };
  assert.deepEqual(lifecycleCommand("update", { method: "npm" }, opts), ["npm", "install", "-g", "@profullstack/readm3@latest"]);
  assert.deepEqual(lifecycleCommand("uninstall", { method: "bun" }, opts), ["bun", "remove", "-g", "@profullstack/readm3"]);
  assert.deepEqual(lifecycleCommand("uninstall", { method: "installer", share: "/s/readm3" }, opts), ["sh", "/s/readm3/uninstall.sh"]);
  assert.deepEqual(lifecycleCommand("update", { method: "installer", share: "/opt/tools/share/readm3" }, { ...opts, installerArgs: ["--desktop"] }),
    ["sh", "-c", "curl -fsSL https://readm3.com/install.sh | INSTALL_PREFIX='/opt/tools' sh -s -- '--desktop'"]);
  assert.equal(lifecycleCommand("update", { method: "installer", share: "/s" }, { package: "x" }), undefined);
  assert.equal(lifecycleCommand("update", { method: "unknown" }, opts), undefined);
});

test("versions compare numerically", () => {
  assert.equal(compareVersions("0.13.1", "0.13.0"), 1);
  assert.equal(compareVersions("0.9.0", "0.13.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
});

function io() {
  const out = [];
  return { out, io: { stdin: { isTTY: false }, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } } };
}

test("other commands pass through untouched", async () => {
  assert.equal(await lifecycle(["paste"], { name: "readm3", package: "x" }), false);
  assert.equal(await lifecycle([], { name: "readm3", package: "x" }), false);
});

test("uninstall without a terminal needs --yes, and unknown options are refused", async () => {
  const a = io();
  assert.equal(await lifecycle(["remove"], { name: "readm3", package: "x", io: a.io, detect: () => ({ method: "npm" }) }), true);
  assert.match(a.out.join(""), /uninstall --yes/);
  const b = io();
  await lifecycle(["update", "--nope"], { name: "readm3", package: "x", io: b.io });
  assert.match(b.out.join(""), /unknown option for update: --nope/);
  process.exitCode = 0;
});

test("a copy it cannot place says how to update by hand", async () => {
  const a = io();
  await lifecycle(["update", "--force"], { name: "readm3", package: "@profullstack/readm3", installer: "https://readm3.com/install.sh", io: a.io, detect: () => ({ method: "unknown" }) });
  assert.match(a.out.join(""), /npm install -g @profullstack\/readm3@latest, or: curl -fsSL https:\/\/readm3.com\/install.sh \| sh/);
  process.exitCode = 0;
});

test("usage names both commands", () => {
  assert.match(lifecycleUsage("readm3"), /readm3 update/);
  assert.match(lifecycleUsage("readm3"), /readm3 uninstall/);
});
