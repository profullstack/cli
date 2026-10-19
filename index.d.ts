export type InstallMethod = "installer" | "npm" | "bun" | "pnpm" | "yarn" | "local" | "unknown";
export interface Install { method: InstallMethod; share?: string; }

export interface LifecycleOptions {
  /** The command name, and the folder our installer uses: <prefix>/share/<name>. */
  name: string;
  /** The npm package, e.g. "@profullstack/readm3". */
  package: string;
  /** The running version, compared with the registry's latest. */
  version?: string;
  /** The curl installer URL, re-run by `update` when the tool came from it. */
  installer?: string;
  /** Installer flags to keep on update, e.g. ["--desktop"] when the desktop app is installed. */
  installerArgs?: () => string[] | Promise<string[]>;
  /** The entry script of the running copy; defaults to the realpath of process.argv[1]. */
  script?: string;
  detect?: (input: { name: string; script?: string }) => Install;
  io?: { stdin: { isTTY?: boolean }; stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } };
}

export const LIFECYCLE_COMMANDS: string[];
export function lifecycleUsage(name: string): string;
export function detectInstall(input: { name: string; script?: string; exists?: (path: string) => boolean; npmRoot?: () => string | undefined }): Install;
export function lifecycleCommand(action: "update" | "uninstall", install: Install, options: { package: string; installer?: string; installerArgs?: string[] }): string[] | undefined;
export function latestVersion(pkg: string, registry?: string): Promise<string | undefined>;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
/** Handles update/upgrade/uninstall/remove; false for any other command. */
export function lifecycle(argv: string[], options: LifecycleOptions): Promise<boolean>;
