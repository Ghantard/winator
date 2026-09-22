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
      const detail = tail(stderr.trim().length > 0 ? stderr : stdout);
      rejectPromise(
        new Error(
          `La commande « ${command} ${args.join(" ")} » a échoué (${reason}).${detail}`,
        ),
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

/** Keep the last few lines of output, to make the error message useful but short. */
function tail(output: string, maxLines = 15): string {
  const lines = output.trim().split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return "";
  }
  return `\n${lines.slice(-maxLines).join("\n")}`;
}

/** npm and npx are .cmd shims on Windows, which spawn cannot resolve on its own. */
export function npmExecutable(name: "npm" | "npx"): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** The Gradle wrapper script generated inside an Android project. */
export function gradleWrapper(): string {
  return process.platform === "win32" ? "gradlew.bat" : "./gradlew";
}
