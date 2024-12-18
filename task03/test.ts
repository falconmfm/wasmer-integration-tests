import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
// import * as fs from "jsr:@std/fs";
import { exists } from "jsr:@std/fs";
import * as yaml from "jsr:@std/yaml";
import * as toml from "jsr:@std/toml";

import * as path from "node:path";
import process from "node:process";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import os from "node:os";
import fs from "node:fs";

// UTILITIES

const ENV_VAR_REGISTRY: string = "WASMER_REGISTRY";
const ENV_VAR_NAMESPACE: string = "WASMER_NAMESPACE";
const ENV_VAR_TOKEN: string = "WASMER_TOKEN";
const ENV_VAR_APP_DOMAIN: string = "WASMER_APP_DOMAIN";
const ENV_VAR_EDGE_SERVER: string = "EDGE_SERVER";
const ENV_VAR_WASMER_PATH: string = "WASMER_PATH";
const ENV_VAR_WASMOPTICON_DIR: string = "WASMOPTICON_DIR";

const REGISTRY_DEV: string = "https://registry.wasmer.wtf/graphql";
const REGISTRY_PROD: string = "https://registry.wasmer.io/graphql";

const appDomainMap = {
  [REGISTRY_PROD]: "wasmer.app",
  [REGISTRY_DEV]: "wasmer.dev",
};

const DEFAULT_NAMESPACE: string = "falconmfm";

async function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomAppName(): string {
  const id = crypto.randomUUID();
  return "t-" + id.replace(/\-/g, "").substr(0, 20);
}

// Path to the wasmopticon repo.
async function wasmopticonDir(): Promise<string> {
  const WASMOPTICON_GIT_URL = "https://github.com/wasix-org/wasmopticon.git";
  let dir = process.env[ENV_VAR_WASMOPTICON_DIR];
  if (dir) {
    const doesExist = await exists(dir);
    if (!doesExist) {
      throw new Error(
        `${ENV_VAR_WASMOPTICON_DIR} is set, but directory does not exist: ${dir}`,
      );
    }
    return dir;
  }

  // No env var set, check the default location.
  const localDir = path.join(process.cwd(), "wasmopticon");

  // Acquire a lock to prevent multiple concurrent clones.
  const lockPath = path.join(process.cwd(), "wasmopticon-clone.lock");
  while (true) {
    try {
      fs.promises.writeFile(lockPath, "", { flag: "wx" });
      // Lock acquired, start cloning.
      break;
    } catch {
      // Lock already exists.
      // Wait a bit and try again.
      await sleep(1000);
    }
  }

  const freeLock = async () => {
    await fs.promises.unlink(lockPath);
  };

  // Lock acquired.
  if (await exists(localDir)) {
    await freeLock();
    return localDir;
  }

  console.log("wasmopticon dir not found");
  console.log(`Cloning ${WASMOPTICON_GIT_URL} to ${localDir}...`);

  const cmd = new Deno.Command("git", {
    args: ["clone", WASMOPTICON_GIT_URL, localDir],
  });
  const output = await cmd.output();
  await freeLock();
  if (!output.success) {
    throw new Error(`Failed to clone wasmopticon: ${output.code}`);
  }
  return localDir;
}

// The global wasmer config file.
interface WasmerConfig {
  registry?: {
    active_registry?: string;
    tokens?: [{ registry: string; token: string }];
  };
}

function loadWasmerConfig(): WasmerConfig {
  const p = path.join(os.homedir(), ".wasmer/wasmer.toml");
  const contents = fs.readFileSync(p, "utf-8");
  const data = toml.parse(contents);
  return data;
}

// Custom node API based http client.
//
// Needed to allow custom dns resolution and accepting invalid certs.
class HttpClient {
  targetServer: string | null = null;

  async fetch(url: string, options: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === "https:" ? https : http;

      const requestHeaders: http.OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(options.headers ?? {})) {
        requestHeaders[key] = value;
      }

      let lookup: any = null;
      if (this.targetServer) {
        const ipProto = this.targetServer.includes(":") ? 6 : 4;
        lookup = (_hostname: string, _options: any, callback: any) => {
          callback(null, this.targetServer, ipProto);
          throw new Error("lookup called");
        };
      }

