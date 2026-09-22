import type { Builder, BuildOptions, BuildResult } from "./types";

/** Wraps a remote website in a WebView-based APK. */
export const urlBuilder: Builder = {
  name: "url",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, logger } = options;
    if (source.kind !== "url") {
      throw new Error(`urlBuilder cannot handle a "${source.kind}" source.`);
    }

    logger.info(`Preparing a WebView APK for ${source.url}`);
    throw new Error("URL builds are not implemented yet.");
  },
};
