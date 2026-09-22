import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type SourceType = "url" | "folder";

export interface DetectedSource {
  /** "url" for a remote website, "folder" for a local directory. */
  type: SourceType;
  /** The normalized URL, or the absolute path of the directory. */
  path: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DetectSourceOptions {
  /** Injectable fetch, mainly for tests. Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Timeout of the reachability check, in milliseconds. */
  timeoutMs?: number;
  /** Skip the network / filesystem content checks and only classify the input. */
  skipChecks?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const INDEX_FILE = "index.html";

/**
 * Classify `input` as a remote URL or a local folder, then make sure it is usable:
 * a URL must answer an HTTP request, a folder must contain an index.html.
 * Throws an Error with a French message when the source is invalid.
 */
export async function detectSource(
  input: string,
  options: DetectSourceOptions = {},
): Promise<DetectedSource> {
  const value = input.trim();
  if (value.length === 0) {
    throw new Error("Source vide : indiquez une URL (https://...) ou un chemin de dossier.");
  }

  const url = parseHttpUrl(value);
  if (url !== undefined) {
    const source: DetectedSource = { type: "url", path: url.toString() };
    if (options.skipChecks !== true) {
      await assertUrlReachable(source.path, options);
    }
    return source;
  }

  const source: DetectedSource = {
    type: "folder",
    path: isAbsolute(value) ? value : resolve(process.cwd(), value),
  };
  if (options.skipChecks !== true) {
    assertFolderSource(source.path);
  }
  return source;
}

/**
 * Parse `value` as an http(s) URL. Returns undefined when it is not a URL at all,
 * and throws when it is a URL with an unusable scheme (ftp://, file://, ...).
 */
function parseHttpUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Protocole non supporté « ${url.protocol.replace(":", "")} » : seuls http et https sont acceptés.`,
    );
  }
  return url;
}

/** Check that the URL answers, with a HEAD request falling back to GET. */
async function assertUrlReachable(url: string, options: DetectSourceOptions): Promise<void> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error(
      "fetch n'est pas disponible dans cet environnement : Node.js 18 ou plus est requis.",
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response = await request(doFetch, url, "HEAD", timeoutMs);
  // Some servers reject HEAD outright; retry once with GET before giving up.
  if (response.status === 405 || response.status === 501) {
    response = await request(doFetch, url, "GET", timeoutMs);
  }

  if (!response.ok) {
    const statusText = response.statusText.trim();
    const detail = statusText.length > 0 ? `${response.status} ${statusText}` : `${response.status}`;
    throw new Error(`URL inaccessible (${detail}) : ${url}`);
  }
}

async function request(
  doFetch: FetchLike,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number,
): Promise<Response> {
  try {
    return await doFetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    if (isTimeout(error)) {
      throw new Error(
        `Délai dépassé (${timeoutMs} ms) lors de la vérification de l'URL : ${url}`,
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Impossible de joindre l'URL ${url} : ${reason}`);
  }
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Check that the folder exists and holds an index.html file.
 * Throws an Error with a French message otherwise.
 */
export function assertFolderSource(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Dossier introuvable : ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`La source doit être un dossier, pas un fichier : ${path}`);
  }

  const indexPath = join(path, INDEX_FILE);
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(`Aucun fichier ${INDEX_FILE} trouvé dans le dossier : ${path}`);
  }
}

/** Short, human-readable label for logs and error messages. */
export function describeSource(source: DetectedSource): string {
  return source.type === "url" ? `URL ${source.path}` : `dossier ${source.path}`;
}
