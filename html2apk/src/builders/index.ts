import type { DetectedSource } from "../utils";
import { folderBuilder } from "./folder-builder";
import type { Builder } from "./types";
import { urlBuilder } from "./url-builder";

export {
  buildCapacitorApk,
  CAPACITOR_BUILD_STEPS,
  createCapacitorConfig,
  DEBUG_APK_PATH,
  DEFAULT_APP_ID,
  DEFAULT_CAPACITOR_VERSION,
  normalizeAppId,
  normalizeAppName,
} from "./capacitor";
export type {
  CapacitorBuildOptions,
  CapacitorBuildRequest,
  CapacitorBuildResult,
  CapacitorConfig,
} from "./capacitor";
export {
  buildFromFolder,
  defaultAppName,
  FOLDER_BUILD_STEPS,
  folderBuilder,
} from "./folder-builder";
export type { FolderBuildOptions, FolderBuildResult } from "./folder-builder";
export {
  buildFromUrl,
  normalizeUrl,
  offlinePage,
  URL_BUILD_STEPS,
  urlBuilder,
} from "./url-builder";
export type { UrlBuildOptions, UrlBuildResult } from "./url-builder";
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
