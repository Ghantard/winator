import { statSync } from "node:fs";

import chalk from "chalk";

import { CommandError } from "./exec";
import type { Logger, LogLevel } from "./logger";

/** Anything we can write the interface to; a TTY gets the animated bar. */
export interface OutputStream {
  write(chunk: string): boolean;
  isTTY?: boolean;
  columns?: number;
}

export interface Progress {
  /** Declare how many steps the run has, so the bar is determinate. */
  plan(total: number): void;
  /** Start a new step, finishing the previous one. */
  step(label: string): void;
  /** Erase the bar, so other output can be written cleanly. */
  clear(): void;
  /** Finish: erase the bar and release the animation timer. */
  stop(): void;
}

export interface BuildSummary {
  apkPath: string;
  /** Size in bytes; read from the APK when omitted. */
  bytes?: number;
  /** Build duration in milliseconds. */
  ms: number;
  signedWith?: string;
  viaDocker?: boolean;
}

export interface Ui {
  logger: Logger;
  progress: Progress;
  /** Print the final report: path, size, duration. */
  summary(summary: BuildSummary): void;
  /** Print a readable report for a failed build. */
  failure(error: unknown): void;
  /** True when every command and all child output is echoed. */
  readonly verbose: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;
const BAR_WIDTH = 24;

/** Human-readable size, e.g. "4,2 Mo". */
export function formatBytes(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(".", ",");
  return `${rounded} ${units[unit] as string}`;
}

/** Human-readable duration, e.g. "3 min 07 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/** Render the progress bar body, e.g. "[████░░░░] 2/6". */
export function renderBar(current: number, total: number, width = BAR_WIDTH): string {
  if (total <= 0) {
    return "";
  }
  const ratio = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(ratio * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  return `${chalk.cyan(`[${bar}]`)} ${chalk.bold(`${current}/${total}`)}`;
}

/**
 * Pick out the lines that actually say what went wrong. Gradle, Docker and
 * Bubblewrap all bury their message in a wall of output, each in their own way.
 */
export function extractRelevantOutput(error: CommandError, maxLines = 12): string[] {
  const lines = error.output
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const tool = error.command.toLowerCase();
  let picked: string[] = [];

  if (tool.includes("gradle")) {
    // Gradle's own report starts at "FAILURE:" and the useful part is the
    // "* What went wrong:" block that follows.
    const start = lines.findIndex((line) => /^(FAILURE:|\* What went wrong:)/.test(line));
    if (start !== -1) {
      const stop = lines.findIndex(
        (line, index) => index > start && /^\* (Try|Get more help)/.test(line),
      );
      picked = lines.slice(start, stop === -1 ? undefined : stop);
    } else {
      picked = lines.filter((line) => /error:|e: |Caused by|Could not/.test(line));
    }
  } else if (tool.includes("docker")) {
    picked = lines.filter((line) =>
      /^(ERROR|error|Cannot connect|permission denied|failed|unauthorized)/i.test(line),
    );
  } else if (tool.includes("bubblewrap")) {
    picked = lines.filter((line) => /error|failed|échec/i.test(line));
  }

  if (picked.length === 0) {
    // Nothing matched: the tail is still the best guess.
    picked = lines.slice(-maxLines);
  }
  return picked.slice(0, maxLines);
}

/** A hint about what to do next, when the failure has a known cause. */
export function diagnose(error: CommandError): string | undefined {
  const output = error.output.toLowerCase();
  const tool = error.command.toLowerCase();

  if (tool.includes("docker") && output.includes("cannot connect to the docker daemon")) {
    return "Le démon Docker n'est pas démarré. Lancez Docker, ou utilisez --no-docker.";
  }
  if (tool.includes("docker") && output.includes("permission denied")) {
    return "Votre utilisateur n'a pas accès au socket Docker : ajoutez-le au groupe « docker ».";
  }
  if (output.includes("sdk location not found") || output.includes("android_home")) {
    return "Le SDK Android est introuvable : définissez ANDROID_HOME, ou laissez le build se faire dans Docker.";
  }
  if (output.includes("invalid source release") || output.includes("unsupported class file")) {
    return "Version de JDK incompatible : le template Capacitor exige un JDK 21.";
  }
  if (/could not (get|resolve)|connection refused|403 forbidden|unknownhost/.test(output)) {
    return "Un téléchargement a échoué : vérifiez l'accès réseau (proxy, pare-feu) et réessayez.";
  }
  if (output.includes("keystore was tampered with") || output.includes("password was incorrect")) {
    return "Mot de passe de keystore incorrect.";
  }
  return undefined;
}

/** A progress object that does nothing but forward the step labels to the log. */
export function nullProgress(logger: Logger): Progress {
  return {
    plan: () => undefined,
    step: (label) => logger.info(label),
    clear: () => undefined,
    stop: () => undefined,
  };
}

export interface CreateUiOptions {
  /** Echo every command and all child output, and drop the animated bar. */
  verbose?: boolean;
  logLevel?: LogLevel;
  stdout?: OutputStream;
  stderr?: OutputStream;
}

/**
 * Build the interface for one run. In verbose mode there is no animated bar:
 * a live bar and streaming subprocess output cannot share a terminal line, so
 * the steps are printed as plain lines instead.
 */
export function createUi(options: CreateUiOptions = {}): Ui {
  const verbose = options.verbose === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const animated = !verbose && stdout.isTTY === true;

  let total = 0;
  let current = 0;
  let label = "";
  let frame = 0;
  let timer: NodeJS.Timeout | undefined;
  let painted = false;

  const width = (): number => Math.max(40, stdout.columns ?? 80);

  const erase = (): void => {
    if (painted) {
      stdout.write(`\r${" ".repeat(width() - 1)}\r`);
      painted = false;
    }
  };

  const paint = (): void => {
    if (!animated) {
      return;
    }
    const spinner = chalk.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length] as string);
    const bar = renderBar(current, total);
    const line = `${bar} ${spinner} ${label}`;
    erase();
    // Truncate so a long label never wraps and leaves debris behind.
    stdout.write(line.slice(0, width() - 1));
    painted = true;
  };

