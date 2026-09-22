import type { Logger, Source } from "../utils";

export interface BuildOptions {
  /** Where the generated APK is written. */
  output: string;
  /** Resolved source: a remote URL or a local folder. */
  source: Source;
  logger: Logger;
}

export interface BuildResult {
  /** Absolute path of the generated APK. */
  apkPath: string;
}

export interface Builder {
  /** Identifier used in logs, e.g. "url" or "directory". */
  readonly name: string;
  build(options: BuildOptions): Promise<BuildResult>;
}
