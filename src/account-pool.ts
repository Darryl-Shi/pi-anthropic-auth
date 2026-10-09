import { type AccountCandidate, chooseAccount } from "./account-balancer";
import {
  type AccountUsage,
  fetchAccountUsage,
  usageHeadroom,
} from "./account-usage";
import { debugLog } from "./debug";
import { isAnthropicOAuthToken } from "./oauth-token";

/** The account Pi itself resolves for `anthropic`: the `/login anthropic` one. */
export const PRIMARY_ACCOUNT = "anthropic";

/**
 * Where the pool finds its accounts: the provider ids holding an Anthropic
 * OAuth login, and each one's access token.  Pi refreshes a token that is
 * about to expire before returning it.
 */
export interface AccountDirectory {
  /** Account provider ids in pool order, {@link PRIMARY_ACCOUNT} first. */
  accounts(): readonly string[];
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

/** The account a request is routed to, and the token to send. */
export interface AccountLease {
  accountId: string;
  token: string;
}

/** One account's state, as `/anthropic-auth:status` reports it. */
export interface AccountPoolEntry {
  id: string;
  usage: AccountUsage | null;
  limitedUntil: number | null;
  activeSessions: number;
}

export interface AccountPoolDeps {
  fetchUsage?: (token: string) => Promise<AccountUsage | undefined>;
  now?: () => number;
}

/**
 * Usage older than this is re-read from `/api/oauth/usage` before a new
 * session is assigned.  Accounts in use refresh it on every response.
 */
const USAGE_STALE_MS = 5 * 60_000;
/**
 * A pin idle this long no longer counts toward its account's active sessions.
 * Prompt caches expire after at most an hour, so nothing is lost by moving
 * such a session later.
 */
const PIN_IDLE_MS = 60 * 60_000;
/** Assumed rate-limit duration when Anthropic does not say when it resets. */
const DEFAULT_LIMIT_MS = 5 * 60_000;

interface Pin {
  accountId: string;
  lastUsed: number;
}

interface AssignOptions {
  /** Accounts the session must not land on. */
  excluded: ReadonlySet<string>;
  /**
   * Whether a rate-limited account may be chosen when every account is
   * limited.  A new session must land somewhere; a failover must not.
   */
  allowLimited: boolean;
}

interface ObservedUsage {
  usage: AccountUsage;
  observedAt: number;
}

/**
 * Spreads Anthropic OAuth requests across several Claude subscriptions while
 * keeping each session on one account, so its prompt cache keeps hitting.
 *
 * A session is pinned on its first request to the account with the most
 * headroom: server-reported utilization weighed against how soon each window
 * resets (see {@link chooseAccount} and {@link usageHeadroom}).  It stays there
 * until that account is rate limited, when {@link failover} moves it.
 *
 * Utilization comes from Anthropic, not from local counting, so usage from
 * claude.ai, Claude Code, and other pi processes is balanced too.
 *
 * With one account (or before {@link attach}) the pool is inactive and every
 * request passes through untouched.
 */
export class AccountPool {
  private directory: AccountDirectory | undefined;
  private readonly pins = new Map<string, Pin>();
  private readonly observed = new Map<string, ObservedUsage>();
  private readonly limits = new Map<string, number>();
  private readonly probes = new Map<string, Promise<void>>();
  private readonly probedAt = new Map<string, number>();
  private readonly placements = new Map<
    string,
    Promise<AccountLease | undefined>
  >();
  private readonly fetchUsage: (
    token: string,
  ) => Promise<AccountUsage | undefined>;
  private readonly now: () => number;

  constructor(deps: AccountPoolDeps = {}) {
    this.fetchUsage = deps.fetchUsage ?? ((token) => fetchAccountUsage(token));
    this.now = deps.now ?? Date.now;
  }

  /** Supplies the accounts.  Called from `session_start`, once Pi's registry is in hand. */
  attach(directory: AccountDirectory): void {
    this.directory = directory;
  }

  /**
   * Returns the account a session's request should use, pinning the session
   * on its first request.  `undefined` means "send the request as Pi built
   * it": the pool has fewer than two accounts, or no account has a token.
   *
   * @param primaryToken The token Pi resolved for `anthropic`, which is
   *   already on the request.
   */
  async acquire(
    sessionKey: string,
    primaryToken: string,
  ): Promise<AccountLease | undefined> {
    const accounts = this.activeAccounts();
    if (accounts.length < 2) {
      // Still pinned, to the only account there is, so a session already
      // running when a second account is added keeps its cache.
      if (this.directory) this.pin(sessionKey, PRIMARY_ACCOUNT);
      return undefined;
    }
    this.prunePins();

    // Concurrent first requests of one session share one placement, so the
    // session cannot be split across accounts before its pin exists.
    const pending = this.placements.get(sessionKey);
    if (pending) return pending;
    const placement = this.leaseFor(sessionKey, accounts, primaryToken);
    this.placements.set(sessionKey, placement);
    try {
      return await placement;
    } finally {
      this.placements.delete(sessionKey);
    }
  }

  private async leaseFor(
    sessionKey: string,
    accounts: readonly string[],
    primaryToken: string,
  ): Promise<AccountLease | undefined> {
    const pin = this.pins.get(sessionKey);
    if (
      pin &&
      accounts.includes(pin.accountId) &&
      !this.isLimited(pin.accountId)
    ) {
      const token = await this.tokenFor(pin.accountId, primaryToken);
      if (token) {
        pin.lastUsed = this.now();
        return { accountId: pin.accountId, token };
      }
    }
    return this.assign(sessionKey, accounts, primaryToken, {
      excluded: new Set(),
      allowLimited: true,
    });
  }

