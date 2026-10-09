import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import {
  type AccountUsage,
  fetchAccountUsage,
  parseUsageResponse,
  readUsageHeaders,
  usageHeadroom,
} from "#src/account-usage";

describe("readUsageHeaders", () => {
  // Captured live from an OAuth response on 2026-10-07.
  const CAPTURED = {
    "anthropic-ratelimit-unified-5h-reset": "1791393600",
    "anthropic-ratelimit-unified-5h-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.0",
    "anthropic-ratelimit-unified-7d-reset": "1791871200",
    "anthropic-ratelimit-unified-7d-status": "allowed",
    "anthropic-ratelimit-unified-7d-utilization": "0.01",
    "anthropic-ratelimit-unified-representative-claim": "five_hour",
    "anthropic-ratelimit-unified-reset": "1791393600",
    "anthropic-ratelimit-unified-status": "allowed",
  };

  test("reads both windows as fractions and every reset in ms", () => {
    assert.deepEqual(readUsageHeaders(new Headers(CAPTURED)), {
      fiveHour: 0,
      sevenDay: 0.01,
      limited: false,
      resetsAt: 1791393600_000,
      fiveHourResetsAt: 1791393600_000,
      sevenDayResetsAt: 1791871200_000,
    });
  });

  test("reports a rejected status as limited", () => {
    const headers = new Headers({
      ...CAPTURED,
      "anthropic-ratelimit-unified-status": "rejected",
    });
    assert.equal(readUsageHeaders(headers)?.limited, true);
  });

  test("returns undefined for a response with no unified headers", () => {
    assert.equal(
      readUsageHeaders(new Headers({ "content-type": "text/plain" })),
      undefined,
    );
  });

  test("reads malformed values as unknown rather than failing", () => {
    const headers = new Headers({
      "anthropic-ratelimit-unified-5h-utilization": "lots",
      "anthropic-ratelimit-unified-7d-utilization": "2.5",
      "anthropic-ratelimit-unified-reset": "soon",
    });
    assert.deepEqual(readUsageHeaders(headers), {
      fiveHour: null,
      sevenDay: 1,
      limited: false,
      resetsAt: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
  });
});

describe("parseUsageResponse", () => {
  test("scales the endpoint's percentages to fractions", () => {
    // Shape captured live from GET /api/oauth/usage on 2026-10-07.
    assert.deepEqual(
      parseUsageResponse({
        five_hour: {
          utilization: 0,
          resets_at: "2026-10-07T17:20:00.067766+00:00",
        },
        seven_day: {
          utilization: 1,
          resets_at: "2026-10-13T06:00:00.067794+00:00",
        },
        seven_day_opus: null,
      }),
      {
        fiveHour: 0,
        sevenDay: 0.01,
        limited: false,
        resetsAt: Date.parse("2026-10-13T06:00:00.067794+00:00"),
        fiveHourResetsAt: Date.parse("2026-10-07T17:20:00.067766+00:00"),
        sevenDayResetsAt: Date.parse("2026-10-13T06:00:00.067794+00:00"),
      },
    );
  });

  test("reports a full window as limited, resetting when that window does", () => {
    assert.deepEqual(
      parseUsageResponse({
        five_hour: { utilization: 100, resets_at: "2026-10-07T17:20:00Z" },
        seven_day: { utilization: 40, resets_at: "2026-10-13T06:00:00Z" },
      }),
      {
        fiveHour: 1,
        sevenDay: 0.4,
        limited: true,
        resetsAt: Date.parse("2026-10-07T17:20:00Z"),
        fiveHourResetsAt: Date.parse("2026-10-07T17:20:00Z"),
        sevenDayResetsAt: Date.parse("2026-10-13T06:00:00Z"),
      },
    );
  });

  test("returns undefined when neither window is present", () => {
    assert.equal(parseUsageResponse({ extra_usage: {} }), undefined);
    assert.equal(parseUsageResponse("nope"), undefined);
  });
});

describe("usageHeadroom", () => {
  const NOW = Date.parse("2026-10-07T12:00:00Z");
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;

  function usage(overrides: Partial<AccountUsage> = {}): AccountUsage {
    return {
      fiveHour: null,
      sevenDay: null,
      limited: false,
      resetsAt: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
      ...overrides,
    };
  }

  test("is the unused share of the tighter window when no reset is known", () => {
    assert.equal(
      usageHeadroom(usage({ fiveHour: 0.2, sevenDay: 0.75 }), NOW),
      0.25,
    );
  });

  test("is 1, a fresh window, when nothing is known", () => {
    assert.equal(usageHeadroom(undefined, NOW), 1);
    assert.equal(usageHeadroom(usage(), NOW), 1);
  });

  test("divides the unused share by the share of the window left", () => {
    // 60% unused with 2.5 of 5 hours left: 1.2x the even pace is sustainable.
    assert.equal(
      usageHeadroom(
        usage({ fiveHour: 0.4, fiveHourResetsAt: NOW + 2.5 * HOUR }),
        NOW,
      ),
      1.2,
    );
  });

  test("ranks a heavily used window that resets soon above a lightly used one that does not", () => {
    const resetsSoon = usageHeadroom(
      usage({ fiveHour: 0.8, fiveHourResetsAt: NOW + 0.5 * HOUR }),
      NOW,
    );
    const resetsLate = usageHeadroom(
      usage({ fiveHour: 0.4, fiveHourResetsAt: NOW + 4.5 * HOUR }),
      NOW,
    );
    assert.ok(resetsSoon > resetsLate, `${resetsSoon} <= ${resetsLate}`);
  });

  test("is bound by the 7-day window when it is tighter", () => {
    // 5h: 0.9 / 0.1 = 9; 7d: 0.25 / (3.5 / 7) = 0.5.
    assert.equal(
      usageHeadroom(
        usage({
          fiveHour: 0.1,
          fiveHourResetsAt: NOW + 0.5 * HOUR,
          sevenDay: 0.75,
          sevenDayResetsAt: NOW + 3.5 * DAY,
        }),
        NOW,
      ),
      0.5,
    );
  });

  test("treats a window whose reset has passed as fresh", () => {
    assert.equal(
      usageHeadroom(usage({ fiveHour: 0.95, fiveHourResetsAt: NOW }), NOW),
      1,
    );
  });

  test("caps a reset moments away at 1% of the window", () => {
    assert.equal(
      usageHeadroom(usage({ fiveHour: 0.5, fiveHourResetsAt: NOW + 1 }), NOW),
      50,
    );
  });

  test("never credits more than a full window left", () => {
    assert.equal(
      usageHeadroom(
        usage({ fiveHour: 0.5, fiveHourResetsAt: NOW + 10 * HOUR }),
        NOW,
      ),
      0.5,
    );
  });

  test("is 0 for an exhausted window that has not reset", () => {
    assert.equal(
      usageHeadroom(usage({ fiveHour: 1, fiveHourResetsAt: NOW + HOUR }), NOW),
      0,
    );
  });
});

describe("fetchAccountUsage", () => {
  test("asks the usage endpoint with the account's bearer token", async () => {
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ five_hour: { utilization: 25, resets_at: null } }),
        ),
      ),
    );

    const usage = await fetchAccountUsage(
      "sk-ant-oat01-a",
      fetchMock as unknown as typeof fetch,
    );

    assert.deepEqual(usage, {
      fiveHour: 0.25,
      sevenDay: null,
      limited: false,
      resetsAt: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
    assert.deepEqual(init?.headers, {
      Authorization: "Bearer sk-ant-oat01-a",
      "anthropic-beta": "oauth-2025-04-20",
    });
  });

  test("is undefined on a non-200 or a network failure", async () => {
    const forbidden = () =>
      Promise.resolve(new Response("{}", { status: 403 }));
    const offline = () => Promise.reject(new Error("offline"));
    assert.equal(
      await fetchAccountUsage("t", forbidden as unknown as typeof fetch),
      undefined,
    );
    assert.equal(
      await fetchAccountUsage("t", offline as unknown as typeof fetch),
      undefined,
    );
  });
});
