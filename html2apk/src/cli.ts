#!/usr/bin/env node
import { resolve } from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { CAPACITOR_BUILD_STEPS, DEFAULT_APP_ID, selectBuilder } from "./builders";
import type { BuildOptions } from "./builders";
import {
  buildInDocker,
  createUi,
  DEBUG_KEYSTORE_PATH,
  DEFAULT_IMAGE,
  describeSource,
  detectSource,
  DOCKER_BUILD_STEPS,
  ensureKeystore,
  isInsideContainer,
  resolveSigningConfig,
  SIGN_STEPS,
  signApk,
} from "./utils";
import type { LogLevel } from "./utils";

const DEFAULT_OUTPUT = "./output.apk";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

interface BuildCommandOptions {
  output: string;
  logLevel: LogLevel;
  appId: string;
  appName?: string;
  /** False when --no-docker was passed. */
  docker: boolean;
  dockerImage?: string;
  keystore?: string;
  keystorePassword?: string;
  keyAlias?: string;
  verbose?: boolean;
}

function parseLogLevel(value: string): LogLevel {
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) {
    throw new InvalidArgumentError(`Expected one of: ${LOG_LEVELS.join(", ")}.`);
  }
  return level;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("html2apk")
    .description("Package a website or a local HTML folder into an Android APK")
    .version("0.1.0");

  program
    .command("build")
    .description("Build an APK from a URL or a local folder")
    .argument("<source>", "https:// URL or path to a folder containing index.html")
    .option("-o, --output <file>", "path of the generated APK", DEFAULT_OUTPUT)
    .option("--app-id <id>", "reverse-DNS application id", DEFAULT_APP_ID)
    .option("--app-name <name>", "display name of the app (default: the folder name)")
    .option("--keystore <file>", `keystore to sign with (default: ${DEBUG_KEYSTORE_PATH})`)
    .option("--keystore-password <password>", "keystore password (default: from the environment)")
    .option("--key-alias <alias>", "alias of the signing key")
    .option("--no-docker", "build with the local toolchain instead of Docker")
    .option("--docker-image <name>", `image to run (default: ${DEFAULT_IMAGE})`)
    .option("-v, --verbose", "echo every command and all tool output")
    .option("--log-level <level>", `one of ${LOG_LEVELS.join(", ")}`, parseLogLevel, "info")
    .action(async (rawSource: string, options: BuildCommandOptions) => {
      const ui = createUi({
        verbose: options.verbose === true,
        // --verbose implies debug, otherwise --log-level decides.
        ...(options.verbose === true ? {} : { logLevel: options.logLevel }),
      });
      const { logger, progress } = ui;
      const startedAt = Date.now();

      try {
        const source = await detectSource(rawSource);
        const output = resolve(process.cwd(), options.output);

        logger.info(`Source : ${describeSource(source)}`);
        logger.debug(`Sortie : ${output}`);

        // Docker is the default; inside the image we always take the local path,
        // both because --no-docker is passed in and as a guard against recursion.
        const useDocker = options.docker && !isInsideContainer();

        if (useDocker) {
          progress.plan(DOCKER_BUILD_STEPS);
          const result = await buildInDocker({
            source,
            output,
            logger,
            progress,
            logLevel: options.verbose === true ? "debug" : options.logLevel,
            appId: options.appId,
            ...(options.appName !== undefined ? { appName: options.appName } : {}),
            ...(options.dockerImage !== undefined ? { image: options.dockerImage } : {}),
            ...(options.keystore !== undefined ? { keystore: options.keystore } : {}),
            ...(options.keyAlias !== undefined ? { keyAlias: options.keyAlias } : {}),
            ...(options.keystorePassword !== undefined
              ? { keystorePassword: options.keystorePassword }
              : {}),
          });
          ui.summary({ apkPath: result.apkPath, ms: Date.now() - startedAt, viaDocker: true });
          return;
        }

        const builder = selectBuilder(source);
        logger.debug(`Builder : ${builder.name}`);

        // Resolved and prepared before the build so a bad signing setup fails
        // fast, rather than after a Gradle run that takes minutes.
        const signing = resolveSigningConfig({
          ...(options.keystore !== undefined ? { keystore: options.keystore } : {}),
          ...(options.keystorePassword !== undefined ? { password: options.keystorePassword } : {}),
          ...(options.keyAlias !== undefined ? { alias: options.keyAlias } : {}),
        });
        await ensureKeystore(signing, { logger });

        // Both builders run the same Capacitor pipeline, so the count is the same.
        progress.plan(CAPACITOR_BUILD_STEPS + SIGN_STEPS);

        const buildOptions: BuildOptions = {
          source,
          output,
          logger,
          progress,
          appId: options.appId,
        };
        if (options.appName !== undefined) {
          buildOptions.appName = options.appName;
        }

        const result = await builder.build(buildOptions);
        await signApk(result.apkPath, signing, { logger, progress });

        ui.summary({
          apkPath: result.apkPath,
          ms: Date.now() - startedAt,
          viaDocker: false,
          signedWith: signing.isDebug ? "keystore de debug" : signing.keystore,
        });
      } catch (error: unknown) {
        ui.failure(error);
        process.exitCode = 1;
      } finally {
        progress.stop();
      }
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // The build action reports its own failures; this catches everything else.
    createUi({}).failure(error);
    process.exitCode = 1;
  });
}
