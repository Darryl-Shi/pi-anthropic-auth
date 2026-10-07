import type { AccountPoolEntry } from "./account-pool";

/**
 * Shows which Claude account the current session's requests go to, and how
 * much of that account's subscription is used.
 *
 * It publishes to two places, because a user sees one or the other:
 *
 * 1. pi-powerbar segments, over pi's event bus (`powerbar:register-segment`
 *    and `powerbar:update`), so no import of pi-powerbar is needed.
 *    pi-powerbar's own `sub-hourly`/`sub-weekly` segments come from
 *    pi-usage, which reads only the `anthropic` login's token, so they show
 *    the wrong account whenever the pool moves a session elsewhere.
 * 2. Pi's footer status (`ctx.ui.setStatus`), for users without pi-powerbar.
 *    pi-powerbar hides the footer, so the two never show at once.
 *
 * Usage comes from the pool, which reads it off every response's rate-limit
 * headers, so the indicator costs no request of its own.
 */
export class AccountIndicator {
  constructor(private readonly events: SegmentEventBus) {}

  /** Offers the segments in pi-powerbar's settings menu. */
  registerSegments(): void {
    for (const segment of ACCOUNT_SEGMENTS) {
      this.events.emit("powerbar:register-segment", segment);
    }
  }

  /**
   * Shows `entry`, or clears the indicator when it is `undefined` (no
   * request sent yet, or the session is not on `anthropic`).
   */
  show(entry: AccountPoolEntry | undefined, ui: StatusUI, now: number): void {
    const view = describeAccountIndicator(entry, now);
    for (const segment of view.segments) {
      this.events.emit("powerbar:update", segment);
    }
    ui.setStatus(STATUS_KEY, view.status);
  }
}

/** The slice of pi's `EventBus` the indicator publishes on. */
export interface SegmentEventBus {
  emit(channel: string, data: unknown): void;
}

/** The slice of pi's `ExtensionUIContext` the indicator writes to. */
export interface StatusUI {
  setStatus(key: string, text: string | undefined): void;
}

/** Structurally pi-powerbar's `powerbar:update` payload. */
export interface PowerbarSegmentUpdate {
  id: string;
  /** `undefined` removes the segment. */
  text: string | undefined;
  suffix?: string;
  /** Progress, 0..100. */
  bar?: number;
  barSegments?: number;
  color?: string;
}

/** What the indicator shows for one session's account. */
export interface AccountIndicatorView {
  segments: PowerbarSegmentUpdate[];
  status: string | undefined;
}

export const STATUS_KEY = "pi-anthropic-auth";

const ACCOUNT_SEGMENT = "claude-account";
const FIVE_HOUR_SEGMENT = "claude-account-5h";
const SEVEN_DAY_SEGMENT = "claude-account-week";

const ACCOUNT_SEGMENTS = [
  { id: ACCOUNT_SEGMENT, label: "Claude Account" },
  { id: FIVE_HOUR_SEGMENT, label: "Claude Account 5h" },
  { id: SEVEN_DAY_SEGMENT, label: "Claude Account Week" },
] as const;

/**
 * The segments and footer status for `entry` at `now`.  Each window's
 * segment shows its utilization as a bar and the time until it resets.
 */
export function describeAccountIndicator(
  entry: AccountPoolEntry | undefined,
  now: number,
): AccountIndicatorView {
  if (!entry) {
    return {
      segments: ACCOUNT_SEGMENTS.map(({ id }) => ({ id, text: undefined })),
      status: undefined,
    };
  }
  const windows = [
    describeWindow("5h", entry.usage?.fiveHour, entry.usage?.fiveHourResetsAt),
    describeWindow(
      "Week",
      entry.usage?.sevenDay,
      entry.usage?.sevenDayResetsAt,
    ),
  ];
  const limited =
    entry.limitedUntil === null
      ? undefined
      : `limited ${formatCountdown(entry.limitedUntil, now)}`;

  return {
    segments: [
      {
        id: ACCOUNT_SEGMENT,
        text: limited ? `${entry.id} ${limited}` : entry.id,
        color: limited ? "error" : "accent",
      },
      windowSegment(FIVE_HOUR_SEGMENT, windows[0], 5, now),
      windowSegment(SEVEN_DAY_SEGMENT, windows[1], 7, now),
    ],
    status: [
      `claude ${entry.id}`,
      ...windows.map((window) => window && windowStatus(window, now)),
      limited,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · "),
  };
}

interface UsageWindowView {
  label: string;
  percent: number;
  resetsAt: number | null;
}

function describeWindow(
  label: string,
  fraction: number | null | undefined,
  resetsAt: number | null | undefined,
): UsageWindowView | undefined {
  if (fraction === null || fraction === undefined) return undefined;
  return {
    label,
    percent: Math.round(fraction * 100),
    resetsAt: resetsAt ?? null,
  };
}

function windowSegment(
  id: string,
  window: UsageWindowView | undefined,
  barSegments: number,
  now: number,
): PowerbarSegmentUpdate {
  if (!window) return { id, text: undefined };
  const reset =
    window.resetsAt === null ? "" : ` ${formatCountdown(window.resetsAt, now)}`;
  return {
    id,
    text: `${window.label}${reset}`,
    suffix: `${window.percent}%`,
    bar: window.percent,
    barSegments,
    color: usageColor(window.percent),
  };
}

function windowStatus(window: UsageWindowView, now: number): string {
  const reset =
    window.resetsAt === null
      ? ""
      : ` (${formatCountdown(window.resetsAt, now)})`;
  return `${window.label.toLowerCase()} ${window.percent}%${reset}`;
}

/** pi-usage's thresholds, so the segments match the ones they stand in for. */
function usageColor(percent: number): string {
  if (percent > 80) return "error";
  if (percent > 60) return "warning";
  return "muted";
}

/** `42m`, `2h13m`, `3d4h`: the time from `now` until `at`. */
function formatCountdown(at: number, now: number): string {
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return joinUnits(hours, "h", minutes % 60, "m");
  return joinUnits(Math.floor(hours / 24), "d", hours % 24, "h");
}

function joinUnits(
  major: number,
  majorUnit: string,
  minor: number,
  minorUnit: string,
): string {
  return minor > 0
    ? `${major}${majorUnit}${minor}${minorUnit}`
    : `${major}${majorUnit}`;
}
