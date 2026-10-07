import type { FetchFunction } from "@earendil-works/pi-ai";
import {
  type AccountLease,
  type AccountPool,
  PRIMARY_ACCOUNT,
} from "./account-pool";
import { readUsageHeaders } from "./account-usage";

/**
 * Pins requests without a session id to one shared key, so they still keep
 * one account (and its cache) and still fail over, instead of hopping between
 * accounts on every call.
 */
export const UNSESSIONED_KEY = "(no session)";

/**
 * Responses that move the session to another account: 429 (the account is
 * rate limited) and 401 (its token was revoked, or its login is otherwise
 * broken beyond what Pi's refresh can fix).  Either way the account is set
 * aside until it is expected to recover, and the session continues elsewhere.
 */
const FAILOVER_STATUSES: ReadonlySet<number> = new Set([401, 429]);

export interface AccountRoutingOptions {
  pool: AccountPool;
  /** Pi's `options.sessionId`, when the caller supplied one. */
  sessionId: string | undefined;
  /** The token Pi resolved for `anthropic`, already on the built request. */
  primaryToken: string;
  /** The caller's own `fetch`, when it supplied one. */
  baseFetch: FetchFunction | undefined;
  /** Clock for `retry-after`; injectable so tests share the pool's. */
  now?: () => number;
}

/**
 * Per-request `fetch` that sends the request with the token of the account
 * the pool pinned this session to, and moves the session to another account
 * when Anthropic rate limits the pinned one or rejects its token.
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
  const { pool, primaryToken, baseFetch, now = Date.now } = options;
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

    // The pool never decides whether a request is sent, only with which
    // token: any failure inside it degrades to the request as Pi built it,
    // which is on the primary account, so its usage is still recorded for
    // the account indicator.
    const lease = await pool
      .acquire(sessionKey, primaryToken)
      .catch(() => undefined);
    if (!lease) {
      return send({ accountId: PRIMARY_ACCOUNT, token: primaryToken });
    }

    const response = await send(lease);
    if (!FAILOVER_STATUSES.has(response.status)) return response;

    const next = await pool
      .failover(
        sessionKey,
        lease.accountId,
        primaryToken,
        limitedUntil(response, now()),
      )
      .catch(() => undefined);
    if (!next) return response;

    // One move per request: a second failure reaches the SDK, which applies
    // its own retry policy.
    await response.body?.cancel().catch(() => undefined);
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

/**
 * When a failed account is expected to recover, in epoch ms, when the
 * response says.  The unified reset is on every response, so it is trusted
 * only when the unified status says the account is the thing that is limited;
 * otherwise `retry-after` governs.
 */
function limitedUntil(response: Response, now: number): number | null {
  const usage = readUsageHeaders(response.headers);
  if (usage?.limited && usage.resetsAt !== null) return usage.resetsAt;
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? now + retryAfter * 1000
    : null;
}
