import assert from "node:assert/strict";
import type { OAuthAuth, Provider } from "@earendil-works/pi-ai";
import { beforeEach, describe, test, vi } from "vitest";
import { AccountSlots, type SlotRegistry } from "#src/account-slots";

const OAUTH = { name: "Anthropic (Claude Pro/Max)" } as OAuthAuth;

function anthropicProvider(): Provider {
  return {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    auth: { oauth: OAUTH },
    getModels: () => [],
    stream: vi.fn(),
    streamSimple: vi.fn(),
  };
}

describe("AccountSlots", () => {
  let providers: Map<string, Provider>;
  let loggedIn: Set<string>;
  let registry: SlotRegistry;
  let registered: Provider[];
  let slots: AccountSlots;

  beforeEach(() => {
    providers = new Map([["anthropic", anthropicProvider()]]);
    loggedIn = new Set();
    registry = {
      getProvider: (id) => providers.get(id),
      getProviderAuthStatus: (id) => ({ configured: loggedIn.has(id) }),
    };
    registered = [];
    slots = new AccountSlots({
      registerProvider(provider) {
        registered.push(provider);
        providers.set(provider.id, provider);
      },
    });
  });

  describe("with no extra logins", () => {
    test("registers anthropic-2 as the one spare slot", () => {
      assert.deepEqual(slots.refresh(registry), ["anthropic"]);
      assert.deepEqual(
        registered.map(({ id }) => id),
        ["anthropic-2"],
      );
      assert.equal(slots.spare(), "anthropic-2");
    });

    test("the slot is login-only: built-in OAuth, a numbered name, no models", () => {
      slots.refresh(registry);
      const slot = registered.at(0);
      assert.ok(slot);
      assert.equal(slot.name, "Anthropic account 2");
      assert.equal(slot.auth.oauth, OAUTH);
      assert.equal(slot.auth.apiKey, undefined);
      assert.deepEqual(slot.getModels(), []);
    });
  });

  describe("with extra logins", () => {
    test("adds each logged-in slot to the accounts and offers the next", () => {
      loggedIn = new Set(["anthropic-2", "anthropic-3"]);
      assert.deepEqual(slots.refresh(registry), [
        "anthropic",
        "anthropic-2",
        "anthropic-3",
      ]);
      assert.equal(slots.spare(), "anthropic-4");
    });

    test("offers the gap left by a logout, and keeps later accounts", () => {
      loggedIn = new Set(["anthropic-3"]);
      assert.deepEqual(slots.refresh(registry), ["anthropic", "anthropic-3"]);
      assert.equal(slots.spare(), "anthropic-2");
      assert.deepEqual(
        registered.map(({ id }) => id),
        ["anthropic-2", "anthropic-3"],
      );
    });

    test("picks up a login made after the first refresh, registering only the new spare", () => {
      slots.refresh(registry);
      loggedIn.add("anthropic-2");
      assert.deepEqual(slots.refresh(registry), ["anthropic", "anthropic-2"]);
      assert.deepEqual(
        registered.map(({ id }) => id),
        ["anthropic-2", "anthropic-3"],
      );
    });
  });

  test("never replaces a slot id another extension registered", () => {
    const foreign = { ...anthropicProvider(), id: "anthropic-2" } as Provider;
    providers.set("anthropic-2", foreign);
    loggedIn.add("anthropic-2");

    assert.deepEqual(slots.refresh(registry), ["anthropic", "anthropic-2"]);
    assert.deepEqual(
      registered.map(({ id }) => id),
      ["anthropic-3"],
    );
    assert.equal(providers.get("anthropic-2"), foreign);
  });

  test("registers nothing when anthropic has no OAuth flow to reuse", () => {
    providers.set("anthropic", {
      ...anthropicProvider(),
      auth: {},
    });
    assert.deepEqual(slots.refresh(registry), ["anthropic"]);
    assert.deepEqual(registered, []);
  });
});
