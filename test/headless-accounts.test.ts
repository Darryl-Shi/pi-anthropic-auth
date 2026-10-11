import assert from "node:assert/strict";
import type { OAuthAuth, Provider } from "@earendil-works/pi-ai";
import { describe, test, vi } from "vitest";
import { AccountSlots } from "#src/account-slots";
import {
  type CredentialReader,
  HeadlessAccountDirectory,
  hasAnthropicOAuthLogin,
  storedSlotRegistry,
  type TokenResolver,
} from "#src/headless-accounts";

const AUTH_PATH = "/agent/auth.json";
const OAUTH = { name: "Anthropic (Claude Pro/Max)" } as OAuthAuth;
const ANTHROPIC = {
  id: "anthropic",
  name: "Anthropic",
  auth: { oauth: OAUTH },
} as unknown as Provider;

/** A reader over an in-memory `auth.json`. */
function reader(store: Record<string, { type: string }>): CredentialReader {
  return vi.fn((id: string, path: string) => {
    assert.equal(path, AUTH_PATH);
    return store[id];
  });
}

describe("hasAnthropicOAuthLogin", () => {
  test("is true for a subscription login", () => {
    assert.equal(
      hasAnthropicOAuthLogin(
        AUTH_PATH,
        reader({ anthropic: { type: "oauth" } }),
      ),
      true,
    );
  });

  test("is false for an API key or no login", () => {
    assert.equal(
      hasAnthropicOAuthLogin(
        AUTH_PATH,
        reader({ anthropic: { type: "api_key" } }),
      ),
      false,
    );
    assert.equal(hasAnthropicOAuthLogin(AUTH_PATH, reader({})), false);
  });
});

describe("storedSlotRegistry", () => {
  test("lets the slots register every stored login and one spare at load", () => {
    const registered: string[] = [];
    const slots = new AccountSlots({
      registerProvider: (provider) => registered.push(provider.id),
      unregisterProvider: () => {},
    });
    const accounts = slots.refresh(
      storedSlotRegistry(
        AUTH_PATH,
        ANTHROPIC,
        reader({
          anthropic: { type: "oauth" },
          "anthropic-3": { type: "oauth" },
        }),
      ),
    );

    assert.deepEqual(registered, ["anthropic-2", "anthropic-3"]);
    assert.deepEqual(accounts, ["anthropic", "anthropic-3"]);
    assert.equal(slots.spare(), "anthropic-2");
  });
});

describe("HeadlessAccountDirectory", () => {
  test("lists anthropic and every slot holding an OAuth login", () => {
    const directory = new HeadlessAccountDirectory({
      authPath: AUTH_PATH,
      read: reader({
        anthropic: { type: "oauth" },
        "anthropic-2": { type: "oauth" },
        "anthropic-4": { type: "oauth" },
        "anthropic-5": { type: "api_key" },
      }),
    });
    assert.deepEqual(directory.accounts(), [
      "anthropic",
      "anthropic-2",
      "anthropic-4",
    ]);
  });

  test("re-reads auth.json only once its snapshot is 10 seconds old", () => {
    const store: Record<string, { type: string }> = {};
    let now = 0;
    const directory = new HeadlessAccountDirectory({
      authPath: AUTH_PATH,
      read: reader(store),
      now: () => now,
    });
    assert.deepEqual(directory.accounts(), ["anthropic"]);

    store["anthropic-2"] = { type: "oauth" };
    now = 9_999;
    assert.deepEqual(directory.accounts(), ["anthropic"]);
    now = 10_000;
    assert.deepEqual(directory.accounts(), ["anthropic", "anthropic-2"]);
  });

  test("resolves tokens through one lazily built resolver", async () => {
    const resolver: TokenResolver = {
      getApiKeyForProvider: (id) => Promise.resolve(`token-for-${id}`),
    };
    const createResolver = vi.fn(() => Promise.resolve(resolver));
    const directory = new HeadlessAccountDirectory({
      authPath: AUTH_PATH,
      read: reader({}),
      createResolver,
    });
    assert.equal(createResolver.mock.calls.length, 0);

    assert.equal(
      await directory.getApiKeyForProvider("anthropic-2"),
      "token-for-anthropic-2",
    );
    await directory.getApiKeyForProvider("anthropic-3");
    assert.equal(createResolver.mock.calls.length, 1);
  });

  test("builds the resolver again after it failed", async () => {
    const createResolver = vi
      .fn<() => Promise<TokenResolver>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({
        getApiKeyForProvider: () => Promise.resolve("token"),
      });
    const directory = new HeadlessAccountDirectory({
      authPath: AUTH_PATH,
      read: reader({}),
      createResolver,
    });

    assert.equal(
      await directory.getApiKeyForProvider("anthropic-2"),
      undefined,
    );
    assert.equal(await directory.getApiKeyForProvider("anthropic-2"), "token");
  });
});
