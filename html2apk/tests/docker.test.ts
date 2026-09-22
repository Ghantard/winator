import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertDockerAvailable,
  buildInDocker,
  CONTAINER_OUT,
  CONTAINER_SRC,
  DEFAULT_IMAGE,
  dockerRunArgs,
  ensureImage,
  IN_CONTAINER_ENV,
  isInsideContainer,
  projectRoot,
} from "../src/utils/docker";
import type { CommandRunner, Logger } from "../src/utils";

const temps: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-docker-"));
  temps.push(dir);
  return dir;
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface Call {
  command: string;
  args: readonly string[];
}

/**
 * A docker stub. `fail` lists argument prefixes that should reject, and
 * `writeApkFor` makes a `docker run` write the APK its --output names.
 */
function fakeDocker(options: { fail?: string[]; writeApkFor?: string } = {}): {
  run: CommandRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    const signature = args.join(" ");
    for (const prefix of options.fail ?? []) {
      if (signature.startsWith(prefix)) {
        throw new Error(`La commande « docker ${prefix} » a échoué (code 1).`);
      }
    }
    if (args[0] === "run" && options.writeApkFor !== undefined) {
      mkdirSync(dirname(options.writeApkFor), { recursive: true });
      writeFileSync(options.writeApkFor, "PK\u0003\u0004fake-apk");
    }
    return { stdout: "", stderr: "" };
  };
  return { run, calls };
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

describe("isInsideContainer", () => {
  it("reads the image env marker", () => {
    expect(isInsideContainer({ [IN_CONTAINER_ENV]: "1" })).toBe(true);
    expect(isInsideContainer({ [IN_CONTAINER_ENV]: "0" })).toBe(false);
    expect(isInsideContainer({})).toBe(false);
  });
});

describe("assertDockerAvailable", () => {
  it("probes the CLI then the daemon", async () => {
    const { run, calls } = fakeDocker();

    await assertDockerAvailable({ run });

    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "--version",
      "info --format {{.ServerVersion}}",
    ]);
  });

  it("explains in French when the CLI is missing", async () => {
    const { run } = fakeDocker({ fail: ["--version"] });

    await expect(assertDockerAvailable({ run })).rejects.toThrow(
      /^Docker est introuvable : installez Docker, ou relancez la commande avec --no-docker/,
    );
  });

  it("explains in French when the daemon is down", async () => {
    const { run } = fakeDocker({ fail: ["info"] });

    await expect(assertDockerAvailable({ run })).rejects.toThrow(
      /^Le démon Docker ne répond pas/,
    );
  });
});

describe("dockerRunArgs", () => {
  it("mounts a folder source read-only and rewrites the paths", () => {
    const args = dockerRunArgs({
      source: { type: "folder", path: "/srv/site" },
      output: "/home/me/apks/app.apk",
      image: DEFAULT_IMAGE,
      user: "1000:1000",
    });

    expect(args).toEqual([
      "run",
      "--rm",
      "--user",
      "1000:1000",
      "-v",
      `/home/me/apks:${CONTAINER_OUT}`,
      "-v",
      `/srv/site:${CONTAINER_SRC}:ro`,
      DEFAULT_IMAGE,
      "build",
      CONTAINER_SRC,
      "--output",
      `${CONTAINER_OUT}/app.apk`,
      "--no-docker",
    ]);
  });

  it("passes a URL source through without mounting it", () => {
    const args = dockerRunArgs({
      source: { type: "url", path: "https://example.com/" },
      output: "/tmp/out/site.apk",
      image: "html2apk:ci",
    });

    expect(args).not.toContain(CONTAINER_SRC);
    expect(args.filter((arg) => arg === "-v")).toHaveLength(1);
    expect(args.slice(args.indexOf("html2apk:ci"))).toEqual([
      "html2apk:ci",
      "build",
      "https://example.com/",
      "--output",
      `${CONTAINER_OUT}/site.apk`,
      "--no-docker",
    ]);
  });

  it("always disables Docker inside the container, to avoid recursion", () => {
    const args = dockerRunArgs({
      source: { type: "url", path: "https://example.com/" },
      output: "/tmp/out/a.apk",
      image: DEFAULT_IMAGE,
    });

    expect(args).toContain("--no-docker");
  });

  it("forwards the app options and the log level", () => {
    const args = dockerRunArgs({
      source: { type: "folder", path: "/srv/site" },
      output: "/tmp/out/a.apk",
      image: DEFAULT_IMAGE,
      appId: "fr.exemple.app",
      appName: "Mon Site",
      logLevel: "debug",
    });

    expect(args.join(" ")).toContain("--app-id fr.exemple.app");
    expect(args.join(" ")).toContain("--app-name Mon Site");
    expect(args.join(" ")).toContain("--log-level debug");
  });

  it("omits --user when none is given", () => {
    const args = dockerRunArgs({
      source: { type: "url", path: "https://example.com/" },
      output: "/tmp/out/a.apk",
      image: DEFAULT_IMAGE,
    });

    expect(args).not.toContain("--user");
  });
});