      const requestOptions = {
        method: options.method || "GET",
        headers: requestHeaders,
        lookup,
      };

      const req = protocol.request(parsedUrl, requestOptions, (res) => {
        let data: any[] = [];

        res.on("data", (chunk) => {
          data.push(chunk);
        });

        res.on("end", () => {
          const plainHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) {
              if (typeof value === "string") {
                plainHeaders[key] = value;
              } else {
                throw new Error(
                  `could not convert header value: ${key}: ${typeof value}`,
                );
              }
            }
          }

          const headers = new Headers(plainHeaders);

          const buffer = Buffer.concat(data);
          const bodyArray: Uint8Array = new Uint8Array(buffer);

          const status = res.statusCode || 0;
          const out: Response = {
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? "unknown",
            json: () => Promise.resolve(JSON.parse(buffer.toString())),
            text: () => Promise.resolve(buffer.toString()),
            bytes: () => Promise.resolve(bodyArray),
            arrayBuffer: () => Promise.resolve(buffer),
            headers,
            url: res.url ?? "",
            body: null,
            redirected: false,
            bodyUsed: true,
            clone: () => {
              throw new Error("Not implemented");
            },
            blob: () => {
              throw new Error("Not implemented");
            },
            formData: () => {
              throw new Error("Not implemented");
            },
            type: "default",
          };
          resolve(out);
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}

type PackageIdent = string;

function parseDeployOutput(stdout: string, dir: Path): DeployOutput {
  let infoRaw: any;
  try {
    infoRaw = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Invalid output data: could not parse output as JSON: '${err}': '${stdout}'`,
    );
  }

  let jsonConfig: any;
  try {
    jsonConfig = JSON.parse(infoRaw?.json_config);
  } catch (err) {
    throw new Error(
      `Invalid output data: could not parse JSON config: '${err}': '${infoRaw?.jsonConfig}'`,
    );
  }

  const fullName = jsonConfig?.meta?.name;
  if (typeof fullName !== "string") {
    throw new Error(
      `Invalid output data: could not extract name from JSON config: '${infoRaw?.jsonConfig}'`,
    );
  }
  const [_owner, name] = fullName.split("/");

  if (typeof infoRaw !== "object") {
    throw new Error(
      `Invalid output data: expected JSON object, got '${stdout}'`,
    );
  }

  const versionId = infoRaw?.id;
  if (typeof versionId !== "string") {
    throw new Error(
      `Invalid output data: could not extract ID from '${stdout}'`,
    );
  }

  const appId = infoRaw?.app?.id;
  if (typeof appId !== "string") {
    throw new Error(
      `Invalid output data: could not extract app ID from '${stdout}'`,
    );
  }

  const url = infoRaw?.url;
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error(
      `Invalid output data: could not extract URL from '${stdout}'`,
    );
  }

  const info: DeployOutput = {
    name,
    appId,
    appVersionId: versionId,
    url,
    path: dir,
  };

  return info;
}

// Ensure that a NAMED package at a given path is published.
//
// Returns the package name.
async function ensurePackagePublished(
  env: TestEnv,
  dir: Path,
): Promise<PackageIdent> {
  const manifsetPath = path.join(dir, "wasmer.toml");
  const manifestRaw = await fs.promises.readFile(manifsetPath, "utf-8");

  let manifest: any;
  try {
    manifest = toml.parse(manifestRaw);
  } catch (err) {
    throw new Error(
      `Failed to parse package manifest at '${manifsetPath}': ${err}`,
    );
  }

  const name = manifest?.package?.name;
  if (typeof name !== "string") {
    throw new Error(
      `Invalid package manifest: missing package name: ${manifestRaw}`,
    );
  }
  const parts = name.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid package name: expected 'owner/name', got '${name}'`,
    );
  }

  const args = [
    "publish",
    "--bump",
    dir,
  ];

  console.debug(`Publishing package at '${dir}'...`);
  await env.runWasmerCommand({ args });

  return name;
}

interface AppFetchOptions extends RequestInit {
  // Ignore non-success status codes.
  noAssertSuccess?: boolean;
  // Discard the response body.
  discardBody?: boolean;
}

interface CommandOptions {
  args: string[];
  cwd?: Path;
  env?: Record<string, string>;
  stdin?: string;
  noAssertSuccess?: boolean;
}

interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

interface ApiDeployApp {
  id: string;
  url: string;
}

interface AppInfo {
  version: DeployOutput;
  app: ApiDeployApp;

