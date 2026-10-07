import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import {
  fetchAccountUsage,
  parseUsageResponse,
  readUsageHeaders,
  usageLoad,
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

  test("reads both windows as fractions and the binding reset in ms", () => {
    assert.deepEqual(readUsageHeaders(new Headers(CAPTURED)), {
      fiveHour: 0,
      sevenDay: 0.01,
      limited: false,
      resetsAt: 1791393600_000,
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
      },
    );
  });

  test("returns undefined when neither window is present", () => {
    assert.equal(parseUsageResponse({ extra_usage: {} }), undefined);
    assert.equal(parseUsageResponse("nope"), undefined);
  });
});

describe("usageLoad", () => {
  test("is the most-used window", () => {
    assert.equal(
      usageLoad({
        fiveHour: 0.2,
        sevenDay: 0.7,
        limited: false,
        resetsAt: null,
      }),
      0.7,
    );
  });

  test("is 0 when nothing is known", () => {
    assert.equal(usageLoad(undefined), 0);
    assert.equal(
      usageLoad({
        fiveHour: null,
        sevenDay: null,
        limited: false,
        resetsAt: null,
      }),
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