describe("ensureImage", () => {
  it("does nothing when the image is already there", async () => {
    const { run, calls } = fakeDocker();

    await ensureImage(DEFAULT_IMAGE, { run, logger: silentLogger });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["image", "inspect", DEFAULT_IMAGE]);
  });

  it("builds the image from the project Dockerfile when missing", async () => {
    const { run, calls } = fakeDocker({ fail: ["image inspect"] });

    await ensureImage(DEFAULT_IMAGE, { run, logger: silentLogger });

    expect(calls[1]?.args).toEqual(["build", "-t", DEFAULT_IMAGE, "."]);
  });

  it("fails clearly when no Dockerfile can be found", async () => {
    const { run } = fakeDocker({ fail: ["image inspect"] });

    await expect(
      ensureImage(DEFAULT_IMAGE, { run, logger: silentLogger, context: makeDir() }),
    ).rejects.toThrow(/absente et aucun Dockerfile trouvé/);
  });
});

describe("projectRoot", () => {
  it("points at the directory holding the Dockerfile", () => {
    expect(existsSync(join(projectRoot(), "Dockerfile"))).toBe(true);
  });
});

describe("buildInDocker", () => {
  it("runs the container and returns the retrieved APK", async () => {
    const output = join(makeDir(), "nested", "app.apk");
    const { run, calls } = fakeDocker({ writeApkFor: output });

    const result = await buildInDocker({
      source: { type: "folder", path: makeDir() },
      output,
      run,
      logger: silentLogger,
    });

    expect(result).toEqual({ apkPath: output, image: DEFAULT_IMAGE });
    expect(existsSync(output)).toBe(true);
    expect(calls.map((call) => call.args[0])).toEqual(["--version", "info", "image", "run"]);
  });

  it("creates the output directory before mounting it", async () => {
    const output = join(makeDir(), "deep", "tree", "app.apk");
    const { run } = fakeDocker({ writeApkFor: output });

    await buildInDocker({
      source: { type: "url", path: "https://example.com/" },
      output,
      run,
      logger: silentLogger,
    });

    expect(existsSync(dirname(output))).toBe(true);
  });

  it("honours a custom image and skips the auto-build", async () => {
    const output = join(makeDir(), "app.apk");
    const { run, calls } = fakeDocker({ writeApkFor: output });

    const result = await buildInDocker({
      source: { type: "url", path: "https://example.com/" },
      output,
      image: "html2apk:ci",
      autoBuild: false,
      run,
      logger: silentLogger,
    });

    expect(result.image).toBe("html2apk:ci");
    expect(calls.map((call) => call.args[0])).toEqual(["--version", "info", "run"]);
  });

  it("fails when the container exits cleanly but produced no APK", async () => {
    const output = join(makeDir(), "app.apk");
    const { run } = fakeDocker();

    await expect(
      buildInDocker({
        source: { type: "url", path: "https://example.com/" },
        output,
        run,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/aucun APK n'a été récupéré/);
  });

  it("surfaces the Docker availability error before running anything", async () => {
    const { run, calls } = fakeDocker({ fail: ["info"] });

    await expect(
      buildInDocker({
        source: { type: "url", path: "https://example.com/" },
        output: join(makeDir(), "app.apk"),
        run,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/^Le démon Docker ne répond pas/);
    expect(calls.map((call) => call.args[0])).toEqual(["--version", "info"]);
  });
});
