import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";
import { AccountPool } from "#src/account-pool";
import { createAccountRoutingFetch } from "#src/account-routing-fetch";
import type { AccountUsage } from "#src/account-usage";

const PRIMARY_TOKEN = "sk-ant-oat01-primary";
const SECOND_TOKEN = "sk-ant-oat01-second";
const URL = "https://api.anthropic.com/v1/messages";

type Dispatch = (input: string, init?: RequestInit) => Promise<Response>;

function sentToken(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get("authorization");
}

function rateLimitHeaders(
  utilization: string,
  status = "allowed",
  reset = "1791393600",
): Record<string, string> {
  return {
    "anthropic-ratelimit-unified-5h-utilization": utilization,
    "anthropic-ratelimit-unified-status": status,
    "anthropic-ratelimit-unified-reset": reset,
  };
}

describe("createAccountRoutingFetch", () => {
  let accounts: string[];
  let usageByToken: Map<string, AccountUsage>;
  let pool: AccountPool;
  let baseFetch: ReturnType<typeof vi.fn<Dispatch>>;

  function routedFetch(sessionId: string | undefined = "s1") {
    return createAccountRoutingFetch({
      pool,
      sessionId,
      primaryToken: PRIMARY_TOKEN,
      baseFetch: baseFetch as unknown as typeof fetch,
    }) as unknown as Dispatch;
  }

  const init = (): RequestInit => ({
    method: "POST",
    headers: {
      authorization: `Bearer ${PRIMARY_TOKEN}`,
      "user-agent": "claude-cli/2.1.280",
    },
    body: '{"model":"claude-opus-5-5"}',
  });

  beforeEach(() => {
    accounts = ["anthropic", "anthropic-2"];
    usageByToken = new Map();
    pool = new AccountPool({
      fetchUsage: (token) => Promise.resolve(usageByToken.get(token)),
    });
    pool.attach({
      accounts: () => accounts,
      getApiKeyForProvider: () => Promise.resolve(SECOND_TOKEN),
    });
    baseFetch = vi.fn<Dispatch>(() => Promise.resolve(new Response("ok")));
  });

  test("leaves the request untouched with a single account", async () => {
    accounts = ["anthropic"];
    const sent = init();
    await routedFetch()(URL, sent);
    assert.equal(baseFetch.mock.calls[0]?.[1], sent);
  });

  test("leaves the request untouched when the session lands on anthropic", async () => {
    usageByToken.set(SECOND_TOKEN, {
      fiveHour: 0.9,
      sevenDay: null,
      limited: false,
      resetsAt: null,
    });
    const sent = init();
    await routedFetch()(URL, sent);
    assert.equal(baseFetch.mock.calls[0]?.[1], sent);
  });

  test("swaps only the bearer token when the session lands on another account", async () => {
    usageByToken.set(PRIMARY_TOKEN, {
      fiveHour: 0.9,
      sevenDay: null,
      limited: false,
      resetsAt: null,
    });
    await routedFetch()(URL, init());

    const [, sent] = baseFetch.mock.calls[0] ?? [];
    assert.equal(sentToken(sent), `Bearer ${SECOND_TOKEN}`);
    assert.equal(
      new Headers(sent?.headers).get("user-agent"),
      "claude-cli/2.1.280",
    );
    assert.equal(sent?.body, '{"model":"claude-opus-5-5"}');
  });

  test("feeds each response's rate-limit headers back to the pool", async () => {
    baseFetch.mockResolvedValue(
      new Response("ok", { headers: rateLimitHeaders("0.42") }),
    );
    await routedFetch()(URL, init());
    assert.equal(pool.entries()[0]?.usage?.fiveHour, 0.42);
  });

  test("pins requests without a session id to one shared account", async () => {
    await routedFetch(undefined)(URL, init());
    await routedFetch(undefined)(URL, init());
    assert.deepEqual(
      baseFetch.mock.calls.map(([, sent]) => sentToken(sent)),
      [`Bearer ${PRIMARY_TOKEN}`, `Bearer ${PRIMARY_TOKEN}`],
    );
  });

  describe("on a 429", () => {
    test("retries once on another account and keeps the session there", async () => {
      baseFetch.mockResolvedValueOnce(
        new Response("limited", {
          status: 429,
          headers: rateLimitHeaders("1.0", "rejected"),
        }),
      );

      const response = await routedFetch()(URL, init());
      await routedFetch()(URL, init());

      assert.equal(response.status, 200);
      assert.deepEqual(
        baseFetch.mock.calls.map(([, sent]) => sentToken(sent)),
        [
          `Bearer ${PRIMARY_TOKEN}`,
          `Bearer ${SECOND_TOKEN}`,
          `Bearer ${SECOND_TOKEN}`,
        ],
      );
      assert.equal(pool.entries()[0]?.limitedUntil, 1791393600_000);
    });

    test("surfaces the 429 when no other account is usable", async () => {
      accounts = ["anthropic", "anthropic-2"];
      pool.observe("anthropic-2", {
        fiveHour: 1,
        sevenDay: null,
        limited: true,
        resetsAt: Date.now() + 60_000,
      });
      baseFetch.mockResolvedValueOnce(new Response("limited", { status: 429 }));

      const response = await routedFetch()(URL, init());

      assert.equal(response.status, 429);
      assert.equal(baseFetch.mock.calls.length, 1);
    });

    test("does not chase a second 429", async () => {
      baseFetch.mockResolvedValue(new Response("limited", { status: 429 }));
      const response = await routedFetch()(URL, init());
      assert.equal(response.status, 429);
      assert.equal(baseFetch.mock.calls.length, 2);
    });
  });

  describe("on a 401", () => {
    test("sets the account aside and retries on another", async () => {
      baseFetch.mockResolvedValueOnce(
        new Response("invalid token", { status: 401 }),
      );

      const response = await routedFetch()(URL, init());

      assert.equal(response.status, 200);
      assert.deepEqual(
        baseFetch.mock.calls.map(([, sent]) => sentToken(sent)),
        [`Bearer ${PRIMARY_TOKEN}`, `Bearer ${SECOND_TOKEN}`],
      );
      assert.notEqual(pool.entries()[0]?.limitedUntil, null);
    });
  });

  describe("on other errors", () => {
    test("returns them unchanged without moving the session", async () => {
      baseFetch.mockResolvedValue(new Response("bad", { status: 400 }));
      const response = await routedFetch()(URL, init());
      assert.equal(response.status, 400);
      assert.equal(baseFetch.mock.calls.length, 1);
      assert.equal(pool.entries()[0]?.limitedUntil, null);
    });
  });
});
