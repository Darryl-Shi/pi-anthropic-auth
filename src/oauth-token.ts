/**
 * Anthropic OAuth access tokens are issued with an `sk-ant-oat` prefix.
 *
 * This is the same signal Pi's built-in Anthropic provider uses internally to
 * decide whether to emit Claude Code identity headers, so gating on it keeps
 * our shaping aligned with Pi's own OAuth detection.
 */
const ANTHROPIC_OAUTH_TOKEN_MARKER = "sk-ant-oat";

/**
 * Returns true when the resolved API key is an Anthropic OAuth access token.
 *
 * API-key requests (and OAuth tokens for other providers) return false, so the
 * caller leaves their payloads untouched.
 */
export function isAnthropicOAuthToken(
  apiKey: string | undefined,
): apiKey is string {
  return (
    typeof apiKey === "string" && apiKey.includes(ANTHROPIC_OAUTH_TOKEN_MARKER)
  );
}
