# @profullstack/cli

The commands every Profullstack CLI shares, so no tool writes them twice:

```sh
mytool update            # update, the same way it was installed
mytool update --check    # only say whether a newer version exists
mytool uninstall         # remove it (asks first; --yes to skip; alias: remove)
```

It looks at where the running copy really lives and picks the matching tool:

| Installed with | `update` runs | `uninstall` runs |
| --- | --- | --- |
| our curl installer (and `w3bs install`) | the installer again, with your flags | `<prefix>/share/<name>/uninstall.sh` |
| `npm i -g` | `npm install -g pkg@latest` | `npm uninstall -g pkg` |
| `bun add -g` | `bun add -g pkg@latest` | `bun remove -g pkg` |
| `pnpm add -g` | `pnpm add -g pkg@latest` | `pnpm remove -g pkg` |
| `yarn global add` | `yarn global add pkg@latest` | `yarn global remove pkg` |

A copy it cannot place (a project's `node_modules`, a source checkout) is never
touched: it prints the command to run instead. `update` checks the registry or a
configured version feed before running an installer, skips an equal version, and
refuses to downgrade. If the feed is unavailable or malformed, it stops without
reinstalling. `--force` reinstalls only when the installed version is not newer.

Install an hourly per-user update check from an installer after the CLI wrapper is
in place:

```js
import { installAutoUpdate } from "@profullstack/cli/auto-update";

await installAutoUpdate({ name: "readm3", command: "/home/me/.local/bin/readm3" });
```

The updater uses systemd user timers or cron on Linux, launchd on macOS, and Task
Scheduler on Windows. It runs `readm3 update --quiet`; removing a CLI can call
`removeAutoUpdate(name)` to remove its scheduled check.

## Use

```js
import { lifecycle, lifecycleUsage } from "@profullstack/cli";

export async function main(argv = process.argv.slice(2)) {
  if (await lifecycle(argv, {
    name: "readm3",                              // command, and <prefix>/share/<name>
    package: "@profullstack/readm3",
    version: VERSION,                            // the running version
    installer: "https://readm3.com/install.sh",  // optional curl installer
    installerCommand: "update",                 // pass `update` to the install script
    installerArgs: () => desktopInstalled() ? ["--desktop"] : [], // flags to keep on update
  })) return;
  // ...the tool's own commands
}
```

`lifecycle` returns `false` for any other command, sets `process.exitCode` on failure,
and refuses to uninstall without a terminal unless `--yes` is given. Put
`lifecycleUsage(name)` in your `--help`.

For a version feed outside npm, pass `latestVersion: () => fetchVersion(url)`.
Also exported: `detectInstall`, `lifecycleCommand`, `latestVersion`, `fetchVersion`,
`compareVersions`. The `@profullstack/cli/auto-update` entry exports
`installAutoUpdate`, `removeAutoUpdate`, and `autoUpdatePaths`.

No dependencies. Node 18+ and Bun. MIT.
