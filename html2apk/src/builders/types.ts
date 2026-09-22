import type { DetectedSource, Logger, Progress } from "../utils";

export interface BuildOptions {
  /** Where the generated APK is written. */
  output: string;
  /** Validated source: a reachable URL or a folder containing an index.html. */
  source: DetectedSource;
  logger: Logger;
  /** Reports each build step to the interface. */
  progress?: Progress;
  /** Reverse-DNS application id (--app-id). */
  appId?: string;
  /** Display name of the app (--app-name). */
  appName?: string;
}

export interface BuildResult {
  /** Absolute path of the generated APK. */
  apkPath: string;
}

export interface Builder {
  /** Identifier used in logs, e.g. "url" or "folder". */
  readonly name: string;
  build(options: BuildOptions): Promise<BuildResult>;
}
