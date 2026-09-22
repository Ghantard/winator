import { spawn } from "node:child_process";

import type { Logger } from "./logger";

export interface RunOptions {
  /** Working directory of the child process. */
  cwd: string;
  /** Logger receiving the child's stdout/stderr at debug level. */
  logger?: Logger;
  /** Extra environment variables, merged over process.env. */
  env?: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * A command that failed, keeping everything needed to explain why: the tool,
 * its arguments, the exit status and the full captured output. The UI layer
 * turns this into a readable report instead of dumping hundreds of lines.
 */
export class CommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(details: {
    command: string;
    args: readonly string[];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    message: string;
  }) {
    super(details.message);
    this.name = "CommandError";
    this.command = details.command;
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
  }

  /** Everything the tool printed, in the order a terminal would have shown it. */
  get output(): string {
    return `${this.stdout}${this.stderr}`;
  }
}

/** Injectable command runner, so builds can be tested without spawning anything. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

/**
 * Run a command to completion, rejecting when it exits with a non-zero status.
 * Output is streamed to the logger at debug level and also captured, so a
 * failure message can quote the tail of stderr.
 */
export const runCommand: CommandRunner = async (command, args, options) => {
  const { cwd, logger } = options;
  logger?.debug(`$ ${command} ${args.join(" ")} (${cwd})`);

  return await new Promise<RunResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      logLines(logger, chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      logLines(logger, chunk);
    });

    child.on("error", (error: Error) => {
      rejectPromise(
        new Error(`Impossible d'exécuter « ${command} » : ${error.message}`, { cause: error }),
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const reason = signal !== null ? `interrompu par le signal ${signal}` : `code ${code ?? -1}`;
      rejectPromise(
        new CommandError({
          command,
          args: [...args],
          exitCode: code,
          signal,
          stdout,
          stderr,
          message: `La commande « ${command} ${args.join(" ")} » a échoué (${reason}).`,
        }),
      );
    });
  });
};

function logLines(logger: Logger | undefined, chunk: string): void {
  if (logger === undefined) {
    return;
  }
  for (const line of chunk.split("\n")) {
    if (line.trim().length > 0) {
      logger.debug(`  ${line.trimEnd()}`);
    }
  }
}

/** npm and npx are .cmd shims on Windows, which spawn cannot resolve on its own. */
export function npmExecutable(name: "npm" | "npx"): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** The Gradle wrapper script generated inside an Android project. */
export function gradleWrapper(): string {
  return process.platform === "win32" ? "gradlew.bat" : "./gradlew";
}
