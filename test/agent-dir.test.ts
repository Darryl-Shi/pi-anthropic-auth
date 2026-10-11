import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import { installedAgentDir, resolveAgentDir } from "#src/agent-dir";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-anthropic-auth-agentdir-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** Lays out `<root>/<agent>/<relative>/src/index.ts` and returns the module path. */
function installAt(relative: string, withAuth: boolean): string {
  const agentDir = join(root, "agent");
  const moduleDir = join(agentDir, relative, "src");
  mkdirSync(moduleDir, { recursive: true });
  if (withAuth) writeFileSync(join(agentDir, "auth.json"), "{}");
  return join(moduleDir, "index.ts");
}

describe("installedAgentDir", () => {
  test("finds the agent dir of a git install", () => {
    const module = installAt("git/github.com/someone/pi-anthropic-auth", true);
    assert.equal(installedAgentDir(module), join(root, "agent"));
  });

  test("finds the agent dir of an npm install", () => {
    const module = installAt(
      "npm/node_modules/@gotgenes/pi-anthropic-auth",
      true,
    );
    assert.equal(installedAgentDir(module), join(root, "agent"));
  });

  test("ignores a dir without auth.json, as a project-scope install has", () => {
    const module = installAt("git/github.com/someone/pi-anthropic-auth", false);
    assert.equal(installedAgentDir(module), undefined);
  });

  test("ignores a local checkout outside any install dir", () => {
    const module = join(root, "checkout", "src", "index.ts");
    assert.equal(installedAgentDir(module), undefined);
  });
});

describe("resolveAgentDir", () => {
  test("PI_CODING_AGENT_DIR wins over the install location", () => {
    const module = installAt("git/github.com/someone/pi-anthropic-auth", true);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "explicit"));
    assert.equal(
      resolveAgentDir(pathToFileURL(module).href),
      join(root, "explicit"),
    );
  });

  test("uses the install location when the env var is unset", () => {
    const module = installAt("git/github.com/someone/pi-anthropic-auth", true);
    vi.stubEnv("PI_CODING_AGENT_DIR", "");
    assert.equal(
      resolveAgentDir(pathToFileURL(module).href),
      join(root, "agent"),
    );
  });
});
