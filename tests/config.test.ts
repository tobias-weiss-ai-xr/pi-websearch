import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, VALID_PROVIDERS } from "../src/config";

// Env vars touched by loadConfig + the homedir vars we redirect for
// hermetic global-config tests. Restored after every test.
const MANAGED_ENV = [
  "PI_WEBSEARCH_PROVIDER",
  "EXA_API_KEY",
  "SEARXNG_BASE_URL",
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CX",
  "HOME",
  "USERPROFILE",
];

let savedEnv: Record<string, string | undefined>;
let projectDir: string;
let homeDir: string;

function writeProjectConfig(config: object): void {
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  writeFileSync(
    join(projectDir, ".pi", "pi-websearch.json"),
    JSON.stringify(config),
  );
}

function writeGlobalConfig(config: object): void {
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(homeDir, ".pi", "agent", "pi-websearch.json"),
    JSON.stringify(config),
  );
}

beforeEach(() => {
  savedEnv = {};
  for (const key of MANAGED_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Redirect homedir so the global config file is hermetic.
  homeDir = mkdtempSync(join(tmpdir(), "piws-home-"));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  projectDir = mkdtempSync(join(tmpdir(), "piws-proj-"));
});

afterEach(() => {
  for (const key of MANAGED_ENV) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("defaults when no env vars or config files exist", () => {
    const cfg = loadConfig(projectDir);
    expect(cfg.provider).toBe("exa");
    expect(cfg.numResults).toBe(8);
    expect(cfg.type).toBe("auto");
    expect(cfg.contextMaxCharacters).toBe(10_000);
    expect(cfg.cacheTtlSeconds).toBe(300);
    expect(cfg.requestTimeoutMs).toBe(20_000);
  });

  test("env beats project file beats global file, per field", () => {
    writeGlobalConfig({
      provider: "brave",
      numResults: 3,
      contextMaxCharacters: 111,
      braveApiKey: "global-brave",
    });
    writeProjectConfig({
      provider: "tavily",
      numResults: 5,
      tavilyApiKey: "project-tavily",
    });
    process.env.PI_WEBSEARCH_PROVIDER = "searxng";
    process.env.SEARXNG_BASE_URL = "http://searx.example";

    const cfg = loadConfig(projectDir);
    expect(cfg.provider).toBe("searxng"); // env wins
    expect(cfg.searxngBaseUrl).toBe("http://searx.example"); // env only
    expect(cfg.numResults).toBe(5); // project wins over global
    expect(cfg.contextMaxCharacters).toBe(111); // global fallback
    expect(cfg.tavilyApiKey).toBe("project-tavily"); // project only
    expect(cfg.braveApiKey).toBe("global-brave"); // global only
  });

  test("env key overrides key from file", () => {
    writeProjectConfig({ exaApiKey: "file-key" });
    process.env.EXA_API_KEY = "env-key";
    expect(loadConfig(projectDir).exaApiKey).toBe("env-key");
  });

  test("global file is used when project file is missing", () => {
    writeGlobalConfig({ provider: "duckduckgo", numResults: 2 });
    const cfg = loadConfig(projectDir);
    expect(cfg.provider).toBe("duckduckgo");
    expect(cfg.numResults).toBe(2);
  });

  test("unknown provider throws with valid providers listed", () => {
    process.env.PI_WEBSEARCH_PROVIDER = "nope";
    expect(() => loadConfig(projectDir)).toThrow(/unknown PI_WEBSEARCH_PROVIDER "nope"/i);
    expect(() => loadConfig(projectDir)).toThrow(VALID_PROVIDERS.join(", "));
  });

  test("unknown provider in a config file also throws", () => {
    writeProjectConfig({ provider: "bing" });
    expect(() => loadConfig(projectDir)).toThrow(/bing/);
  });

  test("malformed JSON in project config throws with file path", () => {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(join(projectDir, ".pi", "pi-websearch.json"), "{ not json");
    expect(() => loadConfig(projectDir)).toThrow(/pi-websearch\.json/);
  });

  test("missing config files are fine, invalid field values fall back", () => {
    writeProjectConfig({ numResults: "lots", type: "bogus" });
    const cfg = loadConfig(projectDir);
    expect(cfg.numResults).toBe(8);
    expect(cfg.type).toBe("auto");
  });
});
