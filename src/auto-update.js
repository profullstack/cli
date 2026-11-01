import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

function slug(name) {
  const value = String(name ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) throw new TypeError("name must contain only letters, digits, dot, underscore, or hyphen");
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: options.env ?? process.env, stdio: "ignore" });
  return result.status === 0;
}

function runWithInput(command, args, input, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: options.env ?? process.env, input, stdio: ["pipe", "ignore", "ignore"] });
  return result.status === 0;
}

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const systemdQuote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;

function cronExpression(intervalSeconds) {
  const minutes = intervalSeconds / 60;
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = minutes / 60;
  return Number.isInteger(hours) && hours <= 23 ? `0 */${hours} * * *` : "0 * * * *";
}

function cronCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function installCron(name, command, args, intervalSeconds, env) {
  const existing = spawnSync("crontab", ["-l"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
  if (existing.error) return false;
  const marker = `# profullstack-cli-auto-update:${name}`;
  const lines = (existing.status === 0 ? existing.stdout : "").split(/\r?\n/).filter((line) => line && !line.includes(marker));
  lines.push(`${cronExpression(intervalSeconds)} ${cronCommand(command, args)} ${marker}`);
  return runWithInput("crontab", ["-"], `${lines.join("\n")}\n`, { env });
}

function removeCron(name, env) {
  const existing = spawnSync("crontab", ["-l"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
  if (existing.status !== 0) return;
  const marker = `# profullstack-cli-auto-update:${name}`;
  const lines = existing.stdout.split(/\r?\n/).filter((line) => line && !line.includes(marker));
  if (lines.length === 0) run("crontab", ["-r"], { env });
  else runWithInput("crontab", ["-"], `${lines.join("\n")}\n`, { env });
}

export function autoUpdatePaths(name, { home = homedir(), platform = process.platform } = {}) {
  const id = slug(name);
  if (platform === "linux") {
    const dir = join(home, ".config", "systemd", "user");
    return { service: join(dir, `${id}-auto-update.service`), timer: join(dir, `${id}-auto-update.timer`) };
  }
  if (platform === "darwin") return { plist: join(home, "Library", "LaunchAgents", `com.profullstack.${id}.auto-update.plist`) };
  if (platform === "win32") return { task: `Profullstack-${id}-AutoUpdate` };
  throw new Error(`auto-updates are not supported on ${platform}`);
}

/** Install an hourly per-user check. The CLI's `update` command must fail closed if its version feed is down. */
export async function installAutoUpdate({
  name,
  command,
  args = ["update", "--quiet"],
  intervalSeconds = 3600,
  home = homedir(),
  platform = process.platform,
  env = process.env,
}) {
  const id = slug(name);
  if (!command || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("command and string args are required");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds % 60 !== 0) throw new RangeError("intervalSeconds must be a whole number of minutes, at least 60");
  const paths = autoUpdatePaths(id, { home, platform });

  if (platform === "linux") {
    await mkdir(join(home, ".config", "systemd", "user"), { recursive: true });
    const searchPath = [join(home, ".local", "bin"), join(home, ".local", "share", "mise", "shims"), env.PATH ?? ""].filter(Boolean).join(delimiter);
    await writeFile(paths.service, [
      "[Unit]",
      `Description=Check ${id} for an update`,
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=oneshot",
      `Environment=${systemdQuote(`PATH=${searchPath}`)}`,
      `ExecStart=${[command, ...args].map(systemdQuote).join(" ")}`,
      "",
    ].join("\n"), { mode: 0o600 });
    await writeFile(paths.timer, [
      "[Unit]",
      `Description=Check ${id} for updates hourly`,
      "",
      "[Timer]",
      "OnBootSec=5min",
      `OnUnitActiveSec=${intervalSeconds}s`,
      "Persistent=true",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"), { mode: 0o600 });
    if (run("systemctl", ["--user", "daemon-reload"], { env }) && run("systemctl", ["--user", "enable", "--now", `${id}-auto-update.timer`], { env })) {
      return { scheduled: true, platform, scheduler: "systemd", paths };
    }
    if (installCron(id, command, args, intervalSeconds, env)) return { scheduled: true, platform, scheduler: "cron", paths };
    return { scheduled: false, platform, reason: "systemd --user and crontab could not schedule the update", paths };
  }

  if (platform === "darwin") {
    await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
    const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const argsXml = [command, ...args].map((value) => `    <string>${xml(value)}</string>`).join("\n");
    const logDir = join(home, ".local", "state", "cli-updater");
    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, `${id}.log`);
    await writeFile(paths.plist, [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\"><dict>",
      `<key>Label</key><string>com.profullstack.${id}.auto-update</string>`,
      `<key>ProgramArguments</key><array>\n${argsXml}\n  </array>`,
      `<key>StartInterval</key><integer>${intervalSeconds}</integer>`,
      "<key>RunAtLoad</key><false/>",
      `<key>StandardOutPath</key><string>${xml(logPath)}</string>`,
      `<key>StandardErrorPath</key><string>${xml(logPath)}</string>`,
      "</dict></plist>",
      "",
    ].join("\n"), { mode: 0o600 });
    const domain = `gui/${process.getuid?.() ?? 0}`;
    run("launchctl", ["bootout", domain, paths.plist], { env });
    if (!run("launchctl", ["bootstrap", domain, paths.plist], { env })) return { scheduled: false, platform, reason: "launchctl could not load the updater", paths };
    return { scheduled: true, platform, scheduler: "launchd", paths };
  }

  if (platform === "win32") {
    const task = paths.task;
    const everyHours = Math.max(1, Math.ceil(intervalSeconds / 3600));
    const tr = [command, ...args].map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(" ");
    if (!run("schtasks", ["/Create", "/F", "/TN", task, "/SC", "HOURLY", "/MO", String(everyHours), "/TR", tr], { env })) return { scheduled: false, platform, reason: "Task Scheduler could not create the updater", paths };
    return { scheduled: true, platform, scheduler: "Task Scheduler", paths };
  }
}

export async function removeAutoUpdate(name, { home = homedir(), platform = process.platform, env = process.env } = {}) {
  const id = slug(name);
  const paths = autoUpdatePaths(id, { home, platform });
  if (platform === "linux") {
    run("systemctl", ["--user", "disable", "--now", `${id}-auto-update.timer`], { env });
    removeCron(id, env);
    await Promise.all([rm(paths.service, { force: true }), rm(paths.timer, { force: true })]);
    run("systemctl", ["--user", "daemon-reload"], { env });
  } else if (platform === "darwin") {
    run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, paths.plist], { env });
    await rm(paths.plist, { force: true });
  } else if (platform === "win32") {
    run("schtasks", ["/Delete", "/F", "/TN", paths.task], { env });
  }
  return { removed: true, platform, paths };
}