  id: string;
  url: string;
  // Directory holding the app.
  dir: Path;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: any[];
}

export class BackendClient {
  url: string;
  token: string | null;

  constructor(url: string, token: string | null) {
    this.url = url;
    this.token = token;
  }

  // Send a GraphQL query to the backend.
  async gqlQuery(
    query: string,
    variables: Record<string, any> = {},
  ): Promise<GraphQlResponse<any>> {
    const requestBody = JSON.stringify({
      query,
      variables,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(this.url, {
      method: "POST",
      body: requestBody,
      headers,
    });

    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `Failed to send GraphQL query: ${res.status}\nBODY:\n${body}`,
      );
    }

    let response: GraphQlResponse<any>;
    try {
      response = JSON.parse(body);
    } catch (err) {
      throw new Error(
        `Failed to parse GraphQL JSON response: ${err}\nBODY:\n${body}`,
      );
    }
    if (response.errors) {
      throw new Error(
        `GraphQL query failed: ${JSON.stringify(response.errors)}`,
      );
    }
    if (!response.data) {
      throw new Error(`GraphQL query failed: no data returned`);
    }
    return response;
  }

  async getAppById(appId: string): Promise<ApiDeployApp> {
    const res = await this.gqlQuery(
      `
      query($id:ID!) {
        node(id:$id) {
          ... on DeployApp {
            id
            url
          }
        }
      }
    `,
      { id: appId },
    );

    const node = res.data.node;
    if (!node) {
      console.debug({ res });
      throw new Error(`App not found: ${appId}`);
    }

    const id = node.id;
    assert(typeof id === "string");

    const url = node.url;
    assert(typeof url === "string");

    const app: ApiDeployApp = {
      id,
      url,
    };

    return app;
  }

  async appsInNamespace(
    namespace: string,
    after: string | null,
  ): Promise<
    {
      apps: [{ id: string; deleted: boolean; createdAt: string }];
      lastCursor: string | null;
    }
  > {
    const query = `
query($namespace:String!, $after:String) {
  getNamespace(name:$namespace) {
    apps(sortBy:NEWEST, after:$after) {
      pageInfo {
        endCursor
      }
      edges {
        node {
          id
          deleted
          createdAt
        }
      }
    }
  }
}
    `;

    const res = await this.gqlQuery(query, { namespace, after });
    const data = res!.data!.getNamespace!.apps;
    const lastCursor = data!.pageInfo.endCursor;
    const edges = data!.edges;
    const apps = edges.map((e: any) => e.node);
    return { apps, lastCursor };
  }

  async deleteApp(appId: string): Promise<void> {
    const query = `
mutation($id:ID!) {
  deleteApp(input:{id:$id}) {
    success
  }
}
`;

    const res = await this.gqlQuery(query, { id: appId });
    const success = res.data.deleteApp.success;
    if (!success) {
      throw new Error(`Failed to delete app: ${appId}`);
    }
  }
}

interface DeployOptions {
  extraCliArgs?: string[];
  noWait?: boolean;
}

export class TestEnv {
  registry: string;
  namespace: string;
  appDomain: string;

  // Backend token.
  token: string;

  /// IP or hostname of the specific Edge server to test.
  edgeServer: string | null = null;

  // Name or path of the `wasmer` binary to use.
  wasmerBinary: string = "wasmer";

  httpClient: HttpClient;
  backend: BackendClient;

