import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEBUG_APK_PATH, DEFAULT_APP_ID } from "../src/builders/capacitor";
import {
  buildFromUrl,
  defaultAppName,
  normalizeUrl,
  offlinePage,
  URL_BUILD_STEPS,
  urlBuilder,
} from "../src/builders/url-builder";
import type { CommandRunner, Logger } from "../src/utils";

const temps: string[] = [];

function outputPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-url-"));
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

function fakeRunner(): { run: CommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === "assembleDebug") {
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

describe("normalizeUrl", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["  https://example.com/app  ", "https://example.com/app"],
    ["http://192.168.1.10:8080/", "http://192.168.1.10:8080/"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("rejects a non-http protocol", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(
      "Protocole non supporté « ftp » : seuls http et https sont acceptés.",
    );
  });

  it("rejects something that is not a URL", () => {
    expect(() => normalizeUrl("pas une url")).toThrow("URL invalide : pas une url");
  });
});

describe("defaultAppName", () => {
  it.each([
    ["https://example.com/", "example.com"],
    ["https://www.example.com/", "example.com"],
    ["https://shop.example.co.uk/page", "shop.example.co.uk"],
  ])("derives %j into %j", (url, expected) => {
    expect(defaultAppName(url)).toBe(expected);
  });
});

describe("offlinePage", () => {
  it("is self-contained: no external stylesheet, script or font", () => {
    const page = offlinePage("https://example.com/");

    expect(page).not.toMatch(/<link[^>]+href="http/);
    expect(page).not.toMatch(/<script[^>]+src=/);
    expect(page).toContain("Connexion indisponible");
  });

  it("escapes the URL it embeds", () => {
    const page = offlinePage("https://example.com/?a=1&b=\"x\"");

    expect(page).toContain("&amp;");
    expect(page).toContain("&quot;");
    expect(page).not.toContain('="x"</code>');
  });
});

describe("buildFromUrl", () => {
  it("points the WebView at the URL and ships an offline fallback", async () => {
    const output = outputPath();
    const { run, calls } = fakeRunner();

    const result = await buildFromUrl("https://example.com", output, {
      run,
      logger: silentLogger,
      keepProject: true,
    });

    expect(result.apkPath).toBe(output);
    expect(readFileSync(output, "utf8")).toContain("fake-apk");

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      appId: DEFAULT_APP_ID,
      appName: "example.com",
      webDir: "www",
      server: { url: "https://example.com/", cleartext: false, androidScheme: "https" },
    });

    // www/ still needs a page: it is what shows when the device is offline.
    const fallback = readFileSync(join(result.projectPath, "www", "index.html"), "utf8");
    expect(fallback).toContain("Connexion indisponible");

    expect(calls.map((call) => `${call.command} ${call.args.join(" ")}`)).toEqual([
      "npm install --no-audit --no-fund",
      "npx cap add android",
      "npx cap sync android",
      "./gradlew assembleDebug",
    ]);

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("enables cleartext only for an http:// site", async () => {
    const { run } = fakeRunner();

    const result = await buildFromUrl("http://192.168.1.10:8080", outputPath(), {
      run,
      logger: silentLogger,
      keepProject: true,
    });

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as { server: { cleartext: boolean } };
    expect(config.server.cleartext).toBe(true);

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("honours --app-id and --app-name", async () => {
    const { run } = fakeRunner();

    const result = await buildFromUrl("https://example.com", outputPath(), {
      run,
      logger: silentLogger,
      keepProject: true,
      appId: "fr.exemple.site",
      appName: "Mon Site",
    });

    const config = JSON.parse(
      readFileSync(join(result.projectPath, "capacitor.config.json"), "utf8"),
    ) as { appId: string; appName: string };
    expect(config).toMatchObject({ appId: "fr.exemple.site", appName: "Mon Site" });

    rmSync(result.projectPath, { recursive: true, force: true });
  });

  it("reports exactly URL_BUILD_STEPS steps", async () => {
    const { run } = fakeRunner();
    const steps: string[] = [];

    await buildFromUrl("https://example.com", outputPath(), {
      run,
      logger: silentLogger,
      progress: {
        plan: () => undefined,
        step: (label) => steps.push(label),
        clear: () => undefined,
        stop: () => undefined,
      },
    });

    expect(steps).toHaveLength(URL_BUILD_STEPS);
    expect(steps[1]).toMatch(/page de secours/);
  });

  it("removes the temporary project on success", async () => {
    const { run } = fakeRunner();

    const result = await buildFromUrl("https://example.com", outputPath(), {
      run,
      logger: silentLogger,
    });

    expect(result.kept).toBe(false);
    expect(existsSync(result.projectPath)).toBe(false);
  });

  it("rejects a bad URL before running anything", async () => {
    const { run, calls } = fakeRunner();

    await expect(
      buildFromUrl("ftp://example.com", outputPath(), { run, logger: silentLogger }),
    ).rejects.toThrow(/^Protocole non supporté/);
    expect(calls).toEqual([]);
  });
});

describe("urlBuilder", () => {
  it("is registered under the url name", () => {
    expect(urlBuilder.name).toBe("url");
  });

  it("refuses a folder source", async () => {
    await expect(
      urlBuilder.build({
        source: { type: "folder", path: "/srv/site" },
        output: outputPath(),
        logger: silentLogger,
      }),
    ).rejects.toThrow("urlBuilder ne gère pas une source de type « folder ».");
  });

  it("forwards --app-id through to the validation", async () => {
    await expect(
      urlBuilder.build({
        source: { type: "url", path: "https://example.com/" },
        output: outputPath(),
        logger: silentLogger,
        appId: "monapp",
      }),
    ).rejects.toThrow(/^Identifiant d'application invalide « monapp »/);
  });
});
