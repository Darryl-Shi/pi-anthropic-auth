import type { AccountPoolEntry } from "./account-pool";
import {
  type AccountLookup,
  type AccountProfile,
  lookupProviderAccount,
  type ProviderCredentials,
} from "./account-profile";
import type { AccountUsage } from "./account-usage";
import type { ShapedProvider } from "./extra-provider-shaping";

/**
 * Diagnostic information surfaced via the `/anthropic-auth:status` command.
 */
export interface ExtensionDiagnostics {
  /** Published version read from `package.json` at load time. */
  version: string;
  /** Absolute filesystem path of the loaded `src/index.ts` entry module. */
  modulePath: string;
  /**
   * Whether the built-in Anthropic `streamSimple` transport resolved
   * successfully.  Always `true` when the command is reachable: a resolution
   * failure aborts extension load before `registerCommand` runs.
   */
  transportResolved: boolean;
  /**
   * Extra providers the config files named, each registered with the shaping
   * wrapper.  `anthropic` is always shaped and is not listed here.
   */
  shapedProviders: readonly ShapedProvider[];
  /** Problems found reading the config files, one line each. */
  configWarnings: readonly string[];
  /** The Claude accounts `anthropic` requests are spread across. */
  accountPool: AccountPoolReport;
}

/** The account pool block of the report. */
export interface AccountPoolReport {
  /** Every account in pool order, `anthropic` first. */
  entries: readonly AccountPoolEntry[];
  /** The slot `/login` offers for another account, if any. */
  spareSlot: string | undefined;
}

/**
 * Narrow subset of `ExtensionCommandContext` the status handler actually uses.
 *
 * Accepting this interface instead of the full `ExtensionCommandContext` keeps
 * `createStatusCommandHandler` free of the Pi SDK so it is trivially testable
 * with a plain fake.  The real `ExtensionCommandContext` is structurally
 * assignable here, so no cast is needed at the registration call site.
 */
export interface StatusCommandContext {
  /** Whether dialog-capable UI is available (true in TUI and RPC modes). */
  hasUI: boolean;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  /** Resolves each provider's stored credential for the account lookup. */
  modelRegistry: ProviderCredentials;
}

/** One provider's account lookup, as the report lists it. */
export interface ProviderAccount {
  provider: string;
  lookup: AccountLookup;
}

/** The accounts block of the report, fetched per invocation. */
export interface AccountsReport {
  accounts: readonly ProviderAccount[];
  /**
   * Whether to show the email and organization name.  Off by default so a
   * pasted report does not identify the user.
   */
  includeIdentity: boolean;
}

/** The argument that opts the report in to identifying fields. */
const ACCOUNT_ARGUMENT = "--account";

/** An argument completion, structurally Pi's `AutocompleteItem`. */
interface ArgumentCompletion {
  value: string;
  label: string;
  description: string;
}

/**
 * Argument completions for the status command: `--account` while the typed
 * prefix still matches it, otherwise none.
 */
export function statusArgumentCompletions(
  argumentPrefix: string,
): ArgumentCompletion[] | null {
  if (!ACCOUNT_ARGUMENT.startsWith(argumentPrefix.trim())) return null;
  return [
    {
      value: ACCOUNT_ARGUMENT,
      label: ACCOUNT_ARGUMENT,
      description: "Also show each account's email and organization name",
    },
  ];
}

/**
 * Returns a compact multi-line diagnostics report suitable for display in a
 * Pi TUI notification or printed to stdout.
 */
export function formatDiagnosticsReport(
  d: ExtensionDiagnostics,
  accounts?: AccountsReport,
): string {
  const transport = d.transportResolved ? "resolved" : "not resolved";
  return [
    "pi-anthropic-auth diagnostics",
    `  version: ${d.version}`,
    `  module:  ${d.modulePath}`,
    `  built-in Anthropic transport: ${transport}`,
    formatShapedProviders(d.shapedProviders),
    ...formatAccountPool(d.accountPool),
    ...formatAccounts(accounts),
    ...formatConfigWarnings(d.configWarnings),
  ].join("\n");
}

function formatShapedProviders(providers: readonly ShapedProvider[]): string {
  const shaped = [
    "anthropic",
    ...providers.map(({ name, layer }) => `${name} (${layer})`),
  ];
  return `  shaped providers: ${shaped.join(", ")}`;
}

