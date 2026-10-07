/**
 * Subscription usage for one Anthropic OAuth account, read from either of the
 * two places Anthropic reports it.
 *
 * Every OAuth response carries `anthropic-ratelimit-unified-*` headers, with
 * utilization as a 0..1 fraction.  `GET /api/oauth/usage` reports the same
 * windows as a 0..100 percentage without spending quota.  Both formats were
 * measured live on 2026-10-07.  Both are undocumented, so every field is
 * optional and a malformed value reads as unknown.
 */
export interface AccountUsage {
  /** 5-hour window utilization as a 0..1 fraction, when reported. */
  fiveHour: number | null;
  /** 7-day window utilization as a 0..1 fraction, when reported. */
  sevenDay: number | null;
  /** Whether Anthropic reported this account as rate limited. */
  limited: boolean;
  /** When the binding window resets, in epoch milliseconds, when reported. */
  resetsAt: number | null;
  /** When the 5-hour window resets, in epoch milliseconds, when reported. */
  fiveHourResetsAt: number | null;
  /** When the 7-day window resets, in epoch milliseconds, when reported. */
  sevenDayResetsAt: number | null;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const USAGE_TIMEOUT_MS = 3000;

const HEADER = "anthropic-ratelimit-unified";
/** Year 5138: anything later is not a reset time, and would not format. */
const MAX_EPOCH_SECONDS = 1e11;

/**
 * The account's load for balancing: its most-used window, or 0 when neither
 * window is known.
 */
export function usageLoad(usage: AccountUsage | undefined): number {
  if (!usage) return 0;
  return Math.max(usage.fiveHour ?? 0, usage.sevenDay ?? 0);
}

/**
 * Reads the unified rate-limit headers off a response.  Returns `undefined`
 * when the response carries none of them (an API-key response, a proxy).
 */
export function readUsageHeaders(headers: Headers): AccountUsage | undefined {
  const fiveHour = readFraction(headers.get(`${HEADER}-5h-utilization`));
  const sevenDay = readFraction(headers.get(`${HEADER}-7d-utilization`));
  const status = headers.get(`${HEADER}-status`);
  if (fiveHour === null && sevenDay === null && status === null) {
    return undefined;
  }
  return {
    fiveHour,
    sevenDay,
    limited: status === "rejected",
    resetsAt: readEpochSeconds(headers.get(`${HEADER}-reset`)),
    fiveHourResetsAt: readEpochSeconds(headers.get(`${HEADER}-5h-reset`)),
    sevenDayResetsAt: readEpochSeconds(headers.get(`${HEADER}-7d-reset`)),
  };
}

/**
 * Parses a `GET /api/oauth/usage` body.  Its utilization is a percentage, so
 * it is scaled to the header's fraction.
 */
export function parseUsageResponse(body: unknown): AccountUsage | undefined {
  if (!isRecord(body)) return undefined;
  const fiveHour = readWindow(body.five_hour);
  const sevenDay = readWindow(body.seven_day);
  if (!fiveHour && !sevenDay) return undefined;
  const windows = [fiveHour, sevenDay].filter(
    (window): window is UsageWindow => window !== undefined,
  );
  const binding = windows.reduce((a, b) =>
    (b.utilization ?? 0) > (a.utilization ?? 0) ? b : a,
  );
  return {
    fiveHour: fiveHour?.utilization ?? null,
    sevenDay: sevenDay?.utilization ?? null,
    limited: windows.some((window) => (window.utilization ?? 0) >= 1),
    resetsAt: binding.resetsAt,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDayResetsAt: sevenDay?.resetsAt ?? null,
  };
}

/**
 * Asks Anthropic for the account's usage.  Never throws: any failure (no
 * network, timeout, a non-200, an unexpected body) is `undefined`.
 */
export async function fetchAccountUsage(
  token: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<AccountUsage | undefined> {
  try {
    const response = await fetchFn(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA,
      },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    return parseUsageResponse(await response.json());
  } catch {
    return undefined;
  }
}

interface UsageWindow {
  utilization: number | null;
  resetsAt: number | null;
}

function readWindow(value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const percent = value.utilization;
  const resets = value.resets_at;
  const resetsAt = typeof resets === "string" ? Date.parse(resets) : Number.NaN;
  return {
    utilization:
      typeof percent === "number" && Number.isFinite(percent)
        ? clampFraction(percent / 100)
        : null,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
  };
}

function readFraction(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampFraction(parsed) : null;
}

function readEpochSeconds(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < MAX_EPOCH_SECONDS
    ? parsed * 1000
    : null;
}

function clampFraction(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
