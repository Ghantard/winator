import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** A remote website, fetched over http(s). */
export interface UrlSource {
  kind: "url";
  url: string;
}

/** A local directory containing an index.html and its assets. */
export interface DirectorySource {
  kind: "directory";
  path: string;
}

export type Source = UrlSource | DirectorySource;

/**
 * Decide whether `raw` points at a remote site or a local folder.
 * Throws when the input is neither a usable http(s) URL nor an existing directory.
 */
export function resolveSource(raw: string): Source {
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error("Source is empty: pass a URL (https://...) or a folder path.");
  }

  if (looksLikeUrl(value)) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported protocol "${url.protocol}": only http and https are supported.`);
    }
    return { kind: "url", url: url.toString() };
  }

  const path = isAbsolute(value) ? value : resolve(process.cwd(), value);
  if (!existsSync(path)) {
    throw new Error(`Source not found: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`Source must be a directory, not a file: ${path}`);
  }
  return { kind: "directory", path };
}

function looksLikeUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Short, human-readable label for logs and error messages. */
export function describeSource(source: Source): string {
  return source.kind === "url" ? `URL ${source.url}` : `folder ${source.path}`;
}
