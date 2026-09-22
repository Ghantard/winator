import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandError } from "../src/utils/exec";
import {
  createUi,
  diagnose,
  extractRelevantOutput,
  formatBytes,
  formatDuration,
  nullProgress,
  renderBar,
} from "../src/utils/ui";
import type { OutputStream } from "../src/utils/ui";

/** A stream that records what was written, pretending to be a fixed-width TTY. */
function fakeStream(isTTY: boolean): OutputStream & { text: () => string; chunks: string[] } {
  const chunks: string[] = [];
  return {
    isTTY,
    columns: 100,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    chunks,
    text: () => chunks.join(""),
  };
}

function commandError(overrides: Partial<{
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> = {}): CommandError {
  return new CommandError({
    command: overrides.command ?? "./gradlew",
    args: overrides.args ?? ["assembleDebug"],
    exitCode: overrides.exitCode ?? 1,
    signal: null,
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    message: "La commande a échoué.",
  });
}

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

// chalk must not emit escape codes, so assertions can match plain text.
const previousForceColor = process.env["FORCE_COLOR"];
beforeEach(() => {
  process.env["FORCE_COLOR"] = "0";
});
afterEach(() => {
  if (previousForceColor === undefined) {
    delete process.env["FORCE_COLOR"];
  } else {
    process.env["FORCE_COLOR"] = previousForceColor;
  }
});

describe("formatBytes", () => {
  it.each([
    [0, "0 o"],
    [512, "512 o"],
    [1024, "1,0 Ko"],
    [1536, "1,5 Ko"],
    [4 * 1024 * 1024, "4,0 Mo"],
    [Math.round(2.5 * 1024 * 1024 * 1024), "2,5 Go"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [1500, "2 s"],
    [59_000, "59 s"],
    [60_000, "1 min 00 s"],
    [187_000, "3 min 07 s"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("renderBar", () => {
  it("fills proportionally and shows the counter", () => {
    const bar = renderBar(3, 6, 10);

    expect(bar).toContain("3/6");
    expect(bar).toContain("█████░░░░░");
  });

  it("renders nothing without a known total", () => {
    expect(renderBar(1, 0)).toBe("");
  });
});

describe("extractRelevantOutput", () => {
  it("keeps Gradle's 'what went wrong' block and drops its boilerplate", () => {
    const error = commandError({
      stderr: [
        "> Task :app:preBuild UP-TO-DATE",
        "FAILURE: Build failed with an exception.",
        "* What went wrong:",
        "A problem occurred configuring project ':app'.",
        "> SDK location not found.",
        "* Try:",
        "> Run with --stacktrace option to get the stack trace.",
        "BUILD FAILED in 14s",
      ].join("\n"),
    });

    const lines = extractRelevantOutput(error);

    expect(lines[0]).toBe("FAILURE: Build failed with an exception.");
    expect(lines).toContain("> SDK location not found.");
    expect(lines.join("\n")).not.toContain("--stacktrace");
    expect(lines.join("\n")).not.toContain("UP-TO-DATE");
  });

  it("keeps only the error lines from Docker", () => {
    const error = commandError({
      command: "docker",
      args: ["run", "--rm", "html2apk:local"],
      stderr: [
        "Unable to find image 'html2apk:local' locally",
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.",
      ].join("\n"),
    });

    const lines = extractRelevantOutput(error);

    expect(lines).toEqual([
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.",
    ]);
  });

  it("keeps the error lines from Bubblewrap", () => {
    const error = commandError({
      command: "bubblewrap",
      args: ["build"],
      stdout: ["Generating Android Project", "Error: Failed to run the Gradle build"].join("\n"),
    });

    expect(extractRelevantOutput(error)).toEqual(["Error: Failed to run the Gradle build"]);
  });

  it("falls back to the tail when nothing matches", () => {
    const error = commandError({
      command: "npm",
      args: ["install"],
      stdout: Array.from({ length: 40 }, (_, index) => `ligne ${index}`).join("\n"),
    });

    const lines = extractRelevantOutput(error, 5);

    expect(lines).toEqual(["ligne 35", "ligne 36", "ligne 37", "ligne 38", "ligne 39"]);
  });

  it("caps the number of lines it returns", () => {
    const error = commandError({
      command: "docker",
      args: ["build"],
      stderr: Array.from({ length: 50 }, () => "ERROR: quelque chose").join("\n"),
    });

    expect(extractRelevantOutput(error, 7)).toHaveLength(7);
  });

  it("returns nothing when the tool printed nothing", () => {
    expect(extractRelevantOutput(commandError())).toEqual([]);
  });
});

describe("diagnose", () => {
  it.each([
    ["docker", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock", /démon Docker/],
    ["docker", "permission denied while trying to connect", /groupe « docker »/],
    ["./gradlew", "SDK location not found", /SDK Android est introuvable/],
    ["./gradlew", "error: invalid source release: 21", /JDK 21/],
    ["./gradlew", "Could not GET 'https://dl.google.com/...'", /accès réseau/],
    ["apksigner", "keystore password was incorrect", /Mot de passe de keystore incorrect/],
  ])("explains a %s failure", (command, output, expected) => {
    expect(diagnose(commandError({ command, stderr: output }))).toMatch(expected);
  });

  it("stays silent on an unknown failure", () => {
    expect(diagnose(commandError({ stderr: "quelque chose d'inattendu" }))).toBeUndefined();
  });
});

describe("nullProgress", () => {
  it("forwards step labels to the log", () => {
    const messages: string[] = [];
    const progress = nullProgress({
      debug: () => undefined,
      info: (message) => messages.push(message),
      warn: () => undefined,
      error: () => undefined,
    });

    progress.plan(3);
    progress.step("étape 1");
    progress.stop();

    expect(messages).toEqual(["étape 1"]);
  });
});

describe("createUi — progress", () => {
  it("draws an animated bar on a TTY", () => {
    const stdout = fakeStream(true);
    const ui = createUi({ stdout, stderr: fakeStream(false) });

    ui.progress.plan(4);
    ui.progress.step("Préparation du projet Capacitor");
    ui.progress.stop();

    const text = stdout.text();
    expect(text).toContain("1/4");
    expect(text).toContain("Préparation du projet Capacitor");
    // A TTY bar rewrites its line rather than scrolling.
    expect(text).toContain("\r");
  });

  it("prints plain numbered lines when the output is not a TTY", () => {
    const stdout = fakeStream(false);
    const ui = createUi({ stdout, stderr: fakeStream(false) });

    ui.progress.plan(2);
    ui.progress.step("Première étape");
    ui.progress.step("Deuxième étape");
    ui.progress.stop();

    expect(stdout.text()).toBe("[1/2] Première étape\n[2/2] Deuxième étape\n");
  });

  it("drops the animated bar in verbose mode, even on a TTY", () => {
    const stdout = fakeStream(true);
    const ui = createUi({ verbose: true, stdout, stderr: fakeStream(false) });

    ui.progress.plan(2);
    ui.progress.step("Une étape");
    ui.progress.stop();

    expect(stdout.text()).toBe("[1/2] Une étape\n");
    expect(stdout.text()).not.toContain("\r");
  });

  it("never lets the counter exceed the planned total", () => {
    const stdout = fakeStream(false);
    const ui = createUi({ stdout, stderr: fakeStream(false) });

    ui.progress.plan(2);
    ui.progress.step("a");
    ui.progress.step("b");
    ui.progress.step("c");

    expect(stdout.text()).toContain("[2/2] c");
  });

  it("shows debug output only in verbose mode", () => {
    const quiet = fakeStream(false);
    createUi({ stdout: quiet, stderr: fakeStream(false) }).logger.debug("détail");
    expect(quiet.text()).toBe("");

    const loud = fakeStream(false);
    createUi({ verbose: true, stdout: loud, stderr: fakeStream(false) }).logger.debug("détail");
    expect(loud.text()).toContain("détail");
  });

  it("sends warnings and errors to stderr", () => {
    const stdout = fakeStream(false);
    const stderr = fakeStream(false);
    const ui = createUi({ stdout, stderr });

    ui.logger.warn("attention");
    ui.logger.error("cassé");

    expect(stderr.text()).toContain("attention");
    expect(stderr.text()).toContain("cassé");
    expect(stdout.text()).toBe("");
  });
});

describe("createUi — summary", () => {
  it("reports the path, size and duration", () => {
    const dir = mkdtempSync(join(tmpdir(), "html2apk-ui-"));
    temps.push(dir);
    const apk = join(dir, "app.apk");
    writeFileSync(apk, Buffer.alloc(3 * 1024 * 1024));

    const stdout = fakeStream(false);
    createUi({ stdout, stderr: fakeStream(false) }).summary({ apkPath: apk, ms: 125_000 });

    const text = stdout.text();
    expect(text).toContain("Build terminé");
    expect(text).toContain(apk);
    expect(text).toContain("3,0 Mo");
    expect(text).toContain("2 min 05 s");
  });

  it("says so rather than guessing when the APK cannot be measured", () => {
    const stdout = fakeStream(false);
    createUi({ stdout, stderr: fakeStream(false) }).summary({
      apkPath: "/absent/app.apk",
      ms: 1000,
    });

    expect(stdout.text()).toContain("inconnue");
  });

  it("reports the signing key and the environment when given", () => {
    const stdout = fakeStream(false);
    createUi({ stdout, stderr: fakeStream(false) }).summary({
      apkPath: "/absent/app.apk",
      bytes: 1024,
      ms: 1000,
      signedWith: "keystore de debug",
      viaDocker: true,
    });

    expect(stdout.text()).toContain("keystore de debug");
    expect(stdout.text()).toContain("Docker");
  });
});

describe("createUi — failure", () => {
  it("reports the step, the command, the status and a hint", () => {
    const stderr = fakeStream(false);
    const ui = createUi({ stdout: fakeStream(false), stderr });

    ui.progress.plan(6);
    ui.progress.step("Build Gradle (assembleDebug)");
    ui.failure(
      commandError({
        stderr: ["FAILURE: Build failed with an exception.", "> SDK location not found."].join("\n"),
      }),
    );

    const text = stderr.text();
    expect(text).toContain("Build échoué");
    expect(text).toContain("Build Gradle (assembleDebug)");
    expect(text).toContain("./gradlew");
    expect(text).toContain("code 1");
    expect(text).toContain("> SDK location not found.");
    expect(text).toContain("SDK Android est introuvable");
    expect(text).toContain("--verbose");
  });

  it("dumps the whole output in verbose mode and drops the --verbose hint", () => {
    const stderr = fakeStream(false);
    const ui = createUi({ verbose: true, stdout: fakeStream(false), stderr });

    ui.failure(
      commandError({
        stderr: ["> Task :app:preBuild UP-TO-DATE", "FAILURE: Build failed."].join("\n"),
      }),
    );

    const text = stderr.text();
    // The line a non-verbose report would have filtered out.
    expect(text).toContain("UP-TO-DATE");
    expect(text).not.toContain("relancez avec --verbose");
  });

  it("prints a plain message for an ordinary error", () => {
    const stderr = fakeStream(false);
    const ui = createUi({ stdout: fakeStream(false), stderr });

    ui.failure(new Error("Keystore introuvable : /tmp/absente.jks"));

    expect(stderr.text()).toContain("Keystore introuvable : /tmp/absente.jks");
    expect(stderr.text()).not.toContain("── sortie de l'outil ──");
  });

  it("handles a thrown non-error", () => {
    const stderr = fakeStream(false);
    createUi({ stdout: fakeStream(false), stderr }).failure("oups");

    expect(stderr.text()).toContain("oups");
  });
});
