import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

const { lookupProviderAccount } = vi.hoisted(() => ({
  lookupProviderAccount: vi.fn(
    (_provider: string, _credentials: unknown): Promise<AccountLookup> =>
      Promise.resolve({ kind: "not-oauth" }),
  ),
}));

vi.mock("#src/account-profile", () => ({ lookupProviderAccount }));

import type { AccountPoolEntry } from "#src/account-pool";
import type { AccountLookup, AccountProfile } from "#src/account-profile";
import {
  createStatusCommandHandler,
  type ExtensionDiagnostics,
  formatDiagnosticsReport,
  type StatusCommandContext,
} from "#src/diagnostics";

const SAMPLE: ExtensionDiagnostics = {
  version: "1.2.3",
  modulePath:
    "/root/.pi/agent/node_modules/@gotgenes/pi-anthropic-auth/src/index.ts",
  transportResolved: true,
  shapedProviders: [],
  configWarnings: [],
  accountPool: { entries: [], spareSlot: undefined, sessionAccount: undefined },
};

const MAX_PROFILE: AccountProfile = {
  organizationType: "claude_max",
  rateLimitTier: "default_claude_max_20x",
  seatTier: null,
  subscriptionStatus: "active",
  hasExtraUsageEnabled: false,
  email: "person@example.com",
  organizationName: "person@example.com's Organization",
};

const TEAM_PROFILE: AccountProfile = {
  organizationType: "claude_team",
  rateLimitTier: "default_raven",
  seatTier: "team_standard",
  subscriptionStatus: "active",
  hasExtraUsageEnabled: true,
  email: "worker@company.example",
  organizationName: "Company",
};

function poolEntry(
  id: string,
  overrides: Partial<Omit<AccountPoolEntry, "id">> = {},
): AccountPoolEntry {
  return {
    id,
    usage: null,
    limitedUntil: null,
    activeSessions: 0,
    ...overrides,
  };
}

/** A status command context with no UI unless overridden. */
function createStatusContext(
  overrides: {
    hasUI?: boolean;
    notify?: StatusCommandContext["ui"]["notify"];
  } = {},
): StatusCommandContext {
  return {
    hasUI: overrides.hasUI ?? false,
    ui: { notify: overrides.notify ?? vi.fn() },
    modelRegistry: { getApiKeyForProvider: () => Promise.resolve(undefined) },
    sessionManager: { getSessionId: () => "session-1" },
  };
}

describe("createStatusCommandHandler", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
    lookupProviderAccount.mockReset();
  });

  test("calls ctx.ui.notify with the report and 'info' when hasUI is true", async () => {
    const notify = vi.fn();
    const ctx = createStatusContext({ hasUI: true, notify });
    const handler = createStatusCommandHandler(() => SAMPLE);
    await handler("", ctx);
    assert.equal(notify.mock.calls.length, 1);
    const [message, type] = notify.mock.calls[0];
    assert.equal(type, "info");
    assert.match(message, /1\.2\.3/);
    assert.match(message, /resolved/i);
  });

  test("calls console.log with the report when hasUI is false", async () => {
    const ctx = createStatusContext();
    const handler = createStatusCommandHandler(() => SAMPLE);
    await handler("", ctx);
    assert.equal(consoleSpy.mock.calls.length, 1);
    const [message] = consoleSpy.mock.calls[0];
    assert.match(message, /1\.2\.3/);
  });

  test("does not call ctx.ui.notify when hasUI is false", async () => {
    const notify = vi.fn();
    const ctx = createStatusContext({ notify });
    const handler = createStatusCommandHandler(() => SAMPLE);
    await handler("", ctx);
    assert.equal(notify.mock.calls.length, 0);
  });

  // State such as project-layer providers arrives after the command is
  // registered, so the report must reflect the reader's value at call time.
  test("reads the diagnostics for the invoking session", async () => {
    const read = vi.fn((_sessionId: string) => SAMPLE);
    await createStatusCommandHandler(read)("", createStatusContext());
    assert.deepEqual(read.mock.calls, [["session-1"]]);
  });

  test("reads the diagnostics when invoked, not when created", async () => {
    let current = SAMPLE;
    const handler = createStatusCommandHandler(() => current);
    current = { ...SAMPLE, version: "9.9.9" };
    await handler("", createStatusContext());
    const [message] = consoleSpy.mock.calls[0];
    assert.match(message, /9\.9\.9/);
  });

  describe("account lookups", () => {
    test("looks up anthropic and every shaped provider, with the context's model registry", async () => {
      const ctx = createStatusContext();
      const handler = createStatusCommandHandler(() => ({
        ...SAMPLE,
        shapedProviders: [{ name: "anthropic-2", layer: "global" }],
      }));
      await handler("", ctx);
      assert.deepEqual(lookupProviderAccount.mock.calls, [
        ["anthropic", ctx.modelRegistry],
        ["anthropic-2", ctx.modelRegistry],
      ]);
    });

    test("looks up every pool account once, before shaped providers", async () => {
      const ctx = createStatusContext();
      const handler = createStatusCommandHandler(() => ({
        ...SAMPLE,
        shapedProviders: [
          { name: "anthropic-2", layer: "global" },
          { name: "work", layer: "project" },
        ],
        accountPool: {
          entries: [poolEntry("anthropic"), poolEntry("anthropic-2")],
          spareSlot: "anthropic-3",
          sessionAccount: undefined,
        },
      }));
      await handler("", ctx);
      assert.deepEqual(lookupProviderAccount.mock.calls, [
        ["anthropic", ctx.modelRegistry],
        ["anthropic-2", ctx.modelRegistry],
        ["work", ctx.modelRegistry],
      ]);
    });

    test("reports each provider's lookup under accounts", async () => {
      lookupProviderAccount.mockImplementation((provider) =>
        Promise.resolve(
          provider === "anthropic"
            ? { kind: "profile", profile: MAX_PROFILE }
            : { kind: "unavailable", reason: "HTTP 401" },
        ),
      );
      const handler = createStatusCommandHandler(() => ({
        ...SAMPLE,
        shapedProviders: [{ name: "anthropic-2", layer: "global" }],
      }));
      await handler("", createStatusContext());
      const [message] = consoleSpy.mock.calls[0];
      assert.match(message, /^ {4}anthropic: claude_max, /m);
      assert.match(message, /^ {4}anthropic-2: unavailable \(HTTP 401\)$/m);
    });

    test("omits identity without --account", async () => {
      lookupProviderAccount.mockResolvedValue({
        kind: "profile",
        profile: MAX_PROFILE,
      });
      const handler = createStatusCommandHandler(() => SAMPLE);
      await handler("", createStatusContext());
      const [message] = consoleSpy.mock.calls[0];
      assert.doesNotMatch(message, /person@example\.com/);
    });

    test("includes identity with --account", async () => {
      lookupProviderAccount.mockResolvedValue({
        kind: "profile",
        profile: MAX_PROFILE,
      });
      const handler = createStatusCommandHandler(() => SAMPLE);
      await handler("  --account ", createStatusContext());
      const [message] = consoleSpy.mock.calls[0];
      assert.match(message, /^ {4}anthropic: person@example\.com /m);
    });
  });
});

