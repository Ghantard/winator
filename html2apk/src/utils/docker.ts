import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { runCommand } from "./exec";
import type { CommandRunner } from "./exec";
import { createLogger } from "./logger";
import type { Logger, LogLevel } from "./logger";
import { DEBUG_KEYSTORE_DIR, PASSWORD_INPUT_ENV } from "./sign";
import type { DetectedSource } from "./source";

/** Default image tag built from the repository Dockerfile. */
export const DEFAULT_IMAGE = "html2apk:local";
/** Mount points used inside the container. */
export const CONTAINER_SRC = "/work/src";
export const CONTAINER_OUT = "/work/out";
export const CONTAINER_KEYSTORE = "/work/keystore";
/** HOME inside the image; the debug keystore is mounted under it. */
export const CONTAINER_HOME = "/home/builder";
export const CONTAINER_HTML2APK_HOME = `${CONTAINER_HOME}/.html2apk`;
/** Set in the image, so a build inside the container never recurses into Docker. */
export const IN_CONTAINER_ENV = "HTML2APK_IN_CONTAINER";

export interface DockerBuildOptions {
  /** Validated source: a URL is passed through, a folder is mounted. */
  source: DetectedSource;
  /** Host path of the APK to produce. */
  output: string;
  appId?: string;
  appName?: string;
  logLevel?: LogLevel;
  /** Custom keystore to sign with; its directory is mounted read-only. */
  keystore?: string;
  keyAlias?: string;
  /** Keystore password, forwarded through the environment, never as an argument. */
  keystorePassword?: string;
  /** Host directory holding the debug keystore. Defaults to ~/.html2apk. */
  debugKeystoreDir?: string;
  /** Image to run. Defaults to DEFAULT_IMAGE. */
  image?: string;
  /** Build the image when it is missing. Defaults to true. */
  autoBuild?: boolean;
  logger?: Logger;
  /** Injectable command runner, mainly for tests. */
  run?: CommandRunner;
}

export interface DockerBuildResult {
  /** Absolute host path of the retrieved APK. */
  apkPath: string;
  image: string;
}

/** True when this process is already running inside the html2apk image. */
export function isInsideContainer(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[IN_CONTAINER_ENV] === "1";
}

/**
 * Check that the docker CLI exists and that its daemon answers.
 * Throws an Error with a French message, pointing at --no-docker, otherwise.
 */
export async function assertDockerAvailable(options: {
  run?: CommandRunner;
  logger?: Logger;
} = {}): Promise<void> {
  const run = options.run ?? runCommand;
  const cwd = process.cwd();

  try {
    await run("docker", ["--version"], { cwd, ...(options.logger ? { logger: options.logger } : {}) });
  } catch (error: unknown) {
    throw new Error(
      "Docker est introuvable : installez Docker, ou relancez la commande avec " +
        "--no-docker pour utiliser l'environnement local.",
      { cause: error },
    );
  }

  try {
    // `docker info` is the cheapest call that actually reaches the daemon.
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      cwd,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  } catch (error: unknown) {
    throw new Error(
      "Le démon Docker ne répond pas : démarrez Docker (Docker Desktop ou " +
        "`systemctl start docker`), ou relancez la commande avec --no-docker.",
      { cause: error },
    );
  }
}

/** Where the Dockerfile lives, relative to this file (src/utils or dist/utils). */
export function projectRoot(): string {
  return resolve(__dirname, "..", "..");
}

