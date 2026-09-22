#!/usr/bin/env node
import { resolve } from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { selectBuilder } from "./builders";
import { createLogger, describeSource, detectSource } from "./utils";
import type { LogLevel } from "./utils";

const DEFAULT_OUTPUT = "./output.apk";
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

interface BuildCommandOptions {
  output: string;
  logLevel: LogLevel;
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
    .option("--log-level <level>", `one of ${LOG_LEVELS.join(", ")}`, parseLogLevel, "info")
    .action(async (rawSource: string, options: BuildCommandOptions) => {
      const logger = createLogger(options.logLevel);
      const source = await detectSource(rawSource);
      const output = resolve(process.cwd(), options.output);

      logger.info(`Source: ${describeSource(source)}`);
      logger.debug(`Output: ${output}`);

      const builder = selectBuilder(source);
      logger.debug(`Builder: ${builder.name}`);

      const result = await builder.build({ source, output, logger });
      logger.info(`APK written to ${result.apkPath}`);
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`✗ ${message}\n`);
    process.exitCode = 1;
  });
}
