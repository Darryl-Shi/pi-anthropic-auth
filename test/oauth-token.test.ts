import assert from "node:assert/strict";
import { test } from "vitest";
import { isAnthropicOAuthToken } from "#src/oauth-token";

const OAUTH_TOKEN = "sk-ant-oat01-example-access-token";
const API_KEY = "sk-ant-api03-example-api-key";

test("isAnthropicOAuthToken recognizes only sk-ant-oat access tokens", () => {
  assert.equal(isAnthropicOAuthToken(OAUTH_TOKEN), true);
  assert.equal(isAnthropicOAuthToken(API_KEY), false);
  assert.equal(isAnthropicOAuthToken(undefined), false);
  assert.equal(isAnthropicOAuthToken(""), false);
});
