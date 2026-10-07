import type {
  Api,
  AssistantMessageEventStream,
  FetchFunction,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { type AccountPool, PRIMARY_ACCOUNT } from "./account-pool";
import { createAccountRoutingFetch } from "./account-routing-fetch";
import { createBillingVersionSync } from "./billing-version-sync";
import {
  createLearnedClaudeCodeFloor,
  type LearnedClaudeCodeFloor,
} from "./claude-code-version";
import type { AnthropicStreamSimpleDelegate } from "./host-transport";
import { isAnthropicOAuthToken } from "./oauth-token";
import { shapeAnthropicOAuthPayload } from "./request-shaping";

/**
 * The `streamSimple` handler shape Pi's `ProviderConfig` accepts.
 *
 * It matches `ApiStreamSimpleFunction` from `@earendil-works/pi-ai` and is
 * intentionally wider than a single concrete model type because Pi registers
 * it per `Api`, not per model.
 *
 * `context` is pi-ai's branded `TranscriptContext`, which only
 * `normalizeContext()` produces.  We never read it — the wrapper forwards it
 * to the delegate untouched — but naming the type keeps this signature in step
 * with `provider-composer`'s own declaration, so a future upstream narrowing
 * surfaces as a type error rather than passing silently.
 */
export type AnthropicStreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/** State a wrapper instance shares across every request it shapes. */
export interface OAuthStreamSimpleCollaborators {
  /**
   * The Claude Code version floor learned from Anthropic's
   * `claude_code_version_too_old` rejections.  It is owned once per
   * registered wrapper, because it must outlive the per-request billing
   * version sync; it is injectable so tests can observe it.
   */
  learnedFloor?: LearnedClaudeCodeFloor;
  /**
   * The Claude accounts `anthropic` requests are spread across.  Without it
   * every request uses the token Pi resolved.
   */
  pool?: AccountPool;
}

/**
 * Wraps Pi's built-in Anthropic `streamSimple` transport so OAuth request
 * shaping runs on **every** Anthropic call path, not only the main agent loop.
 *
 * Pi only threads its `before_provider_request` hook into the interactive agent
 * loop.  Built-in compaction/summarization reuses `agent.streamFunction`, so it
 * reaches this wrapper through `modelRuntime` but carries no hook-supplied
 * `onPayload`.  Without our shaping those OAuth requests reach Anthropic with
 * no Claude Code billing header and are classified as third-party app usage,
 * producing the misleading "extra usage" HTTP 400.
 *
 * By injecting our shaping as an `onPayload` on the underlying transport, every
 * Anthropic OAuth request that reaches `provider-composer` is shaped regardless
 * of which Pi code path issued it.
 * The wrapper composes (does not replace) any caller-provided `onPayload`, so
 * other extensions' `before_provider_request` handlers continue to run on the
 * main loop, and our shaping is applied last — closest to the wire.
 *
 * Extension model calls through `ctx.modelRegistry.streamSimple()` (pi
 * >=0.86.0) also route through `modelRuntime`, so background agents that pass
 * it as their stream function are shaped.  Requests that dispatch through
 * pi-ai's own `compat.streamSimple` — passed explicitly, or reached through
 * the `setDefaultStreamFn` fallback when a caller omits `streamFn` — never
 * reach this wrapper on pi >=0.80.8 and remain unshaped (Issue #46,
 * Issue #53).  `docs/architecture.md` records why that gap is not closed here
 * and the supported path for extension authors.
 *
 * Gating is strictly OAuth-only: when the request is not an Anthropic OAuth
 * token, the payload passes through untouched, preserving Pi's normal
 * API-key and non-Anthropic transport behavior.
 *
 * @param delegate Pi's built-in Anthropic `streamSimple` transport, resolved
 *   at runtime by `resolveBuiltinAnthropicStreamSimple` (see
 *   `src/host-transport.ts`).  It is resolved directly rather than read out of
 *   the api registry: `anthropicMessagesApi()` is the non-deprecated handle
 *   pi's own `custom-provider-gitlab-duo` example uses, and reading from a
 *   registry this extension does not participate in would bind the delegate to
 *   whatever another extension registered there last.  On pi <=0.80.7 it would
 *   also have recursed, because `registerProvider` bridged this wrapper into
 *   that slot.  The related 0.79.x lazy-registration clobber is precluded by
 *   the >=0.80.8 peer floor (Issue #28, Issue #40).
 * @param collaborators State that must outlive a single request; see
 *   {@link OAuthStreamSimpleCollaborators}.
 */
export function createAnthropicOAuthStreamSimple(
  delegate: AnthropicStreamSimpleDelegate,
  collaborators: OAuthStreamSimpleCollaborators = {},
): AnthropicStreamSimple {
  const learnedFloor =
    collaborators.learnedFloor ?? createLearnedClaudeCodeFloor();
  const { pool } = collaborators;
  return (model, context, options) => {
    // Resolved once per request rather than per payload: the token decides
    // both whether shaping runs and — as of the billing-version sync — which
    // transport-level collaborators are attached at all, and those decisions
    // must agree.
    const apiKey = options?.apiKey;
    const isOAuthRequest = isAnthropicOAuthToken(apiKey);
    const callerOnPayload = options?.onPayload;

    // Pi's own Claude Code version is only observable at the fetch boundary:
    // pi-ai's `createClient` adds `user-agent: claude-cli/<version>`
    // downstream of every other seam we can reach.  The sync object is
    // constructed only for OAuth requests, so an API-key request keeps the
    // caller's `fetch` (or none) untouched.
    const versionSync = isOAuthRequest
      ? createBillingVersionSync(
          learnedFloor,
          accountFetch(pool, model, apiKey, options ?? {}),
        )
      : undefined;

    const composeCallerOnPayload = async (
      payload: unknown,
      payloadModel: Model<Api>,
    ): Promise<unknown> =>
      callerOnPayload
        ? ((await callerOnPayload(payload, payloadModel)) ?? payload)
        : payload;

    const onPayload: SimpleStreamOptions["onPayload"] = async (
      payload,
      payloadModel,
    ) => {
      const upstream = await composeCallerOnPayload(payload, payloadModel);

      if (!isOAuthRequest) {
        return upstream;
      }

      versionSync?.recordRequest(upstream);
      return shapeAnthropicOAuthPayload(upstream);
    };

    // `provider-composer` only invokes this transport when
    // `model.api === extension.api`, so the wide `Model<Api>` is guaranteed to
    // be `Model<"anthropic-messages">` at runtime — safe to narrow for the
    // delegate call.
    return delegate(model as Model<"anthropic-messages">, context, {
      ...options,
      onPayload,
      ...(versionSync ? { fetch: versionSync.fetch } : {}),
    });
  };
}

/**
 * The `fetch` beneath the billing version sync for an OAuth request: the
 * account-routing `fetch` when the pool applies, else the caller's own.
 *
 * Routing applies only to `anthropic` itself: a request to another named
 * provider (pi-multi-pass's `anthropic-2`) already names the account it
 * wants.  It sits beneath the version sync, so a version retry stays on the
 * session's account.
 */
function accountFetch(
  pool: AccountPool | undefined,
  model: Model<Api>,
  primaryToken: string,
  options: SimpleStreamOptions,
): FetchFunction | undefined {
  if (!pool || model.provider !== PRIMARY_ACCOUNT) return options.fetch;
  return createAccountRoutingFetch({
    pool,
    sessionId: options.sessionId,
    primaryToken,
    baseFetch: options.fetch,
  });
}
