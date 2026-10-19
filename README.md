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
touched: it prints the command to run instead. `update` first asks the npm registry
for the latest version and does nothing when you already have it (`--force` reinstalls).

## Use

```js
import { lifecycle, lifecycleUsage } from "@profullstack/cli";

export async function main(argv = process.argv.slice(2)) {
  if (await lifecycle(argv, {
    name: "readm3",                              // command, and <prefix>/share/<name>
    package: "@profullstack/readm3",
    version: VERSION,                            // the running version
    installer: "https://readm3.com/install.sh",  // optional curl installer
    installerArgs: () => desktopInstalled() ? ["--desktop"] : [], // flags to keep on update
  })) return;
  // ...the tool's own commands
}
```

`lifecycle` returns `false` for any other command, sets `process.exitCode` on failure,
and refuses to uninstall without a terminal unless `--yes` is given. Put
`lifecycleUsage(name)` in your `--help`.

Also exported: `detectInstall`, `lifecycleCommand`, `latestVersion`, `compareVersions`.

No dependencies. Node 18+ and Bun. MIT.
