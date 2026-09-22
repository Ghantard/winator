import { cpSync } from "node:fs";
import { basename, resolve } from "node:path";

import { assertFolderSource } from "../utils";
import type { Logger, Progress } from "../utils";
import { buildCapacitorApk, CAPACITOR_BUILD_STEPS } from "./capacitor";
import type { CapacitorBuildOptions, CapacitorBuildResult } from "./capacitor";
import type { Builder, BuildOptions, BuildResult } from "./types";

// Re-exported so callers have a single import for a folder build.
export {
  createCapacitorConfig,
  DEBUG_APK_PATH,
  DEFAULT_APP_ID,
  DEFAULT_CAPACITOR_VERSION,
  normalizeAppId,
  normalizeAppName,
} from "./capacitor";
export type { CapacitorConfig } from "./capacitor";

/** Number of steps buildFromFolder reports. */
export const FOLDER_BUILD_STEPS = CAPACITOR_BUILD_STEPS;

export interface FolderBuildOptions extends CapacitorBuildOptions {
  /** Reverse-DNS application id. Defaults to DEFAULT_APP_ID. */
  appId?: string;
  /** Display name of the app. Defaults to the source folder name. */
  appName?: string;
  logger?: Logger;
  progress?: Progress;
}

export type FolderBuildResult = CapacitorBuildResult;

/**
 * Package a local HTML folder into a debug APK: the folder is copied into the
 * Capacitor project's www/, so the app works entirely offline.
 */
export async function buildFromFolder(
  folderPath: string,
  outputPath: string,
  options: FolderBuildOptions = {},
): Promise<FolderBuildResult> {
  const source = resolve(folderPath);
  assertFolderSource(source);

  return await buildCapacitorApk({
    ...options,
    output: outputPath,
    appName: options.appName ?? defaultAppName(source),
    webStepLabel: "Copie du contenu du dossier dans www/",
    fillWebDir: (webDir) => {
      cpSync(source, webDir, { recursive: true, dereference: true });
    },
  });
}

/** Derive a display name from the folder name, ignoring a trailing separator. */
export function defaultAppName(folderPath: string): string {
  const name = basename(resolve(folderPath));
  return name.length > 0 ? name : "html2apk";
}

/** Builder entry used by the CLI for folder sources. */
export const folderBuilder: Builder = {
  name: "folder",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, output, logger } = options;
    if (source.type !== "folder") {
      throw new Error(`folderBuilder ne gère pas une source de type « ${source.type} ».`);
    }

    const folderOptions: FolderBuildOptions = { logger };
    if (options.progress !== undefined) {
      folderOptions.progress = options.progress;
    }
    if (options.appId !== undefined) {
      folderOptions.appId = options.appId;
    }
    if (options.appName !== undefined) {
      folderOptions.appName = options.appName;
    }
    return await buildFromFolder(source.path, output, folderOptions);
  },
};
