import type { OAuthAuth, Provider } from "@earendil-works/pi-ai";
import { PRIMARY_ACCOUNT } from "./account-pool";

/**
 * The `ModelRegistry` methods slot discovery reads.  Pi's stored-credential
 * status covers every `auth.json` entry, registered provider or not, so a
 * logged-in slot is found even before it is registered.
 */
export interface SlotRegistry {
  getProvider(id: string): Provider | undefined;
  getProviderAuthStatus(id: string): { configured: boolean };
}

/** The `ExtensionAPI` methods slot registration needs. */
export interface SlotRegistrar {
  registerProvider(provider: Provider): void;
  unregisterProvider(name: string): void;
}

/** A backstop on the slot scan, far above any real account count. */
const MAX_ACCOUNTS = 16;

/** `anthropic-2`, `anthropic-3`, …: account 1 is `anthropic` itself. */
export function accountSlotId(index: number): string {
  return `${PRIMARY_ACCOUNT}-${index}`;
}

/**
 * Extra Claude accounts, each a login-only Pi provider, so adding, refreshing,
 * and removing one is Pi's own `/login` and `/logout`.
 *
 * Every logged-in slot is registered, plus exactly one spare: the lowest
 * free slot, which is what `/login` offers as "Anthropic account N".
 * A logged-in slot is found before it is registered, because Pi's stored
 * credential status covers every `auth.json` entry.  Slots
 * reuse the built-in Anthropic provider's OAuth flow and register no models,
 * so the model picker is unchanged and requests still go to `anthropic/…`.
 *
 * A slot id another extension already registered (pi-multi-pass's
 * `anthropic-2`) is never replaced, only used: its login joins the pool when
 * it holds an Anthropic OAuth token.
 */
export class AccountSlots {
  private loggedIn: readonly string[] = [];
  private spareSlot: string | undefined;
  /** Slot ids this extension registered, and so may unregister. */
  private readonly ours = new Set<string>();

  constructor(private readonly registrar: SlotRegistrar) {}

  /**
   * Re-reads which slots hold a login, registers any slot not yet known to
   * Pi, unregisters a spare of ours that a logout left surplus, and returns
   * the pool's accounts in order, `anthropic` first.
   * It only reads in-memory registry state, so it is cheap enough to run on
   * every request, which is how a login made mid-session joins the pool
   * without a restart.
   */
  refresh(registry: SlotRegistry): readonly string[] {
    const base = registry.getProvider(PRIMARY_ACCOUNT);
    const oauth = base?.auth.oauth;
    if (!base || !oauth) return this.accounts();

    const loggedIn: string[] = [];
    let spare: string | undefined;
    for (let index = 2; index <= MAX_ACCOUNTS; index++) {
      const id = accountSlotId(index);
      if (registry.getProviderAuthStatus(id).configured) {
        loggedIn.push(id);
      } else if (spare === undefined) {
        spare = id;
      } else {
        this.dropSurplusSlot(id);
        continue;
      }
      if (!registry.getProvider(id)) {
        this.registrar.registerProvider(slotProvider(id, index, base, oauth));
        this.ours.add(id);
      }
    }
    this.loggedIn = loggedIn;
    this.spareSlot = spare;
    return this.accounts();
  }

  /**
   * After `/logout anthropic-2` with `anthropic-3` registered as the spare,
   * `anthropic-2` is the spare again; `anthropic-3` would otherwise linger as
   * a second free slot in `/login`.  Only our own registrations are removed.
   */
  private dropSurplusSlot(id: string): void {
    if (!this.ours.delete(id)) return;
    this.registrar.unregisterProvider(id);
  }

  accounts(): readonly string[] {
    return [PRIMARY_ACCOUNT, ...this.loggedIn];
  }

  /** The slot `/login` currently offers for a new account. */
  spare(): string | undefined {
    return this.spareSlot;
  }
}

/**
 * A provider that exists only to hold one account's login.  Its streams
 * delegate to `anthropic` for completeness; with no models, Pi never routes a
 * request to it.
 */
function slotProvider(
  id: string,
  index: number,
  base: Provider,
  oauth: OAuthAuth,
): Provider {
  return {
    id,
    name: `Anthropic account ${index}`,
    ...(base.baseUrl === undefined ? {} : { baseUrl: base.baseUrl }),
    auth: { oauth },
    getModels: () => [],
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) =>
      base.streamSimple(model, context, options),
  };
}
