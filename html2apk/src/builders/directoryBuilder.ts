import type { Builder, BuildOptions, BuildResult } from "./types";

/** Bundles a local HTML folder into the APK assets. */
export const directoryBuilder: Builder = {
  name: "folder",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, logger } = options;
    if (source.type !== "folder") {
      throw new Error(`directoryBuilder cannot handle a "${source.type}" source.`);
    }

    logger.info(`Preparing an offline APK from ${source.path}`);
    throw new Error("Local folder builds are not implemented yet.");
  },
};