  static fromEnv(): TestEnv {
    const registry = process.env[ENV_VAR_REGISTRY] ?? REGISTRY_PROD;
    const namespace = process.env[ENV_VAR_NAMESPACE] ?? DEFAULT_NAMESPACE;

    const appDomainEnv = process.env[ENV_VAR_APP_DOMAIN];

    let appDomain;
    if (registry in appDomainMap) {
      appDomain = appDomainMap[registry];
    } else if (appDomainEnv) {
      appDomain = appDomainEnv;
    } else {
      throw new Error(
        `Could not determine the app domain for registry ${registry}:
	Set the ${ENV_VAR_APP_DOMAIN} env var!`,
      );
    }

    const edgeServer = process.env[ENV_VAR_EDGE_SERVER];
    const wasmerBinary = process.env[ENV_VAR_WASMER_PATH];
    let maybeToken: string | null = process.env[ENV_VAR_TOKEN] ?? null;

    // If token is not set, try to read it from the wasmer config.
    // The token is needed for API requests.
    if (!maybeToken) {
      let config: WasmerConfig;
      try {
        config = loadWasmerConfig();
      } catch (err) {
        throw new Error(
          `Failed to load wasmer.toml config - specify the WASMER_TOKEN env var to provide a token without a config (error: ${err})`,
        );
      }
      maybeToken = config.registry?.tokens?.find((t) =>
        t.registry === registry
      )?.token ?? null;
      if (!maybeToken) {
        throw new Error(
          `Could not find token for registry ${registry} in wasmer.toml config - \
            specify the token with the WASMER_TOKEN env var`,
        );
      }
    }

    const token: string = maybeToken;

    const httpClient = new HttpClient();
    if (edgeServer) {
      httpClient.targetServer = edgeServer;
    }

    const env = new TestEnv(
      registry,
      token,
      namespace,
      appDomain,
      httpClient,
    );

    if (edgeServer) {
      env.edgeServer = edgeServer;
    }

    if (wasmerBinary) {
      env.wasmerBinary = wasmerBinary;
    }

    if (maybeToken) {
      env.token = maybeToken;
    }

    return env;
  }

  private constructor(
    registry: string,
    token: string,
    namespace: string,
    appDomain: string,
    client: HttpClient,
  ) {
    this.registry = registry;
    this.namespace = namespace;
    this.appDomain = appDomain;

    this.httpClient = client;
    this.backend = new BackendClient(registry, token);
    this.token = token;
  }

  async runWasmerCommand(options: CommandOptions): Promise<CommandOutput> {
    const cmd = this.wasmerBinary;
    const args = options.args;

    const env = options.env ?? {};
    if (!args.includes("--registry")) {
      env["WASMER_REGISTRY"] = this.registry;
    }
    if (!args.includes("--token")) {
      env["WASMER_TOKEN"] = this.token;
    }

    const copts: Deno.CommandOptions = {
      cwd: options.cwd,
      args,
      env,
      stdin: options.stdin ? "piped" : "null",
    };

    console.debug("Running command...", copts);
    const command = new Deno.Command(cmd, {
      ...copts,
      stdout: "piped",
      stderr: "piped",
    });

    // create subprocess and collect output
    const proc = command.spawn();

    if (options.stdin) {
      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(options.stdin));
      await writer.releaseLock();
      await proc.stdin.close();
    }

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    function mergeChunks(chunks: Uint8Array[]): Uint8Array {
      const ret = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      chunks.reduce((offset, chunk) => {
        ret.set(chunk, offset);
        return offset + chunk.length;
      }, 0);
      return ret;
    }