async function imageExists(
  image: string,
  run: CommandRunner,
  logger: Logger | undefined,
): Promise<boolean> {
  try {
    await run("docker", ["image", "inspect", image], {
      cwd: process.cwd(),
      ...(logger ? { logger } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/** Build the image when it is missing. */
export async function ensureImage(
  image: string,
  options: { run?: CommandRunner; logger?: Logger; context?: string } = {},
): Promise<void> {
  const run = options.run ?? runCommand;
  const logger = options.logger;
  if (await imageExists(image, run, logger)) {
    logger?.debug(`Image Docker déjà présente : ${image}`);
    return;
  }

  const context = options.context ?? projectRoot();
  if (!existsSync(resolve(context, "Dockerfile"))) {
    throw new Error(
      `Image Docker « ${image} » absente et aucun Dockerfile trouvé dans ${context} : ` +
        "construisez l'image manuellement, ou relancez avec --no-docker.",
    );
  }

  logger?.info(`Construction de l'image Docker ${image} — première fois, soyez patient`);
  await run("docker", ["build", "-t", image, "."], {
    cwd: context,
    ...(logger ? { logger } : {}),
  });
}

/**
 * Build the `docker run` argument list. Pure, so the mounts and the inner
 * command can be asserted in tests.
 */
export function dockerRunArgs(options: {
  source: DetectedSource;
  output: string;
  image: string;
  appId?: string;
  appName?: string;
  logLevel?: LogLevel;
  user?: string;
  keystore?: string;
  keyAlias?: string;
  /** Forward the password by name only, so its value stays off the argv. */
  forwardPasswordEnv?: boolean;
  debugKeystoreDir?: string;
}): string[] {
  const output = resolve(options.output);
  const outputDir = dirname(output);
  const containerOutput = `${CONTAINER_OUT}/${basename(output)}`;

  const args = ["run", "--rm"];
  if (options.user !== undefined) {
    args.push("--user", options.user);
  }
  args.push("-v", `${outputDir}:${CONTAINER_OUT}`);

  // Mounted read-write so a debug keystore generated inside the container
  // persists on the host; otherwise every build would sign with a new key.
  args.push(
    "-v",
    `${resolve(options.debugKeystoreDir ?? DEBUG_KEYSTORE_DIR)}:${CONTAINER_HTML2APK_HOME}`,
  );

  let innerSource = options.source.path;
  if (options.source.type === "folder") {
    // Read-only: the builder copies the folder into the project, never writes back.
    args.push("-v", `${resolve(options.source.path)}:${CONTAINER_SRC}:ro`);
    innerSource = CONTAINER_SRC;
  }

  let innerKeystore: string | undefined;
  if (options.keystore !== undefined) {
    const keystore = resolve(options.keystore);
    args.push("-v", `${dirname(keystore)}:${CONTAINER_KEYSTORE}:ro`);
    innerKeystore = `${CONTAINER_KEYSTORE}/${basename(keystore)}`;
  }

  if (options.forwardPasswordEnv === true) {
    // Name without a value: docker takes it from this process's environment.
    args.push("-e", PASSWORD_INPUT_ENV);
  }

  args.push(options.image, "build", innerSource, "--output", containerOutput, "--no-docker");
  if (options.appId !== undefined) {
    args.push("--app-id", options.appId);
  }
  if (options.appName !== undefined) {
    args.push("--app-name", options.appName);
  }
  if (innerKeystore !== undefined) {
    args.push("--keystore", innerKeystore);
  }
  if (options.keyAlias !== undefined) {
    args.push("--key-alias", options.keyAlias);
  }
  if (options.logLevel !== undefined) {
    args.push("--log-level", options.logLevel);
  }
  return args;
}

/** The uid:gid to run the container as, so the APK is not owned by root. */
export function currentUser(): string | undefined {
  const getuid = process.getuid?.bind(process);
  const getgid = process.getgid?.bind(process);
  if (getuid === undefined || getgid === undefined) {
    return undefined;
  }
  return `${getuid()}:${getgid()}`;
}

/**
 * Run the build inside the container: mount the source folder (or pass the URL
 * through), mount the output directory, then check the APK came back.
 */
export async function buildInDocker(options: DockerBuildOptions): Promise<DockerBuildResult> {
  const logger = options.logger ?? createLogger("info");
  const run = options.run ?? runCommand;
  const image = options.image ?? DEFAULT_IMAGE;
  const output = resolve(options.output);

  await assertDockerAvailable({ run, logger });
  if (options.autoBuild !== false) {
    await ensureImage(image, { run, logger });
  }

  // Docker would create a missing mount point as a root-owned directory.
  mkdirSync(dirname(output), { recursive: true });
  const debugKeystoreDir = resolve(options.debugKeystoreDir ?? DEBUG_KEYSTORE_DIR);
  mkdirSync(debugKeystoreDir, { recursive: true });

  const args = dockerRunArgs({
    source: options.source,
    output,
    image,
    debugKeystoreDir,
    ...(options.appId !== undefined ? { appId: options.appId } : {}),
    ...(options.appName !== undefined ? { appName: options.appName } : {}),
    ...(options.logLevel !== undefined ? { logLevel: options.logLevel } : {}),
    ...(options.keystore !== undefined ? { keystore: options.keystore } : {}),
    ...(options.keyAlias !== undefined ? { keyAlias: options.keyAlias } : {}),
    ...(options.keystorePassword !== undefined ? { forwardPasswordEnv: true } : {}),
    ...(currentUser() !== undefined ? { user: currentUser() as string } : {}),
  });

  logger.info(`Build dans le conteneur ${image}`);
  await run("docker", args, {
    cwd: process.cwd(),
    logger,
    ...(options.keystorePassword !== undefined
      ? { env: { [PASSWORD_INPUT_ENV]: options.keystorePassword } }
      : {}),
  });

  if (!existsSync(output)) {
    throw new Error(
      `Le conteneur s'est terminé sans erreur mais aucun APK n'a été récupéré : ${output}`,
    );
  }
  return { apkPath: output, image };
}
