import type { FetchFunction } from "@earendil-works/pi-ai";
import type { AccountLease, AccountPool } from "./account-pool";
import { readUsageHeaders } from "./account-usage";

/**
 * Pins requests without a session id to one shared key, so they still keep
 * one account (and its cache) and still fail over, instead of hopping between
 * accounts on every call.
 */
export const UNSESSIONED_KEY = "(no session)";

export interface AccountRoutingOptions {
  pool: AccountPool;
  /** Pi's `options.sessionId`, when the caller supplied one. */
  sessionId: string | undefined;
  /** The token Pi resolved for `anthropic`, already on the built request. */
  primaryToken: string;
  /** The caller's own `fetch`, when it supplied one. */
  baseFetch: FetchFunction | undefined;
}

/**
 * Per-request `fetch` that sends the request with the token of the account
 * the pool pinned this session to, and moves the session to another account
 * when Anthropic rate limits the pinned one.
 *
 * The account is chosen here, not before the request is built, because the
 * pool may need to resolve tokens and read usage, which is asynchronous, and
 * `streamSimple` must return its stream synchronously.  Only the
 * `authorization` header changes, so the body (and with it the billing header
 * and the cached prompt prefix) is identical on every account.
 *
 * Every response's rate-limit headers are fed back to the pool, so the
 * accounts in use always have current utilization.
 */
export function createAccountRoutingFetch(
  options: AccountRoutingOptions,
): FetchFunction {
  const { pool, primaryToken, baseFetch } = options;
  const sessionKey = options.sessionId ?? UNSESSIONED_KEY;

  return async (input, init) => {
    const dispatch = baseFetch ?? globalThis.fetch;
    const send = async (lease: AccountLease): Promise<Response> => {
      const response = await dispatch(
        input,
        withToken(input, init, lease.token, primaryToken),
      );
      const usage = readUsageHeaders(response.headers);
      if (usage) pool.observe(lease.accountId, usage);
      return response;
    };

    const lease = await pool.acquire(sessionKey, primaryToken);
    if (!lease) return dispatch(input, init);

    const response = await send(lease);
    if (response.status !== 429) return response;

    const next = await pool.failover(
      sessionKey,
      lease.accountId,
      primaryToken,
      limitedUntil(response),
    );
    if (!next) return response;

    // One move per request: a second 429 reaches the SDK, which applies its
    // own retry policy, and the pool already knows both accounts are limited.
    await response.body?.cancel();
    return send(next);
  };
}

/** Returns `init` with the bearer token swapped, or unchanged for the primary. */
function withToken(
  input: Parameters<FetchFunction>[0],
  init: RequestInit | undefined,
  token: string,
  primaryToken: string,
): RequestInit | undefined {
  if (token === primaryToken) return init;
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/** When a rate-limited account frees up, in epoch ms, when the response says. */
function limitedUntil(response: Response): number | null {
  const usage = readUsageHeaders(response.headers);
  if (usage?.resetsAt) return usage.resetsAt;
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Date.now() + retryAfter * 1000
    : null;
}