  /**
   * Marks `accountId` rate limited and moves the session to the best
   * remaining account.  Returns `undefined` when no other account is usable,
   * so the caller surfaces the original response.
   */
  async failover(
    sessionKey: string,
    accountId: string,
    primaryToken: string,
    limitedUntil: number | null,
  ): Promise<AccountLease | undefined> {
    this.limits.set(accountId, limitedUntil ?? this.now() + DEFAULT_LIMIT_MS);
    const accounts = this.activeAccounts();
    // Retrying on another limited account would only spend a second 429.
    const lease = await this.assign(sessionKey, accounts, primaryToken, {
      excluded: new Set([accountId]),
      allowLimited: false,
    });
    if (!lease) return undefined;
    debugLog("account-failover", { from: accountId, to: lease.accountId });
    return lease;
  }

  /** Records usage read off a response's rate-limit headers. */
  observe(accountId: string, usage: AccountUsage): void {
    this.observed.set(accountId, { usage, observedAt: this.now() });
    if (usage.limited) {
      this.limits.set(
        accountId,
        usage.resetsAt ?? this.now() + DEFAULT_LIMIT_MS,
      );
    } else {
      this.limits.delete(accountId);
    }
  }

  /** Every account in pool order, for `/anthropic-auth:status`. */
  entries(): readonly AccountPoolEntry[] {
    return (this.directory?.accounts() ?? []).map((id) => this.entry(id));
  }

  /**
   * The account a session's requests currently go to, or `undefined` before
   * its first request and after that account is logged out.
   */
  sessionAccount(sessionKey: string): AccountPoolEntry | undefined {
    const pin = this.pins.get(sessionKey);
    if (!pin || !this.activeAccounts().includes(pin.accountId)) {
      return undefined;
    }
    return this.entry(pin.accountId);
  }

  private entry(id: string): AccountPoolEntry {
    const until = this.limits.get(id);
    return {
      id,
      usage: this.observed.get(id)?.usage ?? null,
      limitedUntil: until !== undefined && until > this.now() ? until : null,
      activeSessions: this.activeSessions(id),
    };
  }

  private activeAccounts(): readonly string[] {
    return this.directory?.accounts() ?? [];
  }

  private async assign(
    sessionKey: string,
    accounts: readonly string[],
    primaryToken: string,
    { excluded, allowLimited }: AssignOptions,
  ): Promise<AccountLease | undefined> {
    const tokens = new Map<string, string>();
    await Promise.all(
      accounts
        .filter((id) => !excluded.has(id))
        .map(async (id) => {
          const token = await this.tokenFor(id, primaryToken);
          if (token) tokens.set(id, token);
        }),
    );
    if (tokens.size === 0) return undefined;

    await Promise.all(
      Array.from(tokens, ([id, token]) => this.refreshStaleUsage(id, token)),
    );

    const now = this.now();
    const candidates: AccountCandidate[] = accounts
      .filter((id) => tokens.has(id) && (allowLimited || !this.isLimited(id)))
      .map((id) => ({
        id,
        headroom: usageHeadroom(this.observed.get(id)?.usage, now),
        limitedUntil: this.isLimited(id) ? (this.limits.get(id) ?? null) : null,
        activeSessions: this.activeSessions(id),
      }));
    const accountId = chooseAccount(candidates, now);
    const token = accountId === undefined ? undefined : tokens.get(accountId);
    if (accountId === undefined || token === undefined) return undefined;

    this.pin(sessionKey, accountId);
    debugLog("account-assigned", { accountId, candidates });
    return { accountId, token };
  }

  private pin(sessionKey: string, accountId: string): void {
    this.pins.set(sessionKey, { accountId, lastUsed: this.now() });
  }

  private async tokenFor(
    accountId: string,
    primaryToken: string,
  ): Promise<string | undefined> {
    if (accountId === PRIMARY_ACCOUNT) return primaryToken;
    try {
      const token = await this.directory?.getApiKeyForProvider(accountId);
      return isAnthropicOAuthToken(token) ? token : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * One in-flight probe per account, so a burst of new sessions asks once,
   * and at most one attempt per staleness window, so an account whose usage
   * cannot be read is not asked again for every new session.
   */
  private refreshStaleUsage(accountId: string, token: string): Promise<void> {
    const inFlight = this.probes.get(accountId);
    if (inFlight) return inFlight;
    const lastKnown = Math.max(
      this.observed.get(accountId)?.observedAt ?? -Infinity,
      this.probedAt.get(accountId) ?? -Infinity,
    );
    if (this.now() - lastKnown < USAGE_STALE_MS) return Promise.resolve();

    this.probedAt.set(accountId, this.now());
    const probe = this.fetchUsage(token)
      .then((usage) => {
        if (usage) this.observe(accountId, usage);
      })
      .finally(() => this.probes.delete(accountId));
    this.probes.set(accountId, probe);
    return probe;
  }

  private isLimited(accountId: string): boolean {
    const until = this.limits.get(accountId);
    return until !== undefined && until > this.now();
  }

  private activeSessions(accountId: string): number {
    const cutoff = this.now() - PIN_IDLE_MS;
    let count = 0;
    for (const pin of this.pins.values()) {
      if (pin.accountId === accountId && pin.lastUsed > cutoff) count++;
    }
    return count;
  }

  private prunePins(): void {
    const cutoff = this.now() - PIN_IDLE_MS;
    for (const [key, pin] of this.pins) {
      if (pin.lastUsed <= cutoff) this.pins.delete(key);
    }
  }
}
