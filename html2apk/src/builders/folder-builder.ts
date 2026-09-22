import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  assertFolderSource,
  createLogger,
  gradleWrapper,
  npmExecutable,
  runCommand,
} from "../utils";
import { nullProgress } from "../utils";
import type { CommandRunner, Logger, Progress } from "../utils";
import type { Builder, BuildOptions, BuildResult } from "./types";

/** Default reverse-DNS application id, overridable with --app-id. */
export const DEFAULT_APP_ID = "com.html2apk.app";
/** Capacitor version range installed in the temporary project. */
export const DEFAULT_CAPACITOR_VERSION = "^8.0.0";
/** Where the Gradle debug build drops its artifact, relative to the project root. */
/** Number of steps buildFromFolder reports, so the progress bar can size itself. */
export const FOLDER_BUILD_STEPS = 6;
export const DEBUG_APK_PATH = join("android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  android: {
    allowMixedContent: boolean;
  };
}

export interface FolderBuildOptions {
  /** Reverse-DNS application id. Defaults to DEFAULT_APP_ID. */
  appId?: string;
  /** Display name of the app. Defaults to the source folder name. */
  appName?: string;
  logger?: Logger;
  /** Reports each step; defaults to plain log lines. */
  progress?: Progress;
  /** Injectable command runner, mainly for tests. */
  run?: CommandRunner;
  /** Keep the temporary Capacitor project on disk (useful to debug a failed build). */
  keepProject?: boolean;
  capacitorVersion?: string;
}

export interface FolderBuildResult extends BuildResult {
  /** The temporary Capacitor project; removed unless keepProject was set. */
  projectPath: string;
  kept: boolean;
}

/**
 * Package a local HTML folder into a debug APK.
 *
 * Scaffolds a throwaway Capacitor project in the system temp directory, copies
 * the folder into its www/, adds the Android platform and runs the Gradle debug
 * build, then copies the resulting APK to outputPath.
 */
export async function buildFromFolder(
  folderPath: string,
  outputPath: string,
  options: FolderBuildOptions = {},
): Promise<FolderBuildResult> {
  const logger = options.logger ?? createLogger("info");
  const progress = options.progress ?? nullProgress(logger);
  const run = options.run ?? runCommand;
  const npm = npmExecutable("npm");
  const npx = npmExecutable("npx");

  const source = resolve(folderPath);
  const output = resolve(outputPath);
  assertFolderSource(source);

  const appId = normalizeAppId(options.appId);
  const appName = normalizeAppName(options.appName ?? defaultAppName(source));
  const capacitorVersion = options.capacitorVersion ?? DEFAULT_CAPACITOR_VERSION;

  const projectPath = mkdtempSync(join(tmpdir(), "html2apk-"));
  logger.debug(`Projet temporaire : ${projectPath}`);
  let kept = options.keepProject === true;

  try {
    progress.step(`Préparation du projet Capacitor (${appId} / ${appName})`);
    writeProjectFiles(projectPath, { appId, appName, capacitorVersion });

    progress.step("Copie du contenu du dossier dans www/");
    const webDir = join(projectPath, "www");
    mkdirSync(webDir, { recursive: true });
    cpSync(source, webDir, { recursive: true, dereference: true });

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

/** Build the capacitor.config.json contents used for a folder build. */
export function createCapacitorConfig(appId: string, appName: string): CapacitorConfig {
  return {
    appId: normalizeAppId(appId),
    appName: normalizeAppName(appName),
    webDir: "www",
    android: {
      // Local pages routinely pull in http:// assets; refusing them breaks the app silently.
      allowMixedContent: true,
    },
  };
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

/** Derive a display name from the folder name, ignoring a trailing separator. */
export function defaultAppName(folderPath: string): string {
  const name = basename(resolve(folderPath));
  return name.length > 0 ? name : "html2apk";
}

function writeProjectFiles(
  projectPath: string,
  config: { appId: string; appName: string; capacitorVersion: string },
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
    `${JSON.stringify(createCapacitorConfig(config.appId, config.appName), null, 2)}\n`,
  );
}

function copyApk(projectPath: string, output: string): string {
  const built = join(projectPath, DEBUG_APK_PATH);
  if (!existsSync(built)) {
    throw new Error(
      `Build terminé mais aucun APK trouvé à l'emplacement attendu : ${built}`,
    );
  }
  mkdirSync(dirname(output), { recursive: true });
  cpSync(built, output);
  return output;
}

/** Builder entry used by the CLI for folder sources. */
export const folderBuilder: Builder = {
  name: "folder",

  async build(options: BuildOptions): Promise<BuildResult> {
    const { source, output, logger } = options;
    if (source.type !== "folder") {
      throw new Error(`folderBuilder ne gère pas une source de type « ${source.type} ».`);
    }

    const folderOptions: FolderBuildOptions = { logger };
    if (options.progress !== undefined) {
      folderOptions.progress = options.progress;
    }
    if (options.appId !== undefined) {
      folderOptions.appId = options.appId;
    }
    if (options.appName !== undefined) {
      folderOptions.appName = options.appName;
    }
    return await buildFromFolder(source.path, output, folderOptions);
  },
};
