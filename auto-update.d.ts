export interface AutoUpdateOptions {
  /** Command name used in the scheduled task label. */
  name: string;
  /** Absolute path to the installed CLI wrapper. */
  command: string;
  /** Defaults to ["update", "--quiet"]. */
  args?: string[];
  /** Defaults to 3600 seconds. Must be a whole number of minutes. */
  intervalSeconds?: number;
}

export function autoUpdatePaths(name: string, options?: { home?: string; platform?: NodeJS.Platform }): Record<string, string>;
export function installAutoUpdate(options: AutoUpdateOptions): Promise<{ scheduled: boolean; platform: string; scheduler?: string; reason?: string; paths: Record<string, string> }>;
export function removeAutoUpdate(name: string, options?: { home?: string; platform?: NodeJS.Platform }): Promise<{ removed: boolean; platform: string; paths: Record<string, string> }>;
