import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** How the e2e build should be run, or why it cannot be. */
export type E2eMode =
  | { kind: "docker" }
  | { kind: "local" }
  | { kind: "unavailable"; reason: string };

/** Anything under 1 MB is not a real APK with a WebView runtime inside. */
export const MIN_APK_BYTES = 1024 * 1024;
/** A full Capacitor + Gradle build, cold, takes minutes. */
export const E2E_TIMEOUT_MS = 300_000;

export function projectRoot(): string {
  return resolve(__dirname, "..", "..");
}

export function cliPath(): string {
  return join(projectRoot(), "dist", "cli.js");
}

function dockerUsable(): boolean {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: "ignore",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function localToolchain(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  const sdk = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];
  if (sdk === undefined || !existsSync(sdk)) {
    missing.push("le SDK Android (ANDROID_HOME)");
  } else {
    const buildTools = join(sdk, "build-tools");
    const hasBuildTools =
      existsSync(buildTools) &&
      readdirSync(buildTools).some((version) => existsSync(join(buildTools, version, "apksigner")));
    if (!hasBuildTools) {
      missing.push("les build-tools du SDK Android");
    }
  }

  try {
    execFileSync("javac", ["-version"], { stdio: "ignore", timeout: 30_000 });
  } catch {
    missing.push("un JDK (javac)");
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Decide how to run the e2e builds: through Docker when its daemon answers
 * (the CLI's own default), otherwise with a local toolchain, otherwise not at
 * all. A missing toolchain makes the suite skip rather than fail, but
 * HTML2APK_E2E_REQUIRE=1 turns that into an error so CI cannot go green
 * without ever having built an APK.
 */
export function detectMode(): E2eMode {
  if (!existsSync(cliPath())) {
    return {
      kind: "unavailable",
      reason: `${cliPath()} est absent : lancez « npm run build » avant les tests e2e.`,
    };
  }
  if (dockerUsable()) {
    return { kind: "docker" };
  }
  const local = localToolchain();
  if (local.ok) {
    return { kind: "local" };
  }
  return {
    kind: "unavailable",
    reason:
      "aucun environnement de build disponible : le démon Docker ne répond pas et " +
      `il manque ${local.missing.join(", ")} en local.`,
  };
}

/** True when the suite must fail instead of skipping (set this in CI). */
export function skippingIsAnError(): boolean {
  return process.env["HTML2APK_E2E_REQUIRE"] === "1";
}
