import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { type AccountCandidate, chooseAccount } from "#src/account-balancer";

const NOW = 1_000_000;

function candidate(
  id: string,
  overrides: Partial<Omit<AccountCandidate, "id">> = {},
): AccountCandidate {
  return { id, load: 0, limitedUntil: null, activeSessions: 0, ...overrides };
}

describe("chooseAccount", () => {
  describe("load", () => {
    test("picks the least-loaded account", () => {
      assert.equal(
        chooseAccount(
          [candidate("a", { load: 0.6 }), candidate("b", { load: 0.2 })],
          NOW,
        ),
        "b",
      );
    });

    test("prefers a clearly less-loaded account even with more sessions", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { load: 0.5 }),
            candidate("b", { load: 0.2, activeSessions: 5 }),
          ],
          NOW,
        ),
        "b",
      );
    });
  });

  describe("near-ties", () => {
    test("go to the account with fewer active sessions", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { load: 0.2, activeSessions: 2 }),
            candidate("b", { load: 0.24, activeSessions: 1 }),
          ],
          NOW,
        ),
        "b",
      );
    });

    test("fall back to pool order when sessions are equal too", () => {
      assert.equal(chooseAccount([candidate("a"), candidate("b")], NOW), "a");
    });
  });

  describe("rate limits", () => {
    test("skip a limited account however lightly loaded", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { load: 0, limitedUntil: NOW + 1 }),
            candidate("b", { load: 0.9 }),
          ],
          NOW,
        ),
        "b",
      );
    });

    test("no longer apply once the limit has passed", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { load: 0, limitedUntil: NOW }),
            candidate("b", { load: 0.9 }),
          ],
          NOW,
        ),
        "a",
      );
    });

    test("pick the account that frees up first when all are limited", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { limitedUntil: NOW + 500 }),
            candidate("b", { limitedUntil: NOW + 100 }),
          ],
          NOW,
        ),
        "b",
      );
    });
  });

  test("returns undefined for no candidates", () => {
    assert.equal(chooseAccount([], NOW), undefined);
  });
});
