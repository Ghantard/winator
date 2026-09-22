import {
  buildInDocker,
  DOCKER_BUILD_STEPS,
  ensureKeystore,
  isInsideContainer,
  resolveSigningConfig,
  SIGN_STEPS,
  signApk,
} from "./utils";
import type { DetectedSource, LogLevel, Logger, Progress } from "./utils";
import { CAPACITOR_BUILD_STEPS, selectBuilder } from "./builders";
import type { BuildOptions } from "./builders";

export interface RunBuildRequest {
  source: DetectedSource;
  /** Absolute path of the APK to produce. */
  output: string;
  /** False to build with the local toolchain instead of Docker. */
  docker: boolean;
  logLevel: LogLevel;
  appId: string;
  appName?: string;
  dockerImage?: string;
  keystore?: string;
  keystorePassword?: string;
  keyAlias?: string;
}

export interface RunBuildOutcome {
  apkPath: string;
  viaDocker: boolean;
  signedWith?: string;
}

/**
 * The build itself, shared by the CLI and the interface: pick the environment,
 * plan the progress, run the pipeline, sign. Failures propagate unchanged so
 * each front end reports them its own way.
 */
export async function runBuild(
  request: RunBuildRequest,
  context: { logger: Logger; progress: Progress },
): Promise<RunBuildOutcome> {
  const { logger, progress } = context;

  // Docker is the default; inside the image we always take the local path, both
  // because --no-docker is passed in and as a guard against recursion.
  if (request.docker && !isInsideContainer()) {
    progress.plan(DOCKER_BUILD_STEPS);
    const result = await buildInDocker({
      source: request.source,
      output: request.output,
      logger,
      progress,
      logLevel: request.logLevel,
      appId: request.appId,
      ...(request.appName !== undefined ? { appName: request.appName } : {}),
      ...(request.dockerImage !== undefined ? { image: request.dockerImage } : {}),
      ...(request.keystore !== undefined ? { keystore: request.keystore } : {}),
      ...(request.keyAlias !== undefined ? { keyAlias: request.keyAlias } : {}),
      ...(request.keystorePassword !== undefined
        ? { keystorePassword: request.keystorePassword }
        : {}),
    });
    return { apkPath: result.apkPath, viaDocker: true };
  }

  const builder = selectBuilder(request.source);
  logger.debug(`Builder : ${builder.name}`);

  // Resolved and prepared before the build so a bad signing setup fails fast,
  // rather than after a Gradle run that takes minutes.
  const signing = resolveSigningConfig({
    ...(request.keystore !== undefined ? { keystore: request.keystore } : {}),
    ...(request.keystorePassword !== undefined ? { password: request.keystorePassword } : {}),
    ...(request.keyAlias !== undefined ? { alias: request.keyAlias } : {}),
  });
  await ensureKeystore(signing, { logger });

  // Both builders run the same Capacitor pipeline, so the count is the same.
  progress.plan(CAPACITOR_BUILD_STEPS + SIGN_STEPS);

  const buildOptions: BuildOptions = {
    source: request.source,
    output: request.output,
    logger,
    progress,
    appId: request.appId,
  };
  if (request.appName !== undefined) {
    buildOptions.appName = request.appName;
  }

  const result = await builder.build(buildOptions);
  await signApk(result.apkPath, signing, { logger, progress });

  return {
    apkPath: result.apkPath,
    viaDocker: false,
    signedWith: signing.isDebug ? "keystore de debug" : signing.keystore,
  };
}
