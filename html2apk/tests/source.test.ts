import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSource, describeSource, INDEX_FILE } from "../src/utils/source";
import type { FetchLike } from "../src/utils/source";

/** A fetch stub that records its calls and replies with the given responses. */
function fakeFetch(
  ...responses: ReadonlyArray<{ status?: number; statusText?: string } | Error>
): { fetch: FetchLike; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: String(init?.method ?? "GET") });
    const reply = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (reply instanceof Error) {
      throw reply;
    }
    return new Response(null, {
      status: reply?.status ?? 200,
      statusText: reply?.statusText ?? "",
    });
  };
  return { fetch, calls };
}

const tempDirs: string[] = [];

function makeTempDir(withIndex: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "html2apk-test-"));
  tempDirs.push(dir);
  if (withIndex) {
    writeFileSync(join(dir, INDEX_FILE), "<!doctype html><title>ok</title>");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("detectSource — URLs", () => {
  it("detects an https URL and probes it with HEAD", async () => {
    const { fetch, calls } = fakeFetch({ status: 200 });

    const source = await detectSource("https://example.com", { fetch });

    expect(source).toEqual({ type: "url", path: "https://example.com/" });
    expect(calls).toEqual([{ url: "https://example.com/", method: "HEAD" }]);
  });

  it("detects a plain http URL too", async () => {
    const { fetch } = fakeFetch({ status: 204 });

    await expect(detectSource("http://example.com/app/", { fetch })).resolves.toEqual({
      type: "url",
      path: "http://example.com/app/",
    });
  });

  it("trims surrounding whitespace before parsing", async () => {
    const { fetch } = fakeFetch({ status: 200 });

    await expect(detectSource("  https://example.com/  ", { fetch })).resolves.toEqual({
      type: "url",
      path: "https://example.com/",
    });
  });

  it("falls back to GET when the server rejects HEAD", async () => {
    const { fetch, calls } = fakeFetch({ status: 405 }, { status: 200 });

    const source = await detectSource("https://example.com", { fetch });

    expect(source.type).toBe("url");
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  it("rejects an URL answering an HTTP error", async () => {
    const { fetch } = fakeFetch({ status: 404, statusText: "Not Found" });

    await expect(detectSource("https://example.com/nope", { fetch })).rejects.toThrow(
      "URL inaccessible (404 Not Found) : https://example.com/nope",
    );
  });

  it("reports a network failure in French", async () => {
    const { fetch } = fakeFetch(new Error("getaddrinfo ENOTFOUND nope.invalid"));

    await expect(detectSource("https://nope.invalid", { fetch })).rejects.toThrow(
      /^Impossible de joindre l'URL https:\/\/nope\.invalid\/ : getaddrinfo ENOTFOUND/,
    );
  });

  it("reports a timeout in French", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { fetch } = fakeFetch(timeout);

    await expect(
      detectSource("https://example.com", { fetch, timeoutMs: 1500 }),
    ).rejects.toThrow("Délai dépassé (1500 ms) lors de la vérification de l'URL : https://example.com/");
  });

  it("rejects a non-http protocol", async () => {
    const { fetch, calls } = fakeFetch({ status: 200 });

    await expect(detectSource("ftp://example.com/site", { fetch })).rejects.toThrow(
      "Protocole non supporté « ftp » : seuls http et https sont acceptés.",
    );
    expect(calls).toEqual([]);
  });

  it("skips the network check when asked to", async () => {
    const { fetch, calls } = fakeFetch({ status: 500 });

    await expect(
      detectSource("https://example.com", { fetch, skipChecks: true }),
    ).resolves.toEqual({ type: "url", path: "https://example.com/" });
    expect(calls).toEqual([]);
  });
});

describe("detectSource — folders", () => {
  it("detects a folder containing an index.html", async () => {
    const dir = makeTempDir(true);

    await expect(detectSource(dir)).resolves.toEqual({ type: "folder", path: dir });
  });

  it("resolves a relative path against the current directory", async () => {
    const dir = makeTempDir(true);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await expect(detectSource("./")).resolves.toEqual({ type: "folder", path: dir });
  });

  it("rejects a folder without an index.html", async () => {
    const dir = makeTempDir(false);

    await expect(detectSource(dir)).rejects.toThrow(
      `Aucun fichier index.html trouvé dans le dossier : ${dir}`,
    );
  });

  it("rejects an index.html that is a directory", async () => {
    const dir = makeTempDir(false);
    mkdirSync(join(dir, INDEX_FILE));

    await expect(detectSource(dir)).rejects.toThrow("Aucun fichier index.html trouvé");
  });

  it("rejects a missing path", async () => {
    const missing = join(makeTempDir(false), "absent");

    await expect(detectSource(missing)).rejects.toThrow(`Dossier introuvable : ${missing}`);
  });

  it("rejects a file used as a source", async () => {
    const dir = makeTempDir(true);
    const file = join(dir, INDEX_FILE);

    await expect(detectSource(file)).rejects.toThrow(
      `La source doit être un dossier, pas un fichier : ${file}`,
    );
  });

  it("skips the index.html check when asked to", async () => {
    const dir = makeTempDir(false);

    await expect(detectSource(dir, { skipChecks: true })).resolves.toEqual({
      type: "folder",
      path: dir,
    });
  });
});

describe("detectSource — empty input", () => {
  it.each(["", "   ", "\t\n"])("rejects %j", async (input) => {
    await expect(detectSource(input)).rejects.toThrow(
      "Source vide : indiquez une URL (https://...) ou un chemin de dossier.",
    );
  });
});

describe("describeSource", () => {
  it("labels both kinds of source", () => {
    expect(describeSource({ type: "url", path: "https://example.com/" })).toBe(
      "URL https://example.com/",
    );
    expect(describeSource({ type: "folder", path: "/srv/site" })).toBe("dossier /srv/site");
  });
});
