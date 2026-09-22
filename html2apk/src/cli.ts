#!/usr/bin/env node
import { resolve } from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { runBuild } from "./build";
import { DEFAULT_APP_ID } from "./builders";
import { startGui, DEFAULT_PORT, OUTPUT_DIR } from "./gui";
import {
  createUi,
  DEBUG_KEYSTORE_PATH,
  DEFAULT_IMAGE,
  describeSource,
  detectSource,
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

interface UiCommandOptions {
  logLevel: LogLevel;
  port?: number;
  outputDir?: string;
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

        const outcome = await runBuild(
          {
            source,
            output,
            docker: options.docker,
            logLevel: options.verbose === true ? "debug" : options.logLevel,
            appId: options.appId,
            ...(options.appName !== undefined ? { appName: options.appName } : {}),
            ...(options.dockerImage !== undefined ? { dockerImage: options.dockerImage } : {}),
            ...(options.keystore !== undefined ? { keystore: options.keystore } : {}),
            ...(options.keyAlias !== undefined ? { keyAlias: options.keyAlias } : {}),
            ...(options.keystorePassword !== undefined
              ? { keystorePassword: options.keystorePassword }
              : {}),
          },
          { logger, progress },
        );

        ui.summary({
          apkPath: outcome.apkPath,
          ms: Date.now() - startedAt,
          viaDocker: outcome.viaDocker,
          ...(outcome.signedWith !== undefined ? { signedWith: outcome.signedWith } : {}),
        });
      } catch (error: unknown) {
        ui.failure(error);
        process.exitCode = 1;
      } finally {
        progress.stop();
      }
    });

  program
    .command("ui", { isDefault: true })
    .alias("interface")
    .description("Open the graphical interface in a browser")
    .option("--port <number>", `port to listen on (default: ${DEFAULT_PORT})`, (value) => {
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new InvalidArgumentError("Expected a port between 1 and 65535.");
      }
      return port;
    })
    .option("--output-dir <dir>", `where to write the APKs (default: ${OUTPUT_DIR})`)
    .option("--log-level <level>", `one of ${LOG_LEVELS.join(", ")}`, parseLogLevel, "info")
    .action(async (options: UiCommandOptions) => {
      try {
        await startGui({
          logLevel: options.logLevel,
          ...(options.port !== undefined ? { port: options.port } : {}),
          ...(options.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
        });
      } catch (error: unknown) {
        createUi({}).failure(error);
        process.exitCode = 1;
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
