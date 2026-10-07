import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import {
  AccountIndicator,
  describeAccountIndicator,
  STATUS_KEY,
} from "#src/account-indicator";
import type { AccountPoolEntry } from "#src/account-pool";
import type { AccountUsage } from "#src/account-usage";

const NOW = Date.UTC(2026, 9, 7, 12, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function usage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return {
    fiveHour: 0.42,
    sevenDay: 0.13,
    limited: false,
    resetsAt: null,
    fiveHourResetsAt: NOW + 2 * HOUR + 13 * MINUTE,
    sevenDayResetsAt: NOW + 3 * 24 * HOUR + 4 * HOUR,
    ...overrides,
  };
}

function entry(overrides: Partial<AccountPoolEntry> = {}): AccountPoolEntry {
  return {
    id: "anthropic-2",
    usage: usage(),
    limitedUntil: null,
    activeSessions: 1,
    ...overrides,
  };
}

describe("describeAccountIndicator", () => {
  test("shows the account and each window's usage and reset", () => {
    assert.deepEqual(describeAccountIndicator(entry(), NOW), {
      segments: [
        { id: "claude-account", text: "anthropic-2", color: "accent" },
        {
          id: "claude-account-5h",
          text: "5h 2h13m",
          suffix: "42%",
          bar: 42,
          barSegments: 5,
          color: "muted",
        },
        {
          id: "claude-account-week",
          text: "Week 3d4h",
          suffix: "13%",
          bar: 13,
          barSegments: 7,
          color: "muted",
        },
      ],
      status: "claude anthropic-2 · 5h 42% (2h13m) · week 13% (3d4h)",
    });
  });

  test("colors a window by how full it is", () => {
    const { segments } = describeAccountIndicator(
      entry({ usage: usage({ fiveHour: 0.81, sevenDay: 0.61 }) }),
      NOW,
    );
    assert.equal(segments[1]?.color, "error");
    assert.equal(segments[2]?.color, "warning");
  });

  test("marks a rate-limited account with the time until it recovers", () => {
    const view = describeAccountIndicator(
      entry({ limitedUntil: NOW + 25 * MINUTE }),
      NOW,
    );
    assert.deepEqual(view.segments[0], {
      id: "claude-account",
      text: "anthropic-2 limited 25m",
      color: "error",
    });
    assert.match(view.status ?? "", / · limited 25m$/);
  });

  test("shows only the account before its usage is known", () => {
    const view = describeAccountIndicator(entry({ usage: null }), NOW);
    assert.deepEqual(view.segments.slice(1), [
      { id: "claude-account-5h", text: undefined },
      { id: "claude-account-week", text: undefined },
    ]);
    assert.equal(view.status, "claude anthropic-2");
  });

  test("omits a window's reset when it is not reported", () => {
    const view = describeAccountIndicator(
      entry({
        usage: usage({ fiveHourResetsAt: null, sevenDay: null }),
      }),
      NOW,
    );
    assert.equal(view.segments[1]?.text, "5h");
    assert.equal(view.segments[2]?.text, undefined);
    assert.equal(view.status, "claude anthropic-2 · 5h 42%");
  });

  test("formats short and whole-unit countdowns", () => {
    const view = describeAccountIndicator(
      entry({
        usage: usage({
          fiveHourResetsAt: NOW + 3 * HOUR,
          sevenDayResetsAt: NOW - MINUTE,
        }),
      }),
      NOW,
    );
    assert.equal(view.segments[1]?.text, "5h 3h");
    assert.equal(view.segments[2]?.text, "Week now");
  });

  test("clears every segment and the status without an account", () => {
    assert.deepEqual(describeAccountIndicator(undefined, NOW), {
      segments: [
        { id: "claude-account", text: undefined },
        { id: "claude-account-5h", text: undefined },
        { id: "claude-account-week", text: undefined },
      ],
      status: undefined,
    });
  });
});

describe("AccountIndicator", () => {
  test("registers its segments with pi-powerbar", () => {
    const emit = vi.fn();
    new AccountIndicator({ emit }).registerSegments();
    assert.deepEqual(emit.mock.calls, [
      [
        "powerbar:register-segment",
        { id: "claude-account", label: "Claude Account" },
      ],
      [
        "powerbar:register-segment",
        { id: "claude-account-5h", label: "Claude Account 5h" },
      ],
      [
        "powerbar:register-segment",
        { id: "claude-account-week", label: "Claude Account Week" },
      ],
    ]);
  });

  test("publishes every segment update and the footer status", () => {
    const emit = vi.fn();
    const setStatus = vi.fn();
    new AccountIndicator({ emit }).show(entry(), { setStatus }, NOW);

    const view = describeAccountIndicator(entry(), NOW);
    assert.deepEqual(
      emit.mock.calls,
      view.segments.map((segment) => ["powerbar:update", segment]),
    );
    assert.deepEqual(setStatus.mock.calls, [[STATUS_KEY, view.status]]);
  });
});
