/**
 * @profullstack/cli: the commands every Profullstack CLI should have and none should
 * write twice. Today that is `update` and `uninstall` (alias `remove`): each finds out
 * how the tool was installed (our curl installer, npm, bun, pnpm or yarn) and undoes or
 * redoes it the same way, so `readm3 update` never installs a second copy beside the first.
 *
 *   import { lifecycle } from "@profullstack/cli";
 *   if (await lifecycle(process.argv.slice(2), { name: "readm3", package: "@profullstack/readm3", version })) return;
 *
 * No dependencies; runs on Node 18+ and Bun.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename, dirname, join, sep } from "node:path";

export const LIFECYCLE_COMMANDS = ["update", "upgrade", "uninstall", "remove"];

/** Help lines for a tool's own --help. */
export function lifecycleUsage(name) {
  return `Install
  ${name} update [--check] [--force]          Update ${name} the way it was installed
  ${name} uninstall [--yes]                   Remove ${name} (also: ${name} remove)
`;
}

/**
 * How the running copy was installed, from where its entry script really lives.
 * `installer` is our curl installer (also what `w3bs install` runs): it leaves
 * <prefix>/share/<name>/uninstall.sh beside the copy it installed.
 */
export function detectInstall({ name, script, exists = existsSync, npmRoot = globalNpmRoot }) {
  if (!script) return { method: "unknown" };
  const path = script.split(sep).join("/");
  for (let dir = dirname(script); dir !== dirname(dir); dir = dirname(dir)) {
    if (basename(dir) === name && exists(join(dir, "uninstall.sh"))) return { method: "installer", share: dir };
  }
  if (path.includes("/.bun/install/global/")) return { method: "bun" };
  if (/\/pnpm\/global\/|\/\.pnpm-global\/|\/pnpm-global\//.test(path)) return { method: "pnpm" };
  if (/\/\.?yarn\/global\/|\/\.config\/yarn\/global\//.test(path)) return { method: "yarn" };
  if (path.includes("/node_modules/")) {
    const root = npmRoot();
    if (root && path.startsWith(root.split(sep).join("/") + "/")) return { method: "npm" };
    return { method: "local" };
  }
  return { method: "unknown" };
}

function globalNpmRoot() {
  const result = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/** The command that updates or removes an install, as [program, ...args]. */
export function lifecycleCommand(action, install, { package: pkg, installer, installerArgs = [], installerCommand }) {
  const latest = `${pkg}@latest`;
  switch (install.method) {
    case "installer":
      if (action === "uninstall") return ["sh", join(install.share, "uninstall.sh")];
      if (!installer) return undefined;
      // INSTALL_PREFIX keeps a --prefix install where it is: share is <prefix>/share/<name>.
      {
        const args = [installerCommand, ...installerArgs].filter(Boolean);
        return ["sh", "-c", `curl -fsSL ${installer} | INSTALL_PREFIX=${quote(dirname(dirname(install.share)))} sh -s --${args.map((arg) => ` ${quote(arg)}`).join("")}`];
      }
    case "npm": return action === "update" ? ["npm", "install", "-g", latest] : ["npm", "uninstall", "-g", pkg];
    case "bun": return action === "update" ? ["bun", "add", "-g", latest] : ["bun", "remove", "-g", pkg];
    case "pnpm": return action === "update" ? ["pnpm", "add", "-g", latest] : ["pnpm", "remove", "-g", pkg];
    case "yarn": return action === "update" ? ["yarn", "global", "add", latest] : ["yarn", "global", "remove", pkg];
    default: return undefined;
  }
}

/** The newest version on the registry, or undefined when it cannot be reached. */
export async function latestVersion(pkg, registry = process.env.npm_config_registry || "https://registry.npmjs.org") {
  try {
    const response = await fetch(`${registry.replace(/\/$/, "")}/${pkg.replace("/", "%2f")}/latest`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    return (await response.json()).version;
  } catch { return undefined; }
}

/** Fetch a version from a plain-text endpoint, package.json, or GitHub release JSON. */
export async function fetchVersion(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json, text/plain;q=0.9" } });
    if (!response.ok) return undefined;
    const body = await response.text();
    let value = body.trim();
    try {
      const json = JSON.parse(body);
      value = json?.version ?? json?.tag_name ?? json?.tag ?? "";
    } catch { /* the endpoint may return a bare version */ }
    return parseVersion(value) ? String(value).trim().replace(/^v/, "") : undefined;
  } catch { return undefined; }
}

function parseVersion(value) {
  const match = String(value ?? "").trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split(".") ?? [] };
}

/** -1, 0 or 1; malformed versions return null. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] < y.numbers[i] ? -1 : 1;
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const left = x.pre[i], right = y.pre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left), rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

const describe = { installer: "the installer", npm: "npm", bun: "bun", pnpm: "pnpm", yarn: "yarn" };

function run([program, ...args]) {
  return new Promise((done, fail) => {
    const child = spawn(program, args, { stdio: "inherit", shell: process.platform === "win32" && program !== "sh" });
    child.once("error", fail);
    child.once("exit", (code) => done(code ?? 1));
  });
}

async function confirm(question, io) {
  if (!io.stdin.isTTY) return false;
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

/**
 * Runs `update` / `uninstall` when argv asks for one; returns false for anything else,
 * so the tool carries on with its own commands. Sets process.exitCode on failure.
 *
 * options: name, package, version (the running one), installer (the curl installer URL),
 * installerArgs() (extra installer flags to keep on update, e.g. ["--desktop"]),
 * latestVersion() (optional feed override), afterUpdate() (optional post-upgrade work),
 * script (defaults to process.argv[1]), io ({ stdin, stdout, stderr }).
 */
export async function lifecycle(argv, options) {
  const [command, ...rest] = argv;
  if (!LIFECYCLE_COMMANDS.includes(command)) return false;
  const { name, package: pkg, version } = options;
  const io = options.io ?? process;
  const quiet = rest.includes("--quiet");
  const say = (text) => { if (!quiet) io.stdout.write(`${text}\n`); };
  const fail = (text, code = 1) => { io.stderr.write(`${name}: ${text}\n`); process.exitCode = code; return true; };
  if (rest.includes("-h") || rest.includes("--help")) { io.stdout.write(lifecycleUsage(name)); return true; }
  const action = command === "update" || command === "upgrade" ? "update" : "uninstall";
  const known = action === "update" ? ["--check", "--force", "--quiet"] : ["--yes", "-y"];
  const unknown = rest.find((arg) => !known.includes(arg));
  if (unknown) return fail(`unknown option for ${command}: ${unknown}\n\n${lifecycleUsage(name)}`, 2);

  const install = (options.detect ?? detectInstall)({ name, script: options.script ?? safeRealpath(process.argv[1]) });
  const how = describe[install.method];

  if (action === "update" && !Object.hasOwn(describe, install.method)) {
    const manual = `npm install -g ${pkg}@latest${options.installer ? `, or: curl -fsSL ${options.installer} | sh` : ""}`;
    return fail(`cannot tell how this copy was installed (${install.method === "local" ? "a project's node_modules" : "not a global install"}). Run: ${manual}`);
  }

  if (action === "update") {
    const latest = await (options.latestVersion?.() ?? latestVersion(pkg));
    if (!latest) return fail(`could not check the latest ${name} version; installer was not run`);
    if (!version) return fail(`cannot compare the installed ${name} version; installer was not run`);
    const comparison = compareVersions(version, latest);
    if (comparison === null) return fail(`invalid version from the ${name} update feed; installer was not run`);
    if (comparison > 0) { say(`${name} ${version} is newer than the published ${latest}; refusing to downgrade.`); return true; }
    if (comparison === 0 && !rest.includes("--force")) { say(`${name} ${version} is the latest.`); return true; }
    say(`${name} ${version} → ${latest} available.`);
    if (rest.includes("--check")) return true;
  }

  const installerArgs = action === "update" && install.method === "installer" ? await (options.installerArgs?.() ?? []) : [];
  const step = lifecycleCommand(action, install, { package: pkg, installer: options.installer, installerArgs, installerCommand: options.installerCommand });
  if (!step) {
    const manual = action === "update"
      ? `npm install -g ${pkg}@latest${options.installer ? `, or: curl -fsSL ${options.installer} | sh` : ""}`
      : `npm uninstall -g ${pkg} (or remove it the way you installed it)`;
    return fail(`cannot tell how this copy was installed (${install.method === "local" ? "a project's node_modules" : "not a global install"}). Run: ${manual}`);
  }

  if (action === "uninstall" && !rest.includes("--yes") && !rest.includes("-y")) {
    if (!io.stdin.isTTY) return fail(`not removing without a terminal to confirm; run: ${name} uninstall --yes`, 2);
    if (!(await confirm(`Remove ${name} (installed with ${how})?`, io))) { say("Nothing removed."); return true; }
  }
  say(`${action === "update" ? "Updating" : "Removing"} ${name} with ${how}: ${step.join(" ")}`);
  const code = await run(step);
  if (code !== 0) return fail(`${step[0]} exited with ${code}`, code);
  if (action === "update" && options.afterUpdate) {
    const postCode = await options.afterUpdate();
    if (postCode !== undefined && postCode !== 0) return fail(`post-update step exited with ${postCode}`, postCode);
  }
  say(action === "update" ? `${name} is up to date.` : `${name} is removed.`);
  return true;
}

function safeRealpath(path) {
  try { return path ? realpathSync(path) : undefined; } catch { return path; }
}
