export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = ORDER[level];
  const write = (at: LogLevel, prefix: string, message: string): void => {
    if (ORDER[at] < threshold) {
      return;
    }
    const stream = ORDER[at] >= ORDER.warn ? process.stderr : process.stdout;
    stream.write(`${prefix} ${message}\n`);
  };

  return {
    debug: (message) => write("debug", "·", message),
    info: (message) => write("info", "›", message),
    warn: (message) => write("warn", "!", message),
    error: (message) => write("error", "✗", message),
  };
}
