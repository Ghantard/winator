import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { runCommand } from "./exec";
import type { CommandRunner } from "./exec";
import { createLogger } from "./logger";
import type { Logger } from "./logger";

/** Where the generated debug keystore lives. */
export const DEBUG_KEYSTORE_DIR = join(homedir(), ".html2apk");
export const DEBUG_KEYSTORE_PATH = join(DEBUG_KEYSTORE_DIR, "debug.keystore");
/** The conventional AOSP debug credentials — public by design, not a secret. */
export const DEBUG_KEYSTORE_PASSWORD = "android";
export const DEBUG_KEY_ALIAS = "androiddebugkey";
export const DEBUG_KEY_DNAME = "CN=Android Debug,O=Android,C=US";
/** 30 years, like the AOSP debug key, so builds don't start failing later. */
export const DEBUG_KEY_VALIDITY_DAYS = 10_950;
/**
 * apksigner reads the password from this variable instead of the command line,
 * which would expose it in the process list.
 */
export const PASSWORD_ENV = "HTML2APK_KS_PASS";
/** Fallback source for --keystore-password, so it need not be typed in a shell. */
export const PASSWORD_INPUT_ENV = "HTML2APK_KEYSTORE_PASSWORD";

export interface SigningConfig {
  /** Absolute path of the keystore. */
  keystore: string;
  /** Store password, also used as the key password. */
  password: string;
  alias: string;
  /** True for the managed debug keystore, which may be generated on demand. */
  isDebug: boolean;
}

export interface SignOptions {
  logger?: Logger;
  run?: CommandRunner;
  /** Environment used to look up tools and the password fallback. */
  env?: NodeJS.ProcessEnv;
}

export interface ResolveSigningOptions {
  keystore?: string;
  password?: string;
  alias?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Work out which keystore to sign with. With no options at all this is the
 * managed debug keystore; a custom keystore needs an alias and a password.
 */
export function resolveSigningConfig(options: ResolveSigningOptions = {}): SigningConfig {
  const env = options.env ?? process.env;
  const isDebug = options.keystore === undefined;

  if (isDebug) {
    return {
      keystore: DEBUG_KEYSTORE_PATH,
      password: options.password ?? env[PASSWORD_INPUT_ENV] ?? DEBUG_KEYSTORE_PASSWORD,
      alias: options.alias ?? DEBUG_KEY_ALIAS,
      isDebug: true,
    };
  }

  const alias = options.alias;
  if (alias === undefined || alias.trim().length === 0) {
    throw new Error(
      "Alias de clé manquant : précisez --key-alias lorsque vous fournissez --keystore.",
    );
  }

  const password = options.password ?? env[PASSWORD_INPUT_ENV];
  if (password === undefined || password.length === 0) {
    throw new Error(
      "Mot de passe de keystore manquant : utilisez --keystore-password, ou " +
        `définissez la variable d'environnement ${PASSWORD_INPUT_ENV}.`,
    );
  }

  return {
    keystore: resolve(options.keystore as string),
    password,
    alias: alias.trim(),
    isDebug: false,
  };
}

/**
 * Create the debug keystore when it is missing. Returns true when one was
 * generated. A custom keystore is never generated: a missing one is an error,
 * since signing with a freshly invented key would silently change the app's
 * identity.
 */
export async function ensureKeystore(
  config: SigningConfig,
  options: SignOptions = {},
): Promise<boolean> {
  if (existsSync(config.keystore)) {
    return false;
  }
  if (!config.isDebug) {
    throw new Error(`Keystore introuvable : ${config.keystore}`);
  }

  const logger = options.logger ?? createLogger("info");
  const run = options.run ?? runCommand;
  const keytool = findTool("keytool", options.env ?? process.env);

  logger.info(`Génération de la keystore de debug : ${config.keystore}`);
  mkdirSync(DEBUG_KEYSTORE_DIR, { recursive: true });

  await run(
    keytool,
    [
      "-genkeypair",
      "-keystore", config.keystore,
      "-alias", config.alias,
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", String(DEBUG_KEY_VALIDITY_DAYS),
      "-storepass", config.password,
      "-keypass", config.password,
      "-dname", DEBUG_KEY_DNAME,
      "-noprompt",
    ],
    { cwd: DEBUG_KEYSTORE_DIR, logger },
  );

  // The file holds a private key, even a throwaway one.
  chmodSync(config.keystore, 0o600);
  return true;
}

/** Sign the APK in place, then let apksigner verify its own output. */
export async function signApk(
  apkPath: string,
  config: SigningConfig,
  options: SignOptions = {},
): Promise<void> {
  const apk = resolve(apkPath);
  if (!existsSync(apk)) {
    throw new Error(`APK introuvable, impossible de le signer : ${apk}`);
  }

  const logger = options.logger ?? createLogger("info");
  const run = options.run ?? runCommand;
  const env = options.env ?? process.env;
  const apksigner = findApksigner(env);

  await ensureKeystore(config, options);

  logger.info(`Signature de l'APK avec ${config.isDebug ? "la keystore de debug" : config.keystore}`);
  // The password goes through the environment: an argument would show up in ps
  // and in the command echoed by the logger at debug level.
  const passwordEnv = { [PASSWORD_ENV]: config.password };
  await run(
    apksigner,
    [
      "sign",
      "--ks", config.keystore,
      "--ks-key-alias", config.alias,
      "--ks-pass", `env:${PASSWORD_ENV}`,
      "--key-pass", `env:${PASSWORD_ENV}`,
      apk,
    ],
    { cwd: process.cwd(), logger, env: passwordEnv },
  );

  await run(apksigner, ["verify", apk], { cwd: process.cwd(), logger });
  logger.info("Signature vérifiée");
}

/**
 * Locate apksigner: on the PATH first, then under the Android SDK's
 * build-tools, taking the highest version installed.
 */
export function findApksigner(env: NodeJS.ProcessEnv = process.env): string {
  const onPath = findOnPath("apksigner", env);
  if (onPath !== undefined) {
    return onPath;
  }

  const sdk = env["ANDROID_HOME"] ?? env["ANDROID_SDK_ROOT"];
  if (sdk !== undefined && sdk.length > 0) {
    const buildTools = join(sdk, "build-tools");
    if (existsSync(buildTools)) {
      const versions = readdirSync(buildTools).sort().reverse();
      for (const version of versions) {
        const candidate = join(buildTools, version, "apksigner");
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  throw new Error(
    "apksigner introuvable : installez les build-tools du SDK Android et " +
      "définissez ANDROID_HOME, ou laissez le build se faire dans Docker.",
  );
}

/** Locate a JDK tool on the PATH, falling back to $JAVA_HOME/bin. */
export function findTool(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const onPath = findOnPath(name, env);
  if (onPath !== undefined) {
    return onPath;
  }

  const javaHome = env["JAVA_HOME"];
  if (javaHome !== undefined && javaHome.length > 0) {
    const candidate = join(javaHome, "bin", name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `${name} introuvable : installez un JDK et définissez JAVA_HOME, ou ` +
      "laissez le build se faire dans Docker.",
  );
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const path = env["PATH"];
  if (path === undefined) {
    return undefined;
  }
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
