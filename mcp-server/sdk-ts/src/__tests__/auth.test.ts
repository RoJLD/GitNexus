/**
 * Tier 3.7 Phase B'5 — Bearer auth unit tests for the TypeScript SDK.
 *
 * Runner : `node --test` (Node 18+ built-in). No Jest/Vitest dep required
 * (Iron Rule Sigma-COPILOT-SDK-2 cross-link : the SDK stays a lean transport
 * wrapper — test stack stays equally lean).
 *
 * Iron Rule Sigma-COPILOT-SDK-AUTH-1 (Sigma-BEARER-AUTH-MANDATORY) :
 *   when authToken is set, every request carries `Authorization: Bearer <t>`.
 *   401/403 surfaces as `CopilotAuthError` (subclass of CopilotHTTPError).
 *
 * Build first with `npm run build` then run with
 * `node --test dist/__tests__/auth.test.js`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { GitnexusCopilotClient, CopilotAuthError, CopilotHTTPError } from "../client.js";

type FetchCall = { url: string; init: RequestInit };

function makeFakeFetch(
  status: number,
  body: unknown,
  capture: FetchCall[],
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    capture.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("authToken attaches Bearer header to every request", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch = makeFakeFetch(
    200,
    {
      count: 0,
      tools: [],
      requiredEndpoints: [],
      mapping: {},
      gateVerdict: "pass",
    },
    calls,
  );

  const client = new GitnexusCopilotClient({
    baseUrl: "http://example.test",
    fetch: fakeFetch,
    authToken: "sk-test-abc123",
  });

  await client.mcpInventory();

  assert.equal(calls.length, 1);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer sk-test-abc123");
  assert.equal(headers["Accept"], "application/json");
});

test("no authToken means no Authorization header is sent", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch = makeFakeFetch(
    200,
    {
      count: 0,
      tools: [],
      requiredEndpoints: [],
      mapping: {},
      gateVerdict: "pass",
    },
    calls,
  );

  const client = new GitnexusCopilotClient({
    baseUrl: "http://example.test",
    fetch: fakeFetch,
  });

  await client.mcpInventory();

  assert.equal(calls.length, 1);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], undefined);
});

test("401 response surfaces as CopilotAuthError (subclass of CopilotHTTPError)", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch = makeFakeFetch(401, { error: "invalid token" }, calls);

  const client = new GitnexusCopilotClient({
    baseUrl: "http://example.test",
    fetch: fakeFetch,
    authToken: "sk-expired",
  });

  await assert.rejects(
    async () => {
      await client.mcpInventory();
    },
    (err: unknown) => {
      assert.ok(err instanceof CopilotAuthError, "must be CopilotAuthError");
      assert.ok(err instanceof CopilotHTTPError, "must subclass CopilotHTTPError");
      assert.equal((err as CopilotAuthError).status, 401);
      assert.match((err as CopilotAuthError).body, /invalid token/);
      return true;
    },
  );
});

test("403 response also surfaces as CopilotAuthError", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch = makeFakeFetch(403, { error: "scope missing" }, calls);

  const client = new GitnexusCopilotClient({
    baseUrl: "http://example.test",
    fetch: fakeFetch,
    authToken: "sk-low-scope",
  });

  await assert.rejects(
    async () => {
      await client.mcpInventory();
    },
    (err: unknown) => {
      assert.ok(err instanceof CopilotAuthError);
      assert.equal((err as CopilotAuthError).status, 403);
      return true;
    },
  );
});

test("authToken wins over a manually-set Authorization header (collision)", async () => {
  const calls: FetchCall[] = [];
  const fakeFetch = makeFakeFetch(
    200,
    {
      count: 0,
      tools: [],
      requiredEndpoints: [],
      mapping: {},
      gateVerdict: "pass",
    },
    calls,
  );

  const client = new GitnexusCopilotClient({
    baseUrl: "http://example.test",
    fetch: fakeFetch,
    authToken: "sk-canonical",
    headers: { Authorization: "Bearer sk-stale" },
  });

  await client.mcpInventory();

  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer sk-canonical");
});
