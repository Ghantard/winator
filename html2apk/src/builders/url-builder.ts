import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger, Progress } from "../utils";
import { buildCapacitorApk, CAPACITOR_BUILD_STEPS } from "./capacitor";
import type { CapacitorBuildOptions, CapacitorBuildResult } from "./capacitor";
import type { Builder, BuildOptions, BuildResult } from "./types";

/** Number of steps buildFromUrl reports. */
export const URL_BUILD_STEPS = CAPACITOR_BUILD_STEPS;

export interface UrlBuildOptions extends CapacitorBuildOptions {
  /** Reverse-DNS application id. Defaults to DEFAULT_APP_ID. */
  appId?: string;
  /** Display name of the app. Defaults to the site's hostname. */
  appName?: string;
  logger?: Logger;
  progress?: Progress;
}

export type UrlBuildResult = CapacitorBuildResult;

/**
 * Package a remote site into a debug APK.
 *
 * The WebView is pointed at the live URL through Capacitor's `server.url`, so
 * any site works without needing a web manifest. www/ holds only an offline
 * fallback page, shown when the device has no connection.
 */
export async function buildFromUrl(
  url: string,
  outputPath: string,
  options: UrlBuildOptions = {},
): Promise<UrlBuildResult> {
  const target = normalizeUrl(url);

  return await buildCapacitorApk({
    ...options,
    output: outputPath,
    serverUrl: target,
    appName: options.appName ?? defaultAppName(target),
    webStepLabel: "Génération de la page de secours hors ligne",
    fillWebDir: (webDir) => {
      writeFileSync(join(webDir, "index.html"), offlinePage(target), "utf8");
    },
  });
}

/** Check the URL and normalize it the way the WebView will see it. */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`URL invalide : ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocole non supporté « ${parsed.protocol.replace(":", "")} » : seuls http et https sont acceptés.`,
    );
  }
  return parsed.toString();
}

/** Derive a display name from the host, dropping a leading "www.". */
export function defaultAppName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host.length > 0 ? host : "html2apk";
}

/**
 * The page shown when the site cannot be reached. Deliberately self-contained:
 * no external CSS or fonts, since by definition there is no network.
 */
export function offlinePage(url: string): string {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hors ligne</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, sans-serif; text-align: center;
    padding: 24px; background: #fff; color: #1a1a1a;
  }
  @media (prefers-color-scheme: dark) { body { background: #121212; color: #ededed; } }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0 0 16px; opacity: .75; line-height: 1.5; }
  code { font-size: .85rem; opacity: .6; word-break: break-all; }
  button {
    font: inherit; padding: 10px 20px; border: 0; border-radius: 8px;
    background: #2563eb; color: #fff;
  }
</style>
</head>
<body>
  <main>
    <h1>Connexion indisponible</h1>
    <p>Cette application a besoin d'une connexion internet pour afficher son contenu.</p>
    <p><code>${safeUrl}</code></p>
    <button onclick="location.href='${safeUrl}'">Réessayer</button>
  </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Builder entry used by the CLI for URL sources. */
export const urlBuilder: Builder = {
  name: "url",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, output, logger } = options;
    if (source.type !== "url") {
      throw new Error(`urlBuilder ne gère pas une source de type « ${source.type} ».`);
    }

    const urlOptions: UrlBuildOptions = { logger };
    if (options.progress !== undefined) {
      urlOptions.progress = options.progress;
    }
    if (options.appId !== undefined) {
      urlOptions.appId = options.appId;
    }
    if (options.appName !== undefined) {
      urlOptions.appName = options.appName;
    }
    return await buildFromUrl(source.path, output, urlOptions);
  },
};
