import type { Source } from "../utils";
import { directoryBuilder } from "./directoryBuilder";
import type { Builder } from "./types";
import { urlBuilder } from "./urlBuilder";

export { directoryBuilder } from "./directoryBuilder";
export { urlBuilder } from "./urlBuilder";
export type { Builder, BuildOptions, BuildResult } from "./types";

/** Pick the builder that knows how to package this kind of source. */
export function selectBuilder(source: Source): Builder {
  switch (source.kind) {
    case "url":
      return urlBuilder;
    case "directory":
      return directoryBuilder;
  }
}
