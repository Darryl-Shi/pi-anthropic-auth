import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { type AccountCandidate, chooseAccount } from "#src/account-balancer";

const NOW = 1_000_000;

function candidate(
  id: string,
  overrides: Partial<Omit<AccountCandidate, "id">> = {},
): AccountCandidate {
  return {
    id,
    headroom: 1,
    limitedUntil: null,
    activeSessions: 0,
    ...overrides,
  };
}

describe("chooseAccount", () => {
  describe("headroom", () => {
    test("picks the account with the most headroom", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { headroom: 0.4 }),
            candidate("b", { headroom: 0.8 }),
          ],
          NOW,
        ),
        "b",
      );
    });

    test("prefers clearly more headroom even with more sessions", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { headroom: 0.5 }),
            candidate("b", { headroom: 0.8, activeSessions: 5 }),
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
            candidate("a", { headroom: 0.8, activeSessions: 2 }),
            candidate("b", { headroom: 0.76, activeSessions: 1 }),
          ],
          NOW,
        ),
        "b",
      );
    });

    test("scale with headroom above a fresh window", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { headroom: 4, activeSessions: 2 }),
            candidate("b", { headroom: 3.85, activeSessions: 1 }),
          ],
          NOW,
        ),
        "b",
      );
      assert.equal(
        chooseAccount(
          [
            candidate("a", { headroom: 4, activeSessions: 2 }),
            candidate("b", { headroom: 3.7, activeSessions: 1 }),
          ],
          NOW,
        ),
        "a",
      );
    });

    test("fall back to pool order when sessions are equal too", () => {
      assert.equal(chooseAccount([candidate("a"), candidate("b")], NOW), "a");
    });
  });

  describe("rate limits", () => {
    test("skip a limited account however much headroom it has", () => {
      assert.equal(
        chooseAccount(
          [
            candidate("a", { headroom: 1, limitedUntil: NOW + 1 }),
            candidate("b", { headroom: 0.1 }),
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
            candidate("a", { headroom: 1, limitedUntil: NOW }),
            candidate("b", { headroom: 0.1 }),
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
