import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cliPath,
  detectMode,
  E2E_TIMEOUT_MS,
  MIN_APK_BYTES,
  projectRoot,
  skippingIsAnError,
} from "./environment";
import type { E2eMode } from "./environment";

const mode: E2eMode = detectMode();
const canBuild = mode.kind !== "unavailable";

// Checked at collection time, not in beforeAll: a skipped suite never runs its
// hooks, so the warning and the CI guard below would never fire from there.
if (!canBuild) {
  const reason = mode.kind === "unavailable" ? mode.reason : "";
  if (skippingIsAnError()) {
    throw new Error(`Tests e2e requis (HTML2APK_E2E_REQUIRE=1) mais ${reason}`);
  }
  // Loud on purpose: a silently skipped e2e suite looks like a passing one.
  console.warn(`\n[e2e] SUITE IGNORÉE — ${reason}\n`);
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the compiled CLI exactly as a user would, and capture everything. */
async function runCli(args: readonly string[]): Promise<CliResult> {
  const extra = mode.kind === "local" ? ["--no-docker"] : [];
  return await new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const child = spawn("node", [cliPath(), ...args, ...extra], {
      cwd: projectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

/** Everything the run printed, for a useful message when an assertion fails. */
function report(result: CliResult): string {
  return `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "html2apk-e2e-"));
});

afterAll(() => {
  if (workspace !== undefined) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe.skipIf(!canBuild)(`html2apk build (mode ${mode.kind})`, () => {
  it(
    "builds an APK larger than 1 MB from a minimal HTML folder",
    async () => {
      const site = join(workspace, "hello-site");
      mkdirSync(site, { recursive: true });
      writeFileSync(
        join(site, "index.html"),
        "<!doctype html>\n<html lang=\"fr\">\n<head><meta charset=\"utf-8\"><title>Hello</title></head>\n<body><h1>Hello World</h1></body>\n</html>\n",
      );

      const output = join(workspace, "hello.apk");
      const result = await runCli(["build", site, "--output", output]);

      expect(result.code, `le build a échoué${report(result)}`).toBe(0);

      const size = statSync(output).size;
      expect(size, `APK trop petit : ${size} octets`).toBeGreaterThan(MIN_APK_BYTES);

      // The final report is part of what the user is promised.
      expect(result.stdout).toContain("Build terminé");
      expect(result.stdout).toContain(output);
    },
    E2E_TIMEOUT_MS,
  );

  // Needs outbound access to example.com: detectSource probes the URL before
  // the build starts, so a restricted network fails this early.
  it(
    "builds an APK larger than 1 MB from a public URL",
    async () => {
      const output = join(workspace, "example.apk");
      const result = await runCli([
        "build",
        "https://example.com",
        "--output",
        output,
        "--app-name",
        "Example",
      ]);

      expect(result.code, `le build depuis une URL a échoué${report(result)}`).toBe(0);

      const size = statSync(output).size;
      expect(size, `APK trop petit : ${size} octets`).toBeGreaterThan(MIN_APK_BYTES);
    },
    E2E_TIMEOUT_MS,
  );
});
