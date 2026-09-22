import type { Builder, BuildOptions, BuildResult } from "./types";

/** Wraps a remote website in a WebView-based APK. */
export const urlBuilder: Builder = {
  name: "url",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, logger } = options;
    if (source.type !== "url") {
      throw new Error(`urlBuilder cannot handle a "${source.type}" source.`);
    }

    logger.info(`Preparing a WebView APK for ${source.path}`);
    throw new Error("URL builds are not implemented yet.");
  },
};
