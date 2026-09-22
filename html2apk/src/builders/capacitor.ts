import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { createLogger, gradleWrapper, npmExecutable, nullProgress, runCommand } from "../utils";
import type { CommandRunner, Logger, Progress } from "../utils";
import type { BuildResult } from "./types";

/** Default reverse-DNS application id, overridable with --app-id. */
export const DEFAULT_APP_ID = "com.html2apk.app";
/** Capacitor version range installed in the temporary project. */
export const DEFAULT_CAPACITOR_VERSION = "^8.0.0";
/** Where the Gradle debug build drops its artifact, relative to the project root. */
export const DEBUG_APK_PATH = join(
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
/** Steps every Capacitor build reports, so the progress bar can size itself. */
export const CAPACITOR_BUILD_STEPS = 6;

const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  android: {
    allowMixedContent: boolean;
  };
  /** Present only for URL builds: the WebView loads this instead of www/. */
  server?: {
    url: string;
    cleartext: boolean;
    androidScheme: string;
  };
}

export interface CapacitorBuildOptions {
  logger?: Logger;
  /** Reports each step; defaults to plain log lines. */
  progress?: Progress;
  /** Injectable command runner, mainly for tests. */
  run?: CommandRunner;
  /** Keep the temporary Capacitor project on disk (useful to debug a failed build). */
  keepProject?: boolean;
  capacitorVersion?: string;
}

export interface CapacitorBuildRequest extends CapacitorBuildOptions {
  /** Absolute path of the APK to produce. */
  output: string;
  /** Reverse-DNS application id; DEFAULT_APP_ID when absent. */
  appId?: string;
  appName: string;
  /** Remote URL the app should load, for a URL build. */
  serverUrl?: string;
  /** Fills the project's www/ directory. */
  fillWebDir: (webDir: string) => void;
  /** What to call the step that fills www/. */
  webStepLabel: string;
}

export interface CapacitorBuildResult extends BuildResult {
  /** The temporary Capacitor project; removed unless the build failed or keepProject was set. */
  projectPath: string;
  kept: boolean;
}

/**
 * Scaffold a throwaway Capacitor project, add the Android platform and run the
 * Gradle debug build, then copy the APK to the requested path. Shared by both
 * builders: a folder build fills www/ with the source, a URL build points the
 * WebView at the site and leaves an offline fallback page in www/.
 */
export async function buildCapacitorApk(
  request: CapacitorBuildRequest,
): Promise<CapacitorBuildResult> {
  const logger = request.logger ?? createLogger("info");
  const progress = request.progress ?? nullProgress(logger);
  const run = request.run ?? runCommand;
  const npm = npmExecutable("npm");
  const npx = npmExecutable("npx");

  const output = resolve(request.output);
  const appId = normalizeAppId(request.appId);
  const appName = normalizeAppName(request.appName);
  const capacitorVersion = request.capacitorVersion ?? DEFAULT_CAPACITOR_VERSION;

  const projectPath = mkdtempSync(join(tmpdir(), "html2apk-"));
  logger.debug(`Projet temporaire : ${projectPath}`);
  let kept = request.keepProject === true;

  try {
    progress.step(`Préparation du projet Capacitor (${appId} / ${appName})`);
    writeProjectFiles(projectPath, {
      appId,
      appName,
      capacitorVersion,
      ...(request.serverUrl !== undefined ? { serverUrl: request.serverUrl } : {}),
    });

    progress.step(request.webStepLabel);
    const webDir = join(projectPath, "www");
    mkdirSync(webDir, { recursive: true });
    request.fillWebDir(webDir);

    progress.step("Installation des dépendances Capacitor");
    await run(npm, ["install", "--no-audit", "--no-fund"], { cwd: projectPath, logger });

    progress.step("Ajout de la plateforme Android");
    await run(npx, ["cap", "add", "android"], { cwd: projectPath, logger });

    progress.step("Synchronisation des fichiers web");
    await run(npx, ["cap", "sync", "android"], { cwd: projectPath, logger });

    progress.step("Build Gradle (assembleDebug) — plusieurs minutes possibles");
    await run(gradleWrapper(), ["assembleDebug"], {
      cwd: join(projectPath, "android"),
      logger,
    });

    const apkPath = copyApk(projectPath, output);
    logger.debug(`APK généré : ${apkPath}`);
    return { apkPath, projectPath, kept };
  } catch (error: unknown) {
    // Leave the project behind so the failing Gradle/Capacitor state can be inspected.
    kept = true;
    logger.warn(`Projet conservé pour inspection : ${projectPath}`);
    throw error;
  } finally {
    if (!kept) {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }
}

/** Build the capacitor.config.json contents. */
export function createCapacitorConfig(
  appId: string,
  appName: string,
  serverUrl?: string,
): CapacitorConfig {
  const config: CapacitorConfig = {
    appId: normalizeAppId(appId),
    appName: normalizeAppName(appName),
    webDir: "www",
    android: {
      // Pages routinely pull in http:// assets; refusing them breaks the app silently.
      allowMixedContent: true,
    },
  };

  if (serverUrl !== undefined) {
    config.server = {
      url: serverUrl,
      // Only needed when the site itself is served over plain http.
      cleartext: serverUrl.startsWith("http://"),
      androidScheme: "https",
    };
  }
  return config;
}

/** Validate an application id, falling back to the default when absent. */
export function normalizeAppId(appId?: string): string {
  const value = (appId ?? DEFAULT_APP_ID).trim();
  if (!APP_ID_PATTERN.test(value)) {
    throw new Error(
      `Identifiant d'application invalide « ${value} » : utilisez une notation ` +
        "inversée de type com.exemple.monapp (au moins deux segments, lettres, " +
        "chiffres et « _ », chaque segment commençant par une lettre).",
    );
  }
  return value;
}

/** Validate a display name. */
export function normalizeAppName(appName: string): string {
  const value = appName.trim();
  if (value.length === 0) {
    throw new Error("Nom d'application vide : indiquez un nom avec --app-name.");
  }
  return value;
}

function writeProjectFiles(
  projectPath: string,
  config: { appId: string; appName: string; capacitorVersion: string; serverUrl?: string },
): void {
  const packageJson = {
    name: "html2apk-project",
    version: "1.0.0",
    private: true,
    devDependencies: {
      "@capacitor/cli": config.capacitorVersion,
    },
    dependencies: {
      "@capacitor/android": config.capacitorVersion,
      "@capacitor/core": config.capacitorVersion,
    },
  };
  writeFileSync(join(projectPath, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(
    join(projectPath, "capacitor.config.json"),
    `${JSON.stringify(
      createCapacitorConfig(config.appId, config.appName, config.serverUrl),
      null,
      2,
    )}\n`,
  );
}

function copyApk(projectPath: string, output: string): string {
  const built = join(projectPath, DEBUG_APK_PATH);
  if (!existsSync(built)) {
    throw new Error(`Build terminé mais aucun APK trouvé à l'emplacement attendu : ${built}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  cpSync(built, output);
  return output;
}
