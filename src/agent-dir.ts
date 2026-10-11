import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** pi's agent-dir override; `getAgentDir()` honours it. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * The agent dir this copy of the extension was installed into, read off its
 * own path: pi installs a git package under `<agentDir>/git/<host>/<path>`
 * and an npm package under `<agentDir>/npm/node_modules/<name>`.
 *
 * A host that embeds pi's model runtime over its own agent dir (the software
 * factory's `~/.factory/pi`) passes that dir to pi's loaders explicitly, so
 * `getAgentDir()` still names `~/.pi/agent` there.  The install location is
 * the one signal such a host cannot get wrong.  It counts only when the dir
 * holds an `auth.json`: a project-scope install lives under `<cwd>/.pi`,
 * which has a `settings.json` but no logins.
 */
export function installedAgentDir(modulePath: string): string | undefined {
  const parts = dirname(modulePath).split(sep);
  for (let index = parts.length - 1; index > 0; index--) {
    const segment = parts[index];
    const isGit = segment === "git";
    const isNpm = segment === "node_modules" && parts[index - 1] === "npm";
    if (!isGit && !isNpm) continue;
    const root = parts.slice(0, isNpm ? index - 1 : index).join(sep) || sep;
    if (existsSync(join(root, "auth.json"))) return root;
  }
  return undefined;
}

/**
 * The agent dir whose `auth.json` and extension config this copy reads:
 * `PI_CODING_AGENT_DIR` when set, else the dir it was installed into, else
 * pi's default.  For a package installed by `pi install`, all three agree.
 */
export function resolveAgentDir(moduleUrl: string): string {
  if (process.env[AGENT_DIR_ENV]) return getAgentDir();
  return installedAgentDir(fileURLToPath(moduleUrl)) ?? getAgentDir();
}
