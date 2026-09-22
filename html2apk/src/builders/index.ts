import type { DetectedSource } from "../utils";
import { directoryBuilder } from "./directoryBuilder";
import type { Builder } from "./types";
import { urlBuilder } from "./urlBuilder";

export { directoryBuilder } from "./directoryBuilder";
export { urlBuilder } from "./urlBuilder";
export type { Builder, BuildOptions, BuildResult } from "./types";

/** Pick the builder that knows how to package this kind of source. */
export function selectBuilder(source: DetectedSource): Builder {
  switch (source.type) {
    case "url":
      return urlBuilder;
    case "folder":
      return directoryBuilder;
  }
}
