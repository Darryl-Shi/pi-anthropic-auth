import { join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { type AccountDirectory, PRIMARY_ACCOUNT } from "./account-pool";
import {
  accountSlotId,
  MAX_ACCOUNTS,
  type SlotRegistry,
  slotIndex,
  slotProvider,
} from "./account-slots";
import { debugLog } from "./debug";

/**
 * Account discovery for hosts that load extensions for their providers but
 * never start a pi session, such as the software factory: it builds pi's
 * model runtime over its own agent dir and calls `streamSimple` on it, so
 * `session_start`, and with it `ctx.modelRegistry`, never arrives.
 *
 * Without this, such a host would never register the `anthropic-N` login
 * slots (so a second account could not even be logged in) and the pool would
 * stay unattached, sending every request on the `anthropic` login.
 *
 * Everything here reads pi's own `auth.json` through pi's own APIs:
 * `readStoredCredential` for which slots hold a login, and a private
 * `ModelRuntime` over the same file for each slot's token, so pi refreshes it
 * under the same file lock the host's runtime uses.
 */

/** Reads one stored credential; `readStoredCredential` in production. */
export type CredentialReader = (
  providerId: string,
  authPath: string,
) => { type?: string } | undefined;

/** Resolves an account's access token, refreshing it when it is about to expire. */
export interface TokenResolver {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

/** The `auth.json` under an agent dir. */
export function authPathOf(agentDir: string): string {
  return join(agentDir, "auth.json");
}

/** True when the `anthropic` login is a Claude subscription (OAuth) login. */
export function hasAnthropicOAuthLogin(
  authPath: string,
  read: CredentialReader = readStoredCredential,
): boolean {
  return read(PRIMARY_ACCOUNT, authPath)?.type === "oauth";
}

/**
 * A `SlotRegistry` read off `auth.json`, for registering the login slots at
 * load, before any registry exists.  `anthropic` is pi's built-in provider:
 * a slot's login reuses its OAuth flow.  No slot is registered yet, so every
 * logged-in slot and the spare are registered.
 */
export function storedSlotRegistry(
  authPath: string,
  anthropic: Provider,
  read: CredentialReader = readStoredCredential,
): SlotRegistry {
  return {
    getProvider: (id) => (id === PRIMARY_ACCOUNT ? anthropic : undefined),
    getProviderAuthStatus: (id) => ({
      configured: read(id, authPath) !== undefined,
    }),
  };
}

/** How long the slot logins read off `auth.json` are reused. */
const ACCOUNTS_TTL_MS = 10_000;

export interface HeadlessAccountDirectoryOptions {
  authPath: string;
  read?: CredentialReader;
  /** Builds the token resolver on first use; a private `ModelRuntime` in production. */
  createResolver?: () => Promise<TokenResolver>;
  now?: () => number;
}

/**
 * The pool's accounts without a session: `anthropic` plus every `anthropic-N`
 * slot holding a login in `auth.json`.  A login made by another process (the
 * factory's `setup`) joins within {@link ACCOUNTS_TTL_MS}, without a restart.
 */
export class HeadlessAccountDirectory implements AccountDirectory {
  private readonly authPath: string;
  private readonly read: CredentialReader;
  private readonly createResolver: () => Promise<TokenResolver>;
  private readonly now: () => number;
  private cached: readonly string[] = [PRIMARY_ACCOUNT];
  private readAt = -Infinity;
  private resolver: Promise<TokenResolver> | undefined;

  constructor(options: HeadlessAccountDirectoryOptions) {
    this.authPath = options.authPath;
    this.read = options.read ?? readStoredCredential;
    this.createResolver =
      options.createResolver ?? (() => createRuntimeResolver(this.authPath));
    this.now = options.now ?? Date.now;
  }

  accounts(): readonly string[] {
    if (this.now() - this.readAt < ACCOUNTS_TTL_MS) return this.cached;
    const loggedIn: string[] = [];
    for (let index = 2; index <= MAX_ACCOUNTS; index++) {
      const id = accountSlotId(index);
      if (this.read(id, this.authPath)?.type === "oauth") loggedIn.push(id);
    }
    this.cached = [PRIMARY_ACCOUNT, ...loggedIn];
    this.readAt = this.now();
    return this.cached;
  }

  async getApiKeyForProvider(provider: string): Promise<string | undefined> {
    this.resolver ??= this.createResolver();
    const resolver = await this.resolver.catch((error: unknown) => {
      // Try again on the next request rather than never.
      this.resolver = undefined;
      debugLog("headless-resolver-failed", { error: String(error) });
      return undefined;
    });
    return resolver?.getApiKeyForProvider(provider);
  }
}

/**
 * A private `ModelRuntime` over the host's `auth.json`, holding the slot
 * providers the host's own runtime may not have.  `modelsPath: null` keeps its
 * model catalog in memory, so it never writes the host's `models-store.json`;
 * credentials go through pi's file-locked auth storage, shared with the host.
 */
async function createRuntimeResolver(authPath: string): Promise<TokenResolver> {
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    refreshOnCreate: false,
  });
  return {
    async getApiKeyForProvider(provider) {
      if (!runtime.getProvider(provider)) {
        const base = runtime.getProvider(PRIMARY_ACCOUNT);
        const oauth = base?.auth.oauth;
        const index = slotIndex(provider);
        if (!base || !oauth || index === undefined) return undefined;
        runtime.registerNativeProvider(
          slotProvider(provider, index, base, oauth),
        );
      }
      try {
        return (await runtime.getAuth(provider))?.auth.apiKey;
      } catch (error) {
        debugLog("headless-token-failed", { provider, error: String(error) });
        return undefined;
      }
    },
  };
}
