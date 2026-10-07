/** What the balancer knows about one account when a session needs a home. */
export interface AccountCandidate {
  id: string;
  /** Most-used window as a 0..1 fraction; 0 when unknown. */
  load: number;
  /** Epoch ms until which the account is rate limited; `null` when it is not. */
  limitedUntil: number | null;
  /** Sessions recently pinned to the account. */
  activeSessions: number;
}

/**
 * Accounts whose load is within this margin of the least-loaded one count as
 * equally loaded, and the tie goes to whichever has fewer active sessions.
 *
 * Utilization only moves once a request lands, so several sessions starting
 * together would otherwise all pick the same account.
 */
export const LOAD_TIE_MARGIN = 0.05;

/**
 * Picks the account a new session should be pinned to, so usage spreads
 * evenly across accounts: the least-loaded account that is not rate limited,
 * with near-ties broken by fewer active sessions and then by pool order.
 *
 * When every account is rate limited, the one that frees up first is
 * returned, so the request fails (or the SDK retries) against the account
 * most likely to have recovered.  Returns `undefined` only for an empty list.
 */
export function chooseAccount(
  candidates: readonly AccountCandidate[],
  now: number,
): string | undefined {
  const available = candidates.filter(
    ({ limitedUntil }) => limitedUntil === null || limitedUntil <= now,
  );
  if (available.length === 0) {
    return earliestRecovery(candidates)?.id;
  }

  const minLoad = Math.min(...available.map(({ load }) => load));
  const nearTies = available.filter(
    ({ load }) => load <= minLoad + LOAD_TIE_MARGIN,
  );
  return nearTies.reduce((best, candidate) =>
    candidate.activeSessions < best.activeSessions ? candidate : best,
  ).id;
}

function earliestRecovery(
  candidates: readonly AccountCandidate[],
): AccountCandidate | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, candidate) =>
    (candidate.limitedUntil ?? 0) < (best.limitedUntil ?? 0) ? candidate : best,
  );
}