describe("formatDiagnosticsReport", () => {
  test("includes the extension version", () => {
    const report = formatDiagnosticsReport(SAMPLE);
    assert.match(report, /1\.2\.3/);
  });

  test("includes the module path", () => {
    const report = formatDiagnosticsReport(SAMPLE);
    assert.match(
      report,
      /\/root\/.pi\/agent\/node_modules\/@gotgenes\/pi-anthropic-auth\/src\/index\.ts/,
    );
  });

  test("includes a transport-resolved marker when resolved", () => {
    const report = formatDiagnosticsReport(SAMPLE);
    assert.match(report, /resolved/i);
  });

  describe("shaped providers", () => {
    test("lists only anthropic when the config names no extra providers", () => {
      const report = formatDiagnosticsReport(SAMPLE);
      assert.match(report, /^ {2}shaped providers: anthropic$/m);
    });

    test("lists each extra provider after anthropic, with the layer that named it", () => {
      const report = formatDiagnosticsReport({
        ...SAMPLE,
        shapedProviders: [
          { name: "anthropic-2", layer: "global" },
          { name: "anthropic-3", layer: "project" },
        ],
      });
      assert.match(
        report,
        /^ {2}shaped providers: anthropic, anthropic-2 \(global\), anthropic-3 \(project\)$/m,
      );
    });
  });

  describe("account pool", () => {
    test("reports a single account with the slot that adds another", () => {
      const report = formatDiagnosticsReport({
        ...SAMPLE,
        accountPool: {
          entries: [poolEntry("anthropic")],
          spareSlot: "anthropic-2",
          sessionAccount: undefined,
        },
      });
      assert.match(
        report,
        /^ {2}account pool: anthropic only \(add one with \/login anthropic-2\)$/m,
      );
    });

    test("lists each account's usage, unavailability, and active sessions", () => {
      const report = formatDiagnosticsReport({
        ...SAMPLE,
        accountPool: {
          entries: [
            poolEntry("anthropic", {
              usage: {
                fiveHour: 0.344,
                sevenDay: 0.12,
                limited: false,
                resetsAt: null,
                fiveHourResetsAt: null,
                sevenDayResetsAt: null,
              },
              activeSessions: 2,
            }),
            poolEntry("anthropic-2", {
              limitedUntil: Date.UTC(2026, 9, 7, 17, 20, 30),
              activeSessions: 1,
            }),
            poolEntry("anthropic-3", {
              usage: {
                fiveHour: null,
                sevenDay: null,
                limited: false,
                resetsAt: null,
                fiveHourResetsAt: null,
                sevenDayResetsAt: null,
              },
            }),
          ],
          spareSlot: "anthropic-4",
          sessionAccount: undefined,
        },
      });
      assert.match(
        report,
        /\n {2}account pool: 3 accounts \(add one with \/login anthropic-4\)\n {4}anthropic: 5h 34%, 7d 12%, 2 active sessions\n {4}anthropic-2: usage not yet seen, unavailable until 2026-10-07 17:20Z, 1 active session\n {4}anthropic-3: usage not reported, 0 active sessions$/,
      );
    });

    test("marks the account the session is on", () => {
      const report = formatDiagnosticsReport({
        ...SAMPLE,
        accountPool: {
          entries: [poolEntry("anthropic"), poolEntry("anthropic-2")],
          spareSlot: undefined,
          sessionAccount: "anthropic-2",
        },
      });
      assert.match(report, /^ {4}anthropic: [^\n]*sessions$/m);
      assert.doesNotMatch(report, /^ {4}anthropic: .*<- this session$/m);
      assert.match(report, /^ {4}anthropic-2: .*<- this session$/m);
    });
  });

  describe("config warnings", () => {
    test("omits the warnings block when there are none", () => {
      const report = formatDiagnosticsReport(SAMPLE);
      assert.doesNotMatch(report, /config warnings/);
    });

    test("lists each warning, indented, under a config warnings heading", () => {
      const report = formatDiagnosticsReport({
        ...SAMPLE,
        configWarnings: ["a.json: first", "b.json: second"],
      });
      assert.match(
        report,
        /\n {2}config warnings:\n {4}a\.json: first\n {4}b\.json: second$/,
      );
    });
  });

  describe("accounts", () => {
    function accountLines(
      lookup: AccountLookup,
      includeIdentity = false,
    ): string {
      return formatDiagnosticsReport(SAMPLE, {
        accounts: [{ provider: "anthropic", lookup }],
        includeIdentity,
      })
        .split("\n")
        .slice(-2)
        .join("\n");
    }

    test("omits the accounts block when no lookups were made", () => {
      const report = formatDiagnosticsReport(SAMPLE);
      assert.doesNotMatch(report, /accounts:/);
    });

    test("follows the shaped providers line and precedes config warnings", () => {
      const report = formatDiagnosticsReport(
        { ...SAMPLE, configWarnings: ["a.json: first"] },
        {
          accounts: [{ provider: "anthropic", lookup: { kind: "not-oauth" } }],
          includeIdentity: false,
        },
      );
      assert.match(
        report,
        /shaped providers: anthropic\n {2}account pool: anthropic only\n {2}accounts:\n {4}anthropic: no OAuth login\n {2}config warnings:/,
      );
    });

    test("lists a Max profile's plan fields, skipping the absent seat", () => {
      assert.equal(
        accountLines({ kind: "profile", profile: MAX_PROFILE }),
        "  accounts:\n    anthropic: claude_max, rate limit default_claude_max_20x, subscription active, extra usage off",
      );
    });

    test("lists a Team profile's seat and extra usage on", () => {
      assert.equal(
        accountLines({ kind: "profile", profile: TEAM_PROFILE }),
        "  accounts:\n    anthropic: claude_team, seat team_standard, rate limit default_raven, subscription active, extra usage on",
      );
    });

    test("never shows the email or organization name without identity", () => {
      const lines = accountLines({ kind: "profile", profile: TEAM_PROFILE });
      assert.doesNotMatch(lines, /worker@company\.example/);
      assert.doesNotMatch(lines, /Company/);
    });

    test("prefixes the email and organization name with identity", () => {
      assert.equal(
        accountLines({ kind: "profile", profile: TEAM_PROFILE }, true),
        "  accounts:\n    anthropic: worker@company.example (Company), claude_team, seat team_standard, rate limit default_raven, subscription active, extra usage on",
      );
    });

    test("reports a profile with no known fields", () => {
      const empty: AccountProfile = {
        organizationType: null,
        rateLimitTier: null,
        seatTier: null,
        subscriptionStatus: null,
        hasExtraUsageEnabled: null,
        email: null,
        organizationName: null,
      };
      assert.equal(
        accountLines({ kind: "profile", profile: empty }, true),
        "  accounts:\n    anthropic: no plan details",
      );
    });

    test("reports a provider without an OAuth login", () => {
      assert.equal(
        accountLines({ kind: "not-oauth" }),
        "  accounts:\n    anthropic: no OAuth login",
      );
    });

    test("reports an unavailable profile with its reason", () => {
      assert.equal(
        accountLines({ kind: "unavailable", reason: "timeout" }),
        "  accounts:\n    anthropic: unavailable (timeout)",
      );
    });

    test("lists providers in the order given", () => {
      const report = formatDiagnosticsReport(SAMPLE, {
        accounts: [
          { provider: "anthropic", lookup: { kind: "not-oauth" } },
          {
            provider: "anthropic-2",
            lookup: { kind: "unavailable", reason: "HTTP 500" },
          },
        ],
        includeIdentity: false,
      });
      assert.match(
        report,
        /\n {4}anthropic: no OAuth login\n {4}anthropic-2: unavailable \(HTTP 500\)$/,
      );
    });
  });

  test("reports transport as unresolved when false", () => {
    const report = formatDiagnosticsReport({
      ...SAMPLE,
      transportResolved: false,
    });
    // Should not say "resolved" in the affirmative sense; must mention not/un-resolved
    assert.match(report, /not resolved|unresolved/i);
  });
});
