import assert from "node:assert/strict";
import type { Mock } from "vitest";
import { beforeEach, describe, test, vi } from "vitest";
import { AccountPool } from "#src/account-pool";
import type { AccountUsage } from "#src/account-usage";

const PRIMARY_TOKEN = "sk-ant-oat01-primary";
const SECOND_TOKEN = "sk-ant-oat01-second";
const THIRD_TOKEN = "sk-ant-oat01-third";

function usage(
  load: number,
  overrides: Partial<AccountUsage> = {},
): AccountUsage {
  return {
    fiveHour: load,
    sevenDay: null,
    limited: false,
    resetsAt: null,
    ...overrides,
  };
}

describe("AccountPool", () => {
  let now: number;
  let accounts: string[];
  let tokens: Map<string, string | undefined>;
  let usageByToken: Map<string, AccountUsage | undefined>;
  let fetchUsage: Mock<(token: string) => Promise<AccountUsage | undefined>>;
  let pool: AccountPool;

  beforeEach(() => {
    now = 1_000_000;
    accounts = ["anthropic", "anthropic-2"];
    tokens = new Map([["anthropic-2", SECOND_TOKEN]]);
    usageByToken = new Map();
    fetchUsage = vi.fn((token: string) =>
      Promise.resolve(usageByToken.get(token)),
    );
    pool = new AccountPool({ fetchUsage, now: () => now });
    pool.attach({
      accounts: () => accounts,
      getApiKeyForProvider: (provider) => Promise.resolve(tokens.get(provider)),
    });
  });

  describe("an inactive pool", () => {
    test("passes through before it is attached", async () => {
      const detached = new AccountPool({ fetchUsage });
      assert.equal(await detached.acquire("s1", PRIMARY_TOKEN), undefined);
    });

    test("passes through with a single account, asking for no usage", async () => {
      accounts = ["anthropic"];
      assert.equal(await pool.acquire("s1", PRIMARY_TOKEN), undefined);
      assert.equal(fetchUsage.mock.calls.length, 0);
    });

    test("keeps a session started on one account there when a second is added", async () => {
      accounts = ["anthropic"];
      await pool.acquire("s1", PRIMARY_TOKEN);
      accounts = ["anthropic", "anthropic-2"];
      usageByToken.set(PRIMARY_TOKEN, usage(0.9));

      assert.equal(
        (await pool.acquire("s1", PRIMARY_TOKEN))?.accountId,
        "anthropic",
      );
    });

    test("routes to the primary when no extra account has an OAuth token", async () => {
      tokens.set("anthropic-2", "sk-ant-api03-not-oauth");
      assert.deepEqual(await pool.acquire("s1", PRIMARY_TOKEN), {
        accountId: "anthropic",
        token: PRIMARY_TOKEN,
      });
    });
  });

  describe("assignment", () => {
    test("pins a new session to the least-used account", async () => {
      usageByToken.set(PRIMARY_TOKEN, usage(0.6));
      usageByToken.set(SECOND_TOKEN, usage(0.1));

      assert.deepEqual(await pool.acquire("s1", PRIMARY_TOKEN), {
        accountId: "anthropic-2",
        token: SECOND_TOKEN,
      });
    });

    test("spreads sessions that start together across equally used accounts", async () => {
      const first = await pool.acquire("s1", PRIMARY_TOKEN);
      const second = await pool.acquire("s2", PRIMARY_TOKEN);
      assert.deepEqual(
        [first?.accountId, second?.accountId],
        ["anthropic", "anthropic-2"],
      );
    });

    test("asks for each account's usage once while it is fresh", async () => {
      await pool.acquire("s1", PRIMARY_TOKEN);
      await pool.acquire("s2", PRIMARY_TOKEN);
      assert.equal(fetchUsage.mock.calls.length, 2);

      now += 5 * 60_000;
      await pool.acquire("s3", PRIMARY_TOKEN);
      assert.equal(fetchUsage.mock.calls.length, 4);
    });

    test("prefers usage observed on responses over a stale guess", async () => {
      pool.observe("anthropic", usage(0.9));
      pool.observe("anthropic-2", usage(0.3));
      assert.equal(
        (await pool.acquire("s1", PRIMARY_TOKEN))?.accountId,
        "anthropic-2",
      );
      assert.equal(fetchUsage.mock.calls.length, 0);
    });
  });

  describe("concurrency", () => {
    test("overlapping first requests of one session land on one account", async () => {
      const leases = await Promise.all([
        pool.acquire("s1", PRIMARY_TOKEN),
        pool.acquire("s1", PRIMARY_TOKEN),
      ]);
      assert.equal(leases[0]?.accountId, leases[1]?.accountId);
      assert.equal(
        pool.entries().reduce((n, e) => n + e.activeSessions, 0),
        1,
      );
    });

    test("sessions starting together share one usage probe per account", async () => {
      await Promise.all([
        pool.acquire("s1", PRIMARY_TOKEN),
        pool.acquire("s2", PRIMARY_TOKEN),
        pool.acquire("s3", PRIMARY_TOKEN),
      ]);
      assert.deepEqual(fetchUsage.mock.calls.map(([token]) => token).sort(), [
        PRIMARY_TOKEN,
        SECOND_TOKEN,
      ]);
    });

    test("sessions starting together all wait for fresh usage", async () => {
      // Hold the probes open until both sessions are waiting on them, so the
      // second session cannot be placed against usage not yet read.
      const gate = Promise.withResolvers<undefined>();
      fetchUsage.mockImplementation(async (token) => {
        await gate.promise;
        return token === PRIMARY_TOKEN ? usage(0.9) : usage(0.1);
      });
      const pending = Promise.all([
        pool.acquire("s1", PRIMARY_TOKEN),
        pool.acquire("s2", PRIMARY_TOKEN),
      ]);
      await vi.waitFor(() => {
        assert.equal(fetchUsage.mock.calls.length, 2);
      });
      gate.resolve(undefined);
      const leases = await pending;
      assert.deepEqual(
        leases.map((lease) => lease?.accountId),
        ["anthropic-2", "anthropic-2"],
      );
    });
  });

  describe("pinning", () => {
    test("keeps a session on its account as usage shifts", async () => {
      usageByToken.set(PRIMARY_TOKEN, usage(0.1));
      usageByToken.set(SECOND_TOKEN, usage(0.5));
      await pool.acquire("s1", PRIMARY_TOKEN);

      pool.observe("anthropic", usage(0.95));
      assert.equal(
        (await pool.acquire("s1", PRIMARY_TOKEN))?.accountId,
        "anthropic",
      );
    });

    test("moves a session whose account is rate limited", async () => {
      await pool.acquire("s1", PRIMARY_TOKEN);
      pool.observe(
        "anthropic",
        usage(1, { limited: true, resetsAt: now + 60_000 }),
      );

      assert.equal(
        (await pool.acquire("s1", PRIMARY_TOKEN))?.accountId,
        "anthropic-2",
      );
    });

    test("moves a session whose account was logged out", async () => {
      usageByToken.set(PRIMARY_TOKEN, usage(0.9));
      await pool.acquire("s1", PRIMARY_TOKEN);
      accounts = ["anthropic", "anthropic-3"];
      tokens.set("anthropic-3", THIRD_TOKEN);

      assert.deepEqual(await pool.acquire("s1", PRIMARY_TOKEN), {
        accountId: "anthropic-3",
        token: THIRD_TOKEN,
      });
    });

    test("forgets a pin idle for an hour", async () => {
      await pool.acquire("s1", PRIMARY_TOKEN);
      assert.equal(pool.entries()[0]?.activeSessions, 1);
      now += 60 * 60_000;
      assert.equal(pool.entries()[0]?.activeSessions, 0);
    });
  });

  describe("failover", () => {
    test("marks the account limited and re-pins the session elsewhere", async () => {
      await pool.acquire("s1", PRIMARY_TOKEN);

      const moved = await pool.failover(
        "s1",
        "anthropic",
        PRIMARY_TOKEN,
        now + 60_000,
      );

      assert.deepEqual(moved, {
        accountId: "anthropic-2",
        token: SECOND_TOKEN,
      });
      assert.equal(
        (await pool.acquire("s1", PRIMARY_TOKEN))?.accountId,
        "anthropic-2",
      );
      assert.equal(pool.entries()[0]?.limitedUntil, now + 60_000);
    });

    test("assumes a five-minute limit when Anthropic gives no reset", async () => {
      await pool.failover("s1", "anthropic", PRIMARY_TOKEN, null);
      assert.equal(pool.entries()[0]?.limitedUntil, now + 5 * 60_000);
    });

    test("returns undefined when no other account is usable", async () => {
      pool.observe(
        "anthropic-2",
        usage(1, { limited: true, resetsAt: now + 1 }),
      );
      assert.equal(
        await pool.failover("s1", "anthropic", PRIMARY_TOKEN, null),
        undefined,
      );
    });
  });

  test("entries report each account in pool order", async () => {
    pool.observe("anthropic", usage(0.25));
    await pool.acquire("s1", PRIMARY_TOKEN);
    assert.deepEqual(pool.entries(), [
      {
        id: "anthropic",
        usage: usage(0.25),
        limitedUntil: null,
        activeSessions: 0,
      },
      { id: "anthropic-2", usage: null, limitedUntil: null, activeSessions: 1 },
    ]);
  });
});
