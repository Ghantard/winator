import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFromFolder,
  FOLDER_BUILD_STEPS,
  createCapacitorConfig,
  DEBUG_APK_PATH,
  DEFAULT_APP_ID,
  defaultAppName,
  folderBuilder,
  normalizeAppId,
  normalizeAppName,
} from "../src/builders/folder-builder";
import type { CommandRunner, Logger } from "../src/utils";

const temps: string[] = [];

function makeSite(files: Record<string, string> = { "index.html": "<!doctype html>" }): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-src-"));
  temps.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function outputPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-out-"));
  temps.push(dir);
  return join(dir, "nested", "app.apk");
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
  cwd: string;
}

/**
 * A runner that records invocations and, on the Gradle step, writes a fake APK
 * where the real build would have put one.
 */
function fakeRunner(overrides: { failOn?: string; writeApk?: boolean } = {}): {
  run: CommandRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (overrides.failOn !== undefined && command.includes(overrides.failOn)) {
      throw new Error(`La commande « ${command} » a échoué (code 1).`);
    }
    if (args[0] === "assembleDebug" && overrides.writeApk !== false) {
      // options.cwd is <project>/android, so walk back up to the project root.
      const apk = join(dirname(options.cwd), DEBUG_APK_PATH);
      mkdirSync(dirname(apk), { recursive: true });
      writeFileSync(apk, "PK\u0003\u0004fake-apk");
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

describe("normalizeAppId", () => {
  it("defaults to com.html2apk.app", () => {
    expect(normalizeAppId()).toBe(DEFAULT_APP_ID);
    expect(DEFAULT_APP_ID).toBe("com.html2apk.app");
  });

  it.each(["com.exemple.monapp", "fr.site.web_app", "a.b"])("accepts %s", (id) => {
    expect(normalizeAppId(id)).toBe(id);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeAppId("  com.exemple.app  ")).toBe("com.exemple.app");
  });

  it.each(["monapp", "com..app", "1com.exemple", "com.exemple.", "com.mon-app", "com.é.app"])(
    "rejects %j with a French message",
    (id) => {
      expect(() => normalizeAppId(id)).toThrow(/^Identifiant d'application invalide/);
    },
  );
});

describe("normalizeAppName / defaultAppName", () => {
  it("keeps a trimmed name", () => {
    expect(normalizeAppName("  Mon Site  ")).toBe("Mon Site");
  });

  it("rejects an empty name in French", () => {
    expect(() => normalizeAppName("   ")).toThrow(
      "Nom d'application vide : indiquez un nom avec --app-name.",
    );
  });

  it("derives the name from the folder, ignoring a trailing separator", () => {
    expect(defaultAppName("/srv/sites/mon-site")).toBe("mon-site");
    expect(defaultAppName("/srv/sites/mon-site/")).toBe("mon-site");
  });
});

describe("createCapacitorConfig", () => {
  it("produces the default Capacitor config", () => {
    expect(createCapacitorConfig(DEFAULT_APP_ID, "Mon Site")).toEqual({
      appId: "com.html2apk.app",
      appName: "Mon Site",
      webDir: "www",
      android: { allowMixedContent: true },
    });
  });

  it("validates its inputs", () => {
    expect(() => createCapacitorConfig("nope", "Mon Site")).toThrow(
      /Identifiant d'application invalide/,
    );
  });
});

describe("buildFromFolder", () => {
  it("scaffolds the project, runs the toolchain and copies the APK", async () => {
    const site = makeSite({ "index.html": "<!doctype html>", "assets/app.js": "console.log(1)" });
    const output = outputPath();
    const { run, calls } = fakeRunner();

    const result = await buildFromFolder(site, output, {
      run,
      logger: silentLogger,
      keepProject: true,
    });

    expect(result.apkPath).toBe(output);
    expect(readFileSync(output, "utf8")).toContain("fake-apk");

    // The folder contents land in www/, not in a www/<folder-name>/ subdirectory.
    expect(existsSync(join(result.projectPath, "www", "index.html"))).toBe(true);
    expect(existsSync(join(result.projectPath, "www", "assets", "app.js"))).toBe(true);

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({ appId: DEFAULT_APP_ID, webDir: "www" });

    const pkg = JSON.parse(readFileSync(join(result.projectPath, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@capacitor/core"]).toBeDefined();
    expect(pkg.dependencies["@capacitor/android"]).toBeDefined();
    expect(pkg.devDependencies["@capacitor/cli"]).toBeDefined();

    expect(calls.map((call) => `${call.command} ${call.args.join(" ")}`)).toEqual([
      "npm install --no-audit --no-fund",
      "npx cap add android",
      "npx cap sync android",
      "./gradlew assembleDebug",
    ]);
    // Gradle runs inside the generated android/ project.
    expect(calls[3]?.cwd).toBe(join(result.projectPath, "android"));

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("reports exactly FOLDER_BUILD_STEPS steps, so the bar cannot drift", async () => {
    const site = makeSite();
    const { run } = fakeRunner();
    const steps: string[] = [];

    await buildFromFolder(site, outputPath(), {
      run,
      logger: silentLogger,
      progress: {
        plan: () => undefined,
        step: (label) => steps.push(label),
        clear: () => undefined,
        stop: () => undefined,
      },
    });

    expect(steps).toHaveLength(FOLDER_BUILD_STEPS);
    expect(steps[0]).toMatch(/^Préparation du projet Capacitor/);
    expect(steps.at(-1)).toMatch(/^Build Gradle/);
  });

  it("uses the folder name as the default app name", async () => {
    const site = makeSite();
    const { run } = fakeRunner();

    const result = await buildFromFolder(site, outputPath(), {
      run,
      logger: silentLogger,
      keepProject: true,
    });

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as { appName: string };
    expect(config.appName).toBe(defaultAppName(site));

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("honours --app-id and --app-name overrides", async () => {
    const site = makeSite();
    const { run } = fakeRunner();

    const result = await buildFromFolder(site, outputPath(), {
      run,
      logger: silentLogger,
      keepProject: true,
      appId: "fr.exemple.boutique",
      appName: "Ma Boutique",
    });

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as { appId: string; appName: string };
    expect(config).toMatchObject({ appId: "fr.exemple.boutique", appName: "Ma Boutique" });

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("creates missing parent directories of the output path", async () => {
    const site = makeSite();
    const output = outputPath();
    const { run } = fakeRunner();

    await buildFromFolder(site, output, { run, logger: silentLogger });

    expect(existsSync(output)).toBe(true);
  });

  it("removes the temporary project on success", async () => {
    const site = makeSite();
    const { run } = fakeRunner();

    const result = await buildFromFolder(site, outputPath(), { run, logger: silentLogger });

    expect(result.kept).toBe(false);
    expect(existsSync(result.projectPath)).toBe(false);
  });

  it("rejects a folder without an index.html before running anything", async () => {
    const site = makeSite({ "page.html": "<!doctype html>" });
    const { run, calls } = fakeRunner();

    await expect(
      buildFromFolder(site, outputPath(), { run, logger: silentLogger }),
    ).rejects.toThrow(/^Aucun fichier index\.html trouvé/);
    expect(calls).toEqual([]);
  });

  it("rejects an invalid app id before running anything", async () => {
    const site = makeSite();
    const { run, calls } = fakeRunner();

    await expect(
      buildFromFolder(site, outputPath(), { run, logger: silentLogger, appId: "monapp" }),
    ).rejects.toThrow(/^Identifiant d'application invalide/);
    expect(calls).toEqual([]);
  });

  it("propagates a Gradle failure and keeps the project for inspection", async () => {
    const site = makeSite();
    const kept: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn: (message) => {
        const match = /: (.+)$/.exec(message);
        if (match?.[1] !== undefined) {
          kept.push(match[1]);
        }
      },
    };
    const { run } = fakeRunner({ failOn: "gradlew" });

    await expect(buildFromFolder(site, outputPath(), { run, logger })).rejects.toThrow(
      /gradlew/,
    );
    expect(kept).toHaveLength(1);
    expect(existsSync(kept[0] as string)).toBe(true);

    rmSync(kept[0] as string, { recursive: true, force: true });
  });

  it("fails clearly when the build produced no APK", async () => {
    const site = makeSite();
    const { run } = fakeRunner({ writeApk: false });

    await expect(
      buildFromFolder(site, outputPath(), { run, logger: silentLogger }),
    ).rejects.toThrow(/^Build terminé mais aucun APK trouvé/);
  });
});

describe("folderBuilder", () => {
  it("refuses a URL source", async () => {
    await expect(
      folderBuilder.build({
        source: { type: "url", path: "https://example.com/" },
        output: outputPath(),
        logger: silentLogger,
      }),
    ).rejects.toThrow("folderBuilder ne gère pas une source de type « url ».");
  });

  it("forwards --app-id through to the validation", async () => {
    const site = makeSite();

    // An invalid id makes buildFromFolder throw before any command is spawned,
    // which proves the option reached it.
    await expect(
      folderBuilder.build({
        source: { type: "folder", path: site },
        output: outputPath(),
        logger: silentLogger,
        appId: "monapp",
      }),
    ).rejects.toThrow(/^Identifiant d'application invalide « monapp »/);
  });

  it("is registered under the folder name", () => {
    expect(folderBuilder.name).toBe("folder");
  });
});
