import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { apkFileName, createGuiServer, describeFailure, PAGE } from "../src/gui";
import type { GuiOptions, Job } from "../src/gui";
import { CommandError } from "../src/utils/exec";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function siteDir(): string {
  const dir = tempDir("html2apk-gui-site-");
  writeFileSync(join(dir, "index.html"), "<h1>Hello World</h1>");
  return dir;
}

interface Harness {
  base: string;
  jobs: Map<string, Job>;
  close: () => Promise<void>;
}

/** Start the interface on a free port with the build replaced by a stub. */
type BuildFn = NonNullable<GuiOptions["build"]>;

async function start(build: BuildFn): Promise<Harness> {
  const outputDir = tempDir("html2apk-gui-out-");
  const { server, jobs } = createGuiServer({ outputDir, logLevel: "error", build });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    jobs,
    close: () =>
      new Promise<void>((closed) => {
        // fetch keeps its sockets alive, so close() would wait for them.
        server.closeAllConnections();
        server.close(() => closed());
      }),
  };
}

/** Poll the job endpoint until the build is no longer running. */
async function settle(base: string, id: string): Promise<Job> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = (await (await fetch(`${base}/api/jobs/${id}`)).json()) as Job;
    if (job.statut !== "en cours") {
      return job;
    }
    await new Promise((wait) => setTimeout(wait, 10));
  }
  throw new Error("Le build ne s'est jamais terminé");
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("apkFileName", () => {
  it("slugifies the app name", () => {
    expect(apkFileName("Mon Application !", "/tmp/site")).toBe("mon-application.apk");
  });

  it("strips accents rather than dropping the word", () => {
    expect(apkFileName("Épicerie Café", "/tmp/site")).toBe("epicerie-cafe.apk");
  });

  it("falls back to the folder name when no app name is given", () => {
    expect(apkFileName(undefined, "/srv/mon-site/")).toBe("mon-site.apk");
  });

  it("never returns an empty name", () => {
    expect(apkFileName("???", "/tmp/x")).toBe("app.apk");
  });
});

describe("describeFailure", () => {
  it("appends the tool output, which is what explains a failed build", () => {
    const error = new CommandError({
      command: "gradlew",
      args: ["assembleDebug"],
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "FAILURE: Build failed",
      message: "La commande « gradlew assembleDebug » a échoué (code 1).",
    });

    const text = describeFailure(error);
    expect(text).toContain("gradlew");
    expect(text).toContain("FAILURE: Build failed");
  });

  it("keeps a plain error message as is", () => {
    expect(describeFailure(new Error("Dossier introuvable"))).toBe("Dossier introuvable");
  });
});

describe("l'interface", () => {
  it("serves the page", async () => {
    const harness = await start(async () => ({ apkPath: "/tmp/none.apk", viaDocker: false }));
    try {
      const response = await fetch(`${harness.base}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toBe(PAGE);
    } finally {
      await harness.close();
    }
  });

  it("refuses a request with no source", async () => {
    const harness = await start(async () => ({ apkPath: "/tmp/none.apk", viaDocker: false }));
    try {
      const response = await fetch(`${harness.base}/api/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "   " }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { erreur: string }).erreur).toContain("https://");
    } finally {
      await harness.close();
    }
  });

  it("reports an invalid source in French rather than starting a build", async () => {
    const harness = await start(async () => ({ apkPath: "/tmp/none.apk", viaDocker: false }));
    try {
      const response = await fetch(`${harness.base}/api/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "/dossier/qui/nexiste/pas" }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { erreur: string }).erreur).toContain("introuvable");
      expect(harness.jobs.size).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("runs a build, then serves the APK it produced", async () => {
    const site = siteDir();
    const apk = join(tempDir("html2apk-gui-apk-"), "app-debug.apk");
    writeFileSync(apk, Buffer.alloc(2048, 7));

    const harness = await start(async (request, context): Promise<{
      apkPath: string;
      viaDocker: boolean;
      signedWith?: string;
    }> => {
      context.progress.plan(2);
      context.progress.step("Build Gradle");
      context.progress.step("Signature");
      expect(request.appName).toBe("Mon Essai");
      expect(request.docker).toBe(false);
      return { apkPath: apk, viaDocker: false, signedWith: "keystore de debug" };
    });

    try {
      const started = await fetch(`${harness.base}/api/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: site, nom: "Mon Essai", moteur: "local" }),
      });
      expect(started.status).toBe(202);
      const { id } = (await started.json()) as { id: string };

      const job = await settle(harness.base, id);
      expect(job.statut).toBe("terminé");
      expect(job.etape).toBe(job.total);
      expect(job.taille).toBe("2,0 Ko");
      expect(job.chemin).toBe(apk);

      const download = await fetch(`${harness.base}/api/jobs/${id}/apk`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/vnd.android.package-archive");
      expect((await download.arrayBuffer()).byteLength).toBe(2048);
    } finally {
      await harness.close();
    }
  });

  it("surfaces a failed build with its tool output", async () => {
    const site = siteDir();
    const harness = await start(async () => {
      throw new CommandError({
        command: "gradlew",
        args: ["assembleDebug"],
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "FAILURE: SDK introuvable",
        message: "La commande « gradlew assembleDebug » a échoué (code 1).",
      });
    });

    try {
      const started = await fetch(`${harness.base}/api/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: site }),
      });
      const { id } = (await started.json()) as { id: string };

      const job = await settle(harness.base, id);
      expect(job.statut).toBe("échec");
      expect(job.erreur).toContain("SDK introuvable");
    } finally {
      await harness.close();
    }
  });

  it("builds through Docker unless the local environment is asked for", async () => {
    const site = siteDir();
    const seen: boolean[] = [];
    const harness = await start(async (request) => {
      seen.push(request.docker);
      return { apkPath: "/tmp/none.apk", viaDocker: request.docker };
    });

    try {
      for (const moteur of ["auto", "docker", "local"]) {
        await fetch(`${harness.base}/api/build`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: site, moteur }),
        });
      }
      await new Promise((wait) => setTimeout(wait, 50));
      expect(seen).toEqual([true, true, false]);
    } finally {
      await harness.close();
    }
  });

  it("answers 404 on an unknown job and an unknown route", async () => {
    const harness = await start(async () => ({ apkPath: "/tmp/none.apk", viaDocker: false }));
    try {
      expect((await fetch(`${harness.base}/api/jobs/inconnu`)).status).toBe(404);
      expect((await fetch(`${harness.base}/api/jobs/inconnu/apk`)).status).toBe(404);
      expect((await fetch(`${harness.base}/nimporte-quoi`)).status).toBe(404);
    } finally {
      await harness.close();
    }
  });
});
