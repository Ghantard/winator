import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEBUG_KEY_ALIAS,
  DEBUG_KEYSTORE_PASSWORD,
  DEBUG_KEYSTORE_PATH,
  ensureKeystore,
  findApksigner,
  findTool,
  PASSWORD_ENV,
  PASSWORD_INPUT_ENV,
  resolveSigningConfig,
  signApk,
} from "../src/utils/sign";
import type { SigningConfig } from "../src/utils/sign";
import type { CommandRunner, Logger, RunOptions } from "../src/utils";

const temps: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-sign-"));
  temps.push(dir);
  return dir;
}

function makeApk(): string {
  const apk = join(makeDir(), "app.apk");
  writeFileSync(apk, "PK\u0003\u0004fake-apk");
  return apk;
}

/** A directory laid out like an Android SDK, with fake build-tools binaries. */
function makeSdk(versions: string[]): string {
  const sdk = makeDir();
  for (const version of versions) {
    const dir = join(sdk, "build-tools", version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "apksigner"), "#!/bin/sh\n");
    chmodSync(join(dir, "apksigner"), 0o755);
  }
  return sdk;
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
  options: RunOptions;
}

function fakeRunner(): { run: CommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: "", stderr: "" };
  };
  return { run, calls };
}

/** A PATH with a single fake executable on it. */
function pathWith(name: string): { env: NodeJS.ProcessEnv; binary: string } {
  const dir = makeDir();
  const binary = join(dir, name);
  writeFileSync(binary, "#!/bin/sh\n");
  chmodSync(binary, 0o755);
  return { env: { PATH: dir }, binary };
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

describe("resolveSigningConfig", () => {
  it("defaults to the managed debug keystore", () => {
    expect(resolveSigningConfig({ env: {} })).toEqual({
      keystore: DEBUG_KEYSTORE_PATH,
      password: DEBUG_KEYSTORE_PASSWORD,
      alias: DEBUG_KEY_ALIAS,
      isDebug: true,
    });
  });

  it("stores the debug keystore under ~/.html2apk", () => {
    expect(DEBUG_KEYSTORE_PATH.endsWith(join(".html2apk", "debug.keystore"))).toBe(true);
  });

  it("accepts a custom keystore with an alias and a password", () => {
    const config = resolveSigningConfig({
      keystore: "/keys/release.jks",
      alias: "release",
      password: "s3cret",
      env: {},
    });

    expect(config).toEqual({
      keystore: "/keys/release.jks",
      password: "s3cret",
      alias: "release",
      isDebug: false,
    });
  });

  it("reads the password from the environment when the option is absent", () => {
    const config = resolveSigningConfig({
      keystore: "/keys/release.jks",
      alias: "release",
      env: { [PASSWORD_INPUT_ENV]: "from-env" },
    });

    expect(config.password).toBe("from-env");
  });

  it("requires an alias for a custom keystore", () => {
    expect(() =>
      resolveSigningConfig({ keystore: "/keys/release.jks", password: "x", env: {} }),
    ).toThrow("Alias de clé manquant : précisez --key-alias lorsque vous fournissez --keystore.");
  });

  it("requires a password for a custom keystore", () => {
    expect(() =>
      resolveSigningConfig({ keystore: "/keys/release.jks", alias: "release", env: {} }),
    ).toThrow(/^Mot de passe de keystore manquant/);
  });

  it("lets an explicit alias override the debug default", () => {
    expect(resolveSigningConfig({ alias: "autre", env: {} }).alias).toBe("autre");
  });
});

describe("ensureKeystore", () => {
  it("generates the debug keystore with keytool when it is missing", async () => {
    const dir = makeDir();
    const keystore = join(dir, "debug.keystore");
    const { env, binary } = pathWith("keytool");
    const { run, calls } = fakeRunner();
    const config: SigningConfig = {
      keystore,
      password: DEBUG_KEYSTORE_PASSWORD,
      alias: DEBUG_KEY_ALIAS,
      isDebug: true,
    };

    // keytool is faked, so create the file it would have produced.
    const runAndCreate: CommandRunner = async (command, args, options) => {
      writeFileSync(keystore, "keystore");
      return await run(command, args, options);
    };

    const created = await ensureKeystore(config, {
      run: runAndCreate,
      logger: silentLogger,
      env,
    });

    expect(created).toBe(true);
    expect(calls[0]?.command).toBe(binary);
    const args = calls[0]?.args.join(" ") ?? "";
    expect(args).toContain("-genkeypair");
    expect(args).toContain(`-alias ${DEBUG_KEY_ALIAS}`);
    expect(args).toContain("-keyalg RSA");
    expect(args).toContain("-keysize 2048");
    expect(args).toContain("-noprompt");
    // The private key file must not be world-readable.
    expect(statSync(keystore).mode & 0o077).toBe(0);
  });

  it("does nothing when the keystore already exists", async () => {
    const keystore = join(makeDir(), "debug.keystore");
    writeFileSync(keystore, "keystore");
    const { run, calls } = fakeRunner();

    const created = await ensureKeystore(
      { keystore, password: "android", alias: DEBUG_KEY_ALIAS, isDebug: true },
      { run, logger: silentLogger },
    );

    expect(created).toBe(false);
    expect(calls).toEqual([]);
  });

  it("never invents a missing custom keystore", async () => {
    const keystore = join(makeDir(), "release.jks");
    const { run, calls } = fakeRunner();

    await expect(
      ensureKeystore(
        { keystore, password: "x", alias: "release", isDebug: false },
        { run, logger: silentLogger },
      ),
    ).rejects.toThrow(`Keystore introuvable : ${keystore}`);
    expect(calls).toEqual([]);
  });
});

describe("signApk", () => {
  it("checks the keystore before touching apksigner for a missing custom one", async () => {
    const apk = makeApk();
    const keystore = join(makeDir(), "absente.jks");
    const { env } = pathWith("apksigner");
    const { run, calls } = fakeRunner();

    await expect(
      signApk(
        apk,
        { keystore, password: "x", alias: "release", isDebug: false },
        { run, logger: silentLogger, env },
      ),
    ).rejects.toThrow(`Keystore introuvable : ${keystore}`);
    expect(calls).toEqual([]);
  });

  it("signs then verifies, passing the password through the environment", async () => {
    const apk = makeApk();
    const keystore = join(makeDir(), "debug.keystore");
    writeFileSync(keystore, "keystore");
    const { env, binary } = pathWith("apksigner");
    const { run, calls } = fakeRunner();

    await signApk(
      apk,
      { keystore, password: "s3cret", alias: "release", isDebug: false },
      { run, logger: silentLogger, env },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe(binary);
    expect(calls[0]?.args).toEqual([
      "sign",
      "--ks", keystore,
      "--ks-key-alias", "release",
      "--ks-pass", `env:${PASSWORD_ENV}`,
      "--key-pass", `env:${PASSWORD_ENV}`,
      apk,
    ]);
    // The secret travels in the environment, never in argv.
    expect(calls[0]?.args.join(" ")).not.toContain("s3cret");
    expect(calls[0]?.options.env).toEqual({ [PASSWORD_ENV]: "s3cret" });
    expect(calls[1]?.args).toEqual(["verify", apk]);
  });

  it("generates the debug keystore on the way if needed", async () => {
    const apk = makeApk();
    const keystore = join(makeDir(), "debug.keystore");
    const dir = makeDir();
    for (const name of ["apksigner", "keytool"]) {
      writeFileSync(join(dir, name), "#!/bin/sh\n");
      chmodSync(join(dir, name), 0o755);
    }
    const { run, calls } = fakeRunner();
    const runAndCreate: CommandRunner = async (command, args, options) => {
      if (args[0] === "-genkeypair") {
        writeFileSync(keystore, "keystore");
      }
      return await run(command, args, options);
    };

    await signApk(
      apk,
      { keystore, password: "android", alias: DEBUG_KEY_ALIAS, isDebug: true },
      { run: runAndCreate, logger: silentLogger, env: { PATH: dir } },
    );

    expect(calls.map((call) => call.args[0])).toEqual(["-genkeypair", "sign", "verify"]);
  });

  it("refuses to sign a missing APK", async () => {
    const missing = join(makeDir(), "absent.apk");
    const { run } = fakeRunner();

    await expect(
      signApk(
        missing,
        { keystore: "/k.jks", password: "x", alias: "a", isDebug: false },
        { run, logger: silentLogger },
      ),
    ).rejects.toThrow(`APK introuvable, impossible de le signer : ${missing}`);
  });
});

describe("findApksigner", () => {
  it("prefers apksigner on the PATH", () => {
    const { env, binary } = pathWith("apksigner");

    expect(findApksigner(env)).toBe(binary);
  });

  it("falls back to the highest build-tools under ANDROID_HOME", () => {
    const sdk = makeSdk(["33.0.1", "36.0.0", "34.0.0"]);

    expect(findApksigner({ PATH: makeDir(), ANDROID_HOME: sdk })).toBe(
      join(sdk, "build-tools", "36.0.0", "apksigner"),
    );
  });

  it("also honours ANDROID_SDK_ROOT", () => {
    const sdk = makeSdk(["35.0.0"]);

    expect(findApksigner({ PATH: makeDir(), ANDROID_SDK_ROOT: sdk })).toBe(
      join(sdk, "build-tools", "35.0.0", "apksigner"),
    );
  });

  it("explains in French when it cannot be found", () => {
    expect(() => findApksigner({ PATH: makeDir() })).toThrow(/^apksigner introuvable/);
  });
});

describe("findTool", () => {
  it("finds a tool on the PATH", () => {
    const { env, binary } = pathWith("keytool");

    expect(findTool("keytool", env)).toBe(binary);
  });

  it("falls back to JAVA_HOME/bin", () => {
    const javaHome = makeDir();
    mkdirSync(join(javaHome, "bin"));
    const keytool = join(javaHome, "bin", "keytool");
    writeFileSync(keytool, "#!/bin/sh\n");

    expect(findTool("keytool", { PATH: makeDir(), JAVA_HOME: javaHome })).toBe(keytool);
  });

  it("explains in French when it cannot be found", () => {
    expect(() => findTool("keytool", { PATH: makeDir() })).toThrow(
      /^keytool introuvable : installez un JDK/,
    );
  });

  it("does not blow up when PATH is unset", () => {
    expect(() => findTool("keytool", {})).toThrow(/^keytool introuvable/);
    expect(existsSync("/nonexistent-sentinel")).toBe(false);
  });
});