  const startTimer = (): void => {
    if (!animated || timer !== undefined) {
      return;
    }
    timer = setInterval(() => {
      frame += 1;
      paint();
    }, SPINNER_INTERVAL_MS);
    // Never keep the process alive just for the animation.
    timer.unref?.();
  };

  const progress: Progress = {
    plan: (value) => {
      total = value;
      current = 0;
    },
    step: (value) => {
      label = value;
      // Clamp: a miscounted total should not make the bar read 7/6.
      current = total > 0 ? Math.min(current + 1, total) : current + 1;
      if (animated) {
        startTimer();
        paint();
      } else {
        const counter = total > 0 ? chalk.dim(`[${current}/${total}]`) : chalk.dim("[…]");
        stdout.write(`${counter} ${value}\n`);
      }
    },
    clear: erase,
    stop: () => {
      erase();
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };

  const write = (stream: OutputStream, text: string): void => {
    erase();
    stream.write(text);
    // Repaint, so a warning mid-build does not wipe the bar for good.
    if (stream === stdout) {
      paint();
    }
  };

  const threshold = options.logLevel ?? (verbose ? "debug" : "info");
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const enabled = (level: LogLevel): boolean => order[level] >= order[threshold];

  const logger: Logger = {
    debug: (message) => {
      if (enabled("debug")) {
        write(stdout, `${chalk.dim(`· ${message}`)}\n`);
      }
    },
    info: (message) => {
      if (enabled("info")) {
        write(stdout, `${chalk.cyan("›")} ${message}\n`);
      }
    },
    warn: (message) => {
      if (enabled("warn")) {
        progress.clear();
        write(stderr, `${chalk.yellow("!")} ${message}\n`);
      }
    },
    error: (message) => {
      if (enabled("error")) {
        progress.clear();
        write(stderr, `${chalk.red("✗")} ${message}\n`);
      }
    },
  };

  return {
    logger,
    progress,
    verbose,

    summary: (info) => {
      progress.stop();
      const bytes = info.bytes ?? sizeOf(info.apkPath);
      const rows: Array<[string, string]> = [
        ["APK", info.apkPath],
        ["Taille", bytes === undefined ? "inconnue" : formatBytes(bytes)],
        ["Durée", formatDuration(info.ms)],
      ];
      if (info.signedWith !== undefined) {
        rows.push(["Signature", info.signedWith]);
      }
      if (info.viaDocker !== undefined) {
        rows.push(["Environnement", info.viaDocker ? "Docker" : "local"]);
      }

      const pad = Math.max(...rows.map(([key]) => key.length));
      stdout.write(`\n${chalk.green.bold("✓ Build terminé")}\n`);
      for (const [key, value] of rows) {
        stdout.write(`  ${chalk.dim(key.padEnd(pad))}  ${value}\n`);
      }
      stdout.write("\n");
    },

    failure: (error) => {
      progress.stop();
      stderr.write(`\n${chalk.red.bold("✗ Build échoué")}\n`);

      if (error instanceof CommandError) {
        const args = error.args.join(" ");
        stderr.write(`  ${chalk.dim("Étape")}    ${label.length > 0 ? label : "—"}\n`);
        stderr.write(`  ${chalk.dim("Commande")} ${chalk.bold(error.command)} ${chalk.dim(args)}\n`);
        stderr.write(
          `  ${chalk.dim("Sortie")}   ${
            error.signal !== null ? `signal ${error.signal}` : `code ${error.exitCode ?? -1}`
          }\n`,
        );

        const lines = verbose
          ? error.output.split("\n").filter((line) => line.trim().length > 0)
          : extractRelevantOutput(error);
        if (lines.length > 0) {
          stderr.write(`\n${chalk.dim("  ── sortie de l'outil ──")}\n`);
          for (const line of lines) {
            stderr.write(`  ${chalk.red("│")} ${line}\n`);
          }
        }

        const hint = diagnose(error);
        if (hint !== undefined) {
          stderr.write(`\n  ${chalk.yellow("→")} ${hint}\n`);
        }
        if (!verbose) {
          stderr.write(`  ${chalk.dim("→ relancez avec --verbose pour la sortie complète")}\n`);
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`  ${message}\n`);
        if (verbose && error instanceof Error && error.stack !== undefined) {
          stderr.write(`${chalk.dim(error.stack)}\n`);
        }
      }
      stderr.write("\n");
    },
  };
}

function sizeOf(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}