function formatAccountPool({
  entries,
  spareSlot,
}: AccountPoolReport): string[] {
  const addHint = spareSlot ? ` (add one with /login ${spareSlot})` : "";
  if (entries.length < 2) {
    return [`  account pool: anthropic only${addHint}`];
  }
  return [
    `  account pool: ${entries.length} accounts${addHint}`,
    ...entries.map((entry) => `    ${entry.id}: ${describePoolEntry(entry)}`),
  ];
}

function describePoolEntry(entry: AccountPoolEntry): string {
  const sessions = `${entry.activeSessions} active ${entry.activeSessions === 1 ? "session" : "sessions"}`;
  return [
    describeUsage(entry.usage),
    entry.limitedUntil === null
      ? null
      : `unavailable until ${formatInstant(entry.limitedUntil)}`,
    sessions,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

function describeUsage(usage: AccountUsage | null): string {
  if (usage === null) return "usage not yet seen";
  const windows = [
    usage.fiveHour === null ? null : `5h ${formatPercent(usage.fiveHour)}`,
    usage.sevenDay === null ? null : `7d ${formatPercent(usage.sevenDay)}`,
  ].filter((part): part is string => part !== null);
  return windows.length === 0 ? "usage not reported" : windows.join(", ");
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** `2026-10-07 17:20Z`: minute precision, UTC, so reports are deterministic. */
function formatInstant(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

function formatAccounts(report: AccountsReport | undefined): string[] {
  if (report === undefined) return [];
  return [
    "  accounts:",
    ...report.accounts.map(
      ({ provider, lookup }) =>
        `    ${provider}: ${describeLookup(lookup, report.includeIdentity)}`,
    ),
  ];
}

function describeLookup(
  lookup: AccountLookup,
  includeIdentity: boolean,
): string {
  switch (lookup.kind) {
    case "not-oauth":
      return "no OAuth login";
    case "unavailable":
      return `unavailable (${lookup.reason})`;
    case "profile":
      return describeProfile(lookup.profile, includeIdentity);
  }
}

function describeProfile(
  profile: AccountProfile,
  includeIdentity: boolean,
): string {
  const parts = [
    ...(includeIdentity ? [describeIdentity(profile)] : []),
    profile.organizationType,
    profile.seatTier && `seat ${profile.seatTier}`,
    profile.rateLimitTier && `rate limit ${profile.rateLimitTier}`,
    profile.subscriptionStatus && `subscription ${profile.subscriptionStatus}`,
    profile.hasExtraUsageEnabled === null
      ? null
      : `extra usage ${profile.hasExtraUsageEnabled ? "on" : "off"}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length === 0 ? "no plan details" : parts.join(", ");
}

function describeIdentity({ email, organizationName }: AccountProfile): string {
  return [email, organizationName && `(${organizationName})`]
    .filter(Boolean)
    .join(" ");
}

function formatConfigWarnings(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return [];
  return ["  config warnings:", ...warnings.map((warning) => `    ${warning}`)];
}

/**
 * Returns a command handler that routes the diagnostics report to the Pi UI
 * notification system when a UI is available, or falls back to `console.log`
 * for headless (`-p`) and RPC invocations.
 *
 * @param readDiagnostics Called on every invocation, because some of what the
 *   report shows (project-layer providers) only becomes known after the
 *   command is registered.
 */
export function createStatusCommandHandler(
  readDiagnostics: () => ExtensionDiagnostics,
): (args: string, ctx: StatusCommandContext) => Promise<void> {
  return async (args, ctx) => {
    const diagnostics = readDiagnostics();
    const providers = Array.from(
      new Set([
        "anthropic",
        ...diagnostics.accountPool.entries.map(({ id }) => id),
        ...diagnostics.shapedProviders.map(({ name }) => name),
      ]),
    );
    // Lookups run in parallel, so the report waits for one round trip.
    const accounts = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        lookup: await lookupProviderAccount(provider, ctx.modelRegistry),
      })),
    );
    const includeIdentity = args.trim().split(/\s+/).includes(ACCOUNT_ARGUMENT);
    emitReport(
      formatDiagnosticsReport(diagnostics, { accounts, includeIdentity }),
      ctx,
    );
  };
}

function emitReport(report: string, ctx: StatusCommandContext): void {
  if (ctx.hasUI) {
    ctx.ui.notify(report, "info");
  } else {
    console.log(report);
  }
}
