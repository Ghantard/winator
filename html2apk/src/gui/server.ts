import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { runBuild } from "../build";
import type { RunBuildOutcome } from "../build";
import { createLogger, detectSource, formatBytes, formatDuration } from "../utils";
import { DEFAULT_APP_ID } from "../builders";
import type { LogLevel, Progress } from "../utils";
import { PAGE } from "./page";

export const DEFAULT_PORT = 4173;
/** Where the interface drops the APKs it builds, so they survive the session. */
export const OUTPUT_DIR = join(homedir(), "html2apk");
const MAX_BODY_BYTES = 64 * 1024;

export type JobStatus = "en cours" | "terminé" | "échec";

export interface Job {
  id: string;
  statut: JobStatus;
  /** Steps completed so far, and how many are planned. */
  etape: number;
  total: number;
  libelle: string;
  chemin?: string;
  taille?: string;
  duree?: string;
  erreur?: string;
}

export interface BuildRequestBody {
  source?: unknown;
  nom?: unknown;
  identifiant?: unknown;
  moteur?: unknown;
}

export interface GuiOptions {
  port?: number;
  host?: string;
  outputDir?: string;
  logLevel?: LogLevel;
  /** Injected by the tests so no real build runs. */
  build?: typeof runBuild;
}

/** Progress reporter that writes into the job the interface polls. */
function jobProgress(job: Job): Progress {
  return {
    plan(total: number): void {
      job.total = total;
      job.etape = 0;
    },
    step(label: string): void {
      job.etape = Math.min(job.etape + 1, job.total === 0 ? job.etape + 1 : job.total);
      job.libelle = label;
    },
    clear(): void {
      /* nothing to erase: the page redraws itself */
    },
    stop(): void {
      /* nothing to stop */
    },
  };
}

function text(field: unknown): string | undefined {
  if (typeof field !== "string") {
    return undefined;
  }
  const trimmed = field.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A file name from the app name: no spaces, no separators, no surprises. */
export function apkFileName(appName: string | undefined, source: string): string {
  const base = appName ?? basename(source.replace(/\/+$/, "")) ?? "app";
  const slug = base
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "app" : slug}.apk`;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Requête trop volumineuse.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The interface: a local HTTP server that serves one page and runs builds for
 * it. Bound to the loopback address — it exposes the local filesystem through
 * the build source, so it is never reachable from the network.
 */
export function createGuiServer(options: GuiOptions = {}): {
  server: Server;
  jobs: Map<string, Job>;
} {
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const logLevel = options.logLevel ?? "info";
  const build = options.build ?? runBuild;
  const jobs = new Map<string, Job>();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (request.method === "GET" && (path === "/" || path === "/index.html")) {
      send(response, 200, "text/html; charset=utf-8", PAGE);
      return;
    }

    if (request.method === "POST" && path === "/api/build") {
      void handleBuild(request, response);
      return;
    }

    const job = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (request.method === "GET" && job !== null) {
      const found = jobs.get(job[1] as string);
      if (found === undefined) {
        sendJson(response, 404, { erreur: "Build inconnu." });
        return;
      }
      sendJson(response, 200, found);
      return;
    }

    const apk = /^\/api\/jobs\/([^/]+)\/apk$/.exec(path);
    if (request.method === "GET" && apk !== null) {
      const found = jobs.get(apk[1] as string);
      if (found?.chemin === undefined || !existsSync(found.chemin)) {
        sendJson(response, 404, { erreur: "APK introuvable." });
        return;
      }
      response.writeHead(200, {
        "content-type": "application/vnd.android.package-archive",
        "content-length": statSync(found.chemin).size,
        "content-disposition": `attachment; filename="${basename(found.chemin)}"`,
      });
      createReadStream(found.chemin).pipe(response);
      return;
    }

    sendJson(response, 404, { erreur: "Page inconnue." });
  });

  async function handleBuild(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: BuildRequestBody;
    try {
      body = JSON.parse(await readBody(request)) as BuildRequestBody;
    } catch {
      sendJson(response, 400, { erreur: "Requête illisible." });
      return;
    }

    const rawSource = text(body.source);
    if (rawSource === undefined) {
      sendJson(response, 400, { erreur: "Indiquez une adresse https:// ou un dossier." });
      return;
    }

    const appName = text(body.nom);
    const appId = text(body.identifiant) ?? DEFAULT_APP_ID;
    const engine = text(body.moteur) ?? "auto";

    let source;
    try {
      source = await detectSource(rawSource);
    } catch (error: unknown) {
      sendJson(response, 400, { erreur: (error as Error).message });
      return;
    }

    mkdirSync(outputDir, { recursive: true });
    const output = resolve(outputDir, apkFileName(appName, source.path));

    const id = randomUUID();
    const entry: Job = {
      id,
      statut: "en cours",
      etape: 0,
      total: 0,
      libelle: "Préparation…",
    };
    jobs.set(id, entry);
    sendJson(response, 202, { id });

    const startedAt = Date.now();
    const logger = createLogger(logLevel);

    build(
      {
        source,
        output,
        docker: engine !== "local",
        logLevel,
        appId,
        ...(appName !== undefined ? { appName } : {}),
      },
      { logger, progress: jobProgress(entry) },
    )
      .then((outcome: RunBuildOutcome) => {
        entry.statut = "terminé";
        entry.etape = entry.total;
        entry.libelle = "Terminé";
        entry.chemin = outcome.apkPath;
        entry.taille = formatBytes(statSync(outcome.apkPath).size);
        entry.duree = formatDuration(Date.now() - startedAt);
      })
      .catch((error: unknown) => {
        entry.statut = "échec";
        entry.erreur = describeFailure(error);
      });
  }

  return { server, jobs };
}

/** The message plus the tool output, which is what explains a failed build. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const output = (error as { output?: string }).output;
  if (typeof output === "string" && output.trim() !== "") {
    return `${error.message}\n\n${output.trim()}`;
  }
  return error.message;
}

/** Best effort: the interface works just as well if the browser stays closed. */
export function openBrowser(url: string): void {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* no browser here; the address is printed anyway */
    });
    child.unref();
  } catch {
    /* same */
  }
}

export async function startGui(options: GuiOptions = {}): Promise<Server> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "127.0.0.1";
  const { server } = createGuiServer(options);
  const logger = createLogger(options.logLevel ?? "info");

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const url = `http://${host}:${port}/`;
  logger.info(`Interface ouverte sur ${url}`);
  logger.info(`Les APK sont enregistrés dans ${options.outputDir ?? OUTPUT_DIR}`);
  logger.info("Laissez cette fenêtre ouverte, puis fermez-la (Ctrl+C) pour quitter.");
  openBrowser(url);
  return server;
}