    const collectAndPrint = async (
      readable: ReadableStream<Uint8Array>,
      chunks: Uint8Array[],
    ) => {
      const reader = readable.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          await Deno.stdout.write(value); // Print while reading
          chunks.push(value); // Collect to array
        }
        if (done) {
          break;
        }
      }
    };

    console.log("command output >>>");

    // Need to run concurrently to avoid blocking due to full stdout/stderr buffers.

    const stdoutRes = collectAndPrint(proc.stdout, stdoutChunks);
    const stderrRes = collectAndPrint(proc.stderr, stderrChunks);
    const procResult = await proc.status;

    await stdoutRes;
    const stdout = new TextDecoder().decode(mergeChunks(stdoutChunks).buffer);
    await stderrRes;
    const stderr = new TextDecoder().decode(mergeChunks(stderrChunks).buffer);

    const code = procResult.code;
    console.log(`<<< command finished with code ${code}`);

    const result: CommandOutput = {
      code,
      stdout,
      stderr,
    };

    console.debug("Command executed:", result);

    if (code !== 0 && options.noAssertSuccess !== true) {
      const data = JSON.stringify(result, null, 2);
      throw new Error(`Command failed: ${data}`);
    }

    return result;
  }

  async deployAppDir(dir: Path, options?: DeployOptions): Promise<AppInfo> {
    const extraArgs = options?.extraCliArgs ?? [];
    const noWait = options?.noWait ?? false;

    const args: string[] = [
      "deploy",
      "--non-interactive",
      "--format",
      "json",
      ...extraArgs,
    ];

    // If a specific server should be tested, don't wait for the deployment to
    // succeed, because the CLI might not test the specific server.
    if (noWait || this.edgeServer) {
      args.push("--no-wait");
    }

    const { code, stdout, stderr } = await this.runWasmerCommand({
      args,
      cwd: dir,
    });

    const version = parseDeployOutput(stdout, dir);
    const info = await this.resolveAppInfoFromVersion(version, dir);

    if (this.edgeServer && !noWait) {
      // Specific target server, but waiting is enabled, so manually test.
      const res = await this.fetchApp(info, "/");
    }

    console.debug("App deployed", { info });
    return info;
  }

  async resolveAppInfoFromVersion(
    version: DeployOutput,
    dir: Path,
  ): Promise<AppInfo> {
    // Load app from backend.
    const app = await this.backend.getAppById(version.appId);
    const info: AppInfo = {
      version,
      app,

      id: version.appId,
      url: app.url,
      dir,
    };

    return info;
  }

  async deployApp(
    spec: AppDefinition,
    options?: DeployOptions,
  ): Promise<AppInfo> {
    // Stub in values.
    if (!spec.appYaml.owner) {
      spec.appYaml.owner = this.namespace;
    }
    if (!spec.appYaml.name) {
      spec.appYaml.name = randomAppName();
    }
    if (!spec.appYaml.domains) {
      spec.appYaml.domains = [spec.appYaml.name + "." + this.appDomain];
    }

    const dir = await buildTempDir(spec.files ?? {});
    await writeAppDefinition(dir, spec);
    return this.deployAppDir(dir, options);
  }

  async deleteApp(app: AppInfo): Promise<void> {
    await this.runWasmerCommand({
      args: ["app", "delete", app.id],
    });
  }

  async fetchApp(
    app: AppInfo,
    urlOrPath: string,
    options: AppFetchOptions = {},
  ): Promise<Response> {
    let url: string;
    if (urlOrPath.startsWith("http")) {
      url = urlOrPath;
    } else {
      url = app.url + (urlOrPath.startsWith("/") ? "" : "/") + urlOrPath;
    }

    // Should not follow redirects by default.
    if (!options.redirect) {
      options.redirect = "manual";
    }

    console.debug(`Fetching URL ${url}`, { options });
    const response = await this.httpClient.fetch(url, options);
    console.debug(`Fetched URL ${url}`, {
      status: response.status,
      headers: response.headers,
    });
    // if (options.discardBody) {
    //   await response.body?.cancel();
    // }
    if (!options.noAssertSuccess && !response.ok) {
      // Try to get the body:
      let body: string | null = null;
      try {
        body = await response.text();
      } catch (err) {}

      // TODO: allow running against a particular server.
      throw new Error(
        `Failed to fetch URL '${url}': ${response.status}\n\nBODY:\n${body}`,
      );
    }
    return response;
  }
}

const HEADER_PURGE_INSTANCES: string = "x-edge-purge-instances";
const HEADER_INSTANCE_ID: string = "x-edge-instance-id";

type Path = string;

interface DirEntry extends Record<Path, string | DirEntry> {}

// Build a file system directory from the provided directory tree.
async function buildDir(path: Path, files: DirEntry): Promise<void> {
  for (const [name, value] of Object.entries(files)) {
    const subPath = `${path}/${name}`;
    if (typeof value === "string") {
      await fs.promises.writeFile(subPath, value);
    } else {
      await fs.promises.mkdir(subPath, { recursive: true });
      await buildDir(subPath, value);
    }
  }
}

