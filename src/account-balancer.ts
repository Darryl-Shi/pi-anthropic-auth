/** What the balancer knows about one account when a session needs a home. */
export interface AccountCandidate {
  id: string;
  /**
   * How fast the account can be used before its tighter window resets, as a
   * multiple of that window's even pace (see `usageHeadroom`); 1 when unknown.
   */
  headroom: number;
  /** Epoch ms until which the account is rate limited; `null` when it is not. */
  limitedUntil: number | null;
  /** Sessions recently pinned to the account. */
  activeSessions: number;
}

/**
 * Accounts whose headroom is within this margin of the best one count as
 * tied, and the tie goes to whichever has fewer active sessions.  Above a
 * fresh window's headroom of 1 the margin scales with the best headroom, so
 * it stays 5% of it.
 *
 * Utilization only moves once a request lands, so several sessions starting
 * together would otherwise all pick the same account.
 */
export const HEADROOM_TIE_MARGIN = 0.05;

/**
 * Picks the account a new session should be pinned to, so usage spreads
 * across accounts and capacity about to reset is spent first: the account
 * with the most headroom that is not rate limited, with near-ties broken by
 * fewer active sessions and then by pool order.
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

  const best = Math.max(...available.map(({ headroom }) => headroom));
  const threshold = best - HEADROOM_TIE_MARGIN * Math.max(1, best);
  const nearTies = available.filter(({ headroom }) => headroom >= threshold);
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
