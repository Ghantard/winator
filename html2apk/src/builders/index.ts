import type { DetectedSource } from "../utils";
import { folderBuilder } from "./folder-builder";
import type { Builder } from "./types";
import { urlBuilder } from "./url-builder";

export {
  buildFromFolder,
  createCapacitorConfig,
  DEBUG_APK_PATH,
  DEFAULT_APP_ID,
  DEFAULT_CAPACITOR_VERSION,
  defaultAppName,
  folderBuilder,
  normalizeAppId,
  normalizeAppName,
} from "./folder-builder";
export type {
  CapacitorConfig,
  FolderBuildOptions,
  FolderBuildResult,
} from "./folder-builder";
export { urlBuilder } from "./url-builder";
export type { Builder, BuildOptions, BuildResult } from "./types";

/** Pick the builder that knows how to package this kind of source. */
export function selectBuilder(source: DetectedSource): Builder {
  switch (source.type) {
    case "url":
      return urlBuilder;
    case "folder":
      return folderBuilder;
  }
}