async function createTempDir(): Promise<Path> {
  const dir = path.join(os.tmpdir(), crypto.randomUUID());
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

// Build a temporary directory from the provided directory tree.
async function buildTempDir(files: DirEntry): Promise<Path> {
  const tempDir = await createTempDir();
  await buildDir(tempDir, files);
  return tempDir;
}

// Definition for an app.
// Contains an optional package definition, directory tree and app.yaml configuration.
interface AppDefinition {
  wasmerToml?: Record<string, any>;
  appYaml: Record<string, any>;
  files?: DirEntry;
}

// Build a basic static site `AppDefinition`.
//
// You can tweak the defintion by modifying the files if required.
function buildStaticSiteApp(): AppDefinition & {
  files: { "public": { "index.html": string } };
} {
  return {
    wasmerToml: {
      dependencies: {
        "wasmer/static-web-server": "1",
      },
      fs: {
        "/public": "public",
        // "/settings": "settings",
      },
      command: [{
        name: "script",
        module: "wasmer/static-web-server:webserver",
        runner: "https://webc.org/runner/wasi",
        // annotations: {
        //   wasi: {
        //     'main-args': ["-w", "/settings/config.toml"],
        //   }
        // }
      }],
    },
    appYaml: {
      kind: "wasmer.io/App.v0",
      name: randomAppName(),
      package: ".",
    },
    files: {
      "public": {
        "index.html": `<html><body>Hello!</body></html>`,
      },
    },
  };
}

// Build a basic javascript worker `AppDefinition`.
//
// You can tweak the defintion by modifying the files if required.
function buildJsWorkerApp(
  jsCode?: string,
): AppDefinition & { files: { "src": { "index.js": string } } } {
  const DEFAULT_CODE = `
async function handler(request) {
  const out = JSON.stringify({
    env: process.env,
    headers: Object.fromEntries(request.headers),
  }, null, 2);
  return new Response(out, {
    headers: { "content-type": "application/json" },
  });
}

addEventListener("fetch", (fetchEvent) => {
  fetchEvent.respondWith(handler(fetchEvent.request));
});
`;

  const code = jsCode ?? DEFAULT_CODE;

  return {
    wasmerToml: {
      dependencies: {
        "wasmer/winterjs": "1",
      },
      fs: {
        "/src": "src",
        // "/settings": "settings",
      },
      command: [{
        name: "script",
        module: "wasmer/winterjs:winterjs",
        runner: "https://webc.org/runner/wasi",
        annotations: {
          wasi: {
            "main-args": ["/src/index.js"],
          },
        },
      }],
    },
    appYaml: {
      kind: "wasmer.io/App.v0",
      name: randomAppName(),
      package: ".",
    },
    files: {
      "src": {
        "index.js": code,
      },
    },
  };
}

// Write an `AppDefinition` to a directory.
async function writeAppDefinition(path: Path, app: AppDefinition) {
  const files: DirEntry = {
    ...(app.files ?? {}),
    "app.yaml": yaml.stringify(app.appYaml),
  };
  if (app.wasmerToml) {
    files["wasmer.toml"] = toml.stringify(app.wasmerToml);
  }

  console.debug(`Writing app definition to ${path}`, { files });
  await buildDir(path, files);
}

// Parsed output from the "wasmer deploy" command.
interface DeployOutput {
  name: string;
  appId: string;
  appVersionId: string;
  url: string;

  path: Path;
}

// TESTS

Deno.test("app-php", async () => {
  const env = TestEnv.fromEnv();

  const spec: AppDefinition = {
    wasmerToml: {
      dependencies: {
        "php/php": "8.*",
      },
      fs: {
        "/src": "src",
      },
      command: [{
        name: "run",
        module: "php/php:php",
        runner: "wasi",
        annotations: {
          wasi: {
            "main-args": ["-t", "/src", "-S", "localhost:8080"],
          },
        },
      }],
    },
    appYaml: {
      kind: "wasmer.io/App.v0",
      package: ".",
    },
    files: {
      "src": {
        "index.php": `
<?php
echo $_GET["name"];
        `,
      },
    },
  };

  const info = await env.deployApp(spec);
  const res = await env.fetchApp(info, "/?name=world");
  const body = await res.text();
  assertEquals(body.trim(), "world");
});

const EDGE_HEADER_PURGE_INSTANCES = "x-edge-purge-instances";
const EDGE_HEADER_JOURNAL_STATUS = "x-edge-instance-journal-status";














