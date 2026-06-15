#!/usr/bin/env node
/**
 * Manual smoke test for the MCP analytics server.
 *
 * Spawns ./server.mjs as a child process and pipes JSON-RPC messages
 * to it on stdin, asserts the responses on stdout. This is the
 * minimum we can do without a full test harness (the test pyramid
 * Phase 1 is blocked on Node 22 per
 * docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md).
 *
 *   node smoke.mjs
 *
 * Exits 0 on success, non-zero on first failure. Needs the gitnexus
 * stack running locally so the tool handlers actually return data.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const rl = createInterface({ input: server.stdout });
const pending = new Map();
let nextId = 1;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  } catch {
    // Ignore non-JSON lines (shouldn't happen — server logs to stderr).
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }
    }, 35000);
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  server.kill();
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

try {
  // 1. initialize
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.0' },
  });
  if (init.error) fail(`initialize: ${init.error.message}`);
  if (init.result?.protocolVersion !== '2024-11-05') fail('initialize: wrong protocolVersion');
  if (init.result?.serverInfo?.name !== 'gitnexus-analytics') fail('initialize: wrong serverInfo');
  pass(`initialize → ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  notify('notifications/initialized');

  // 2. tools/list — should list 34 tools (31 + 3 Mycelium synergy consumers Tier 3.7 Phase A Tasks A2/A3/A4)
  const list = await send('tools/list');
  if (list.error) fail(`tools/list: ${list.error.message}`);
  const tools = list.result?.tools || [];
  if (tools.length !== 34) fail(`tools/list: expected 34 tools, got ${tools.length}`);
  for (const expected of [
    'gitnexus_list_repos', 'gitnexus_entropy', 'gitnexus_churn', 'gitnexus_coupling',
    'gitnexus_growth', 'gitnexus_lifespan', 'gitnexus_ownership', 'gitnexus_dissonance',
    'gitnexus_semantic_labels', 'gitnexus_coupling_cross', 'gitnexus_growth_cross',
    'gitnexus_similarity', 'gitnexus_entropy_commits', 'gitnexus_watches',
    'gitnexus_repo_by_id', 'gitnexus_commit_footprint', 'gitnexus_snapshot_auto',
    'gitnexus_snapshot_from_pr', 'gitnexus_ghost_audit', 'gitnexus_clusters',
    'gitnexus_regression',
    'query_meta_graph',
    'gitnexus_list_graph_templates', 'gitnexus_create_graph_from_template', 'gitnexus_import_into_graph',
    'gitnexus_copilot_inventory',
    // Tier 3.7 Phase A Tasks A2/A3/A4 — Mycelium synergy consumers.
    'gitnexus_copilot_blt_context',
    'gitnexus_copilot_cluster_context',
    'gitnexus_copilot_forge_context',
  ]) {
    if (!tools.find((t) => t.name === expected)) fail(`tools/list: missing ${expected}`);
  }
  pass(`tools/list → ${tools.length} tools (all expected present)`);

  // 3. tools/call gitnexus_list_repos — hits API at :4747
  const repos = await send('tools/call', { name: 'gitnexus_list_repos', arguments: {} });
  if (repos.result?.isError) {
    console.warn(`SKIP: gitnexus_list_repos returned error (stack down?): ${repos.result.content[0]?.text}`);
  } else if (Array.isArray(repos.result?.content) && repos.result.content[0]?.type === 'text') {
    const payload = JSON.parse(repos.result.content[0].text);
    const list = Array.isArray(payload) ? payload : payload?.repos || [];
    pass(`gitnexus_list_repos → ${list.length} repos indexed`);
    if (list.length >= 1) {
      const repo = list[0].name;
      // 4. tools/call gitnexus_entropy — hits gitnexus-web at :4173
      const ent = await send('tools/call', {
        name: 'gitnexus_entropy',
        arguments: { repo },
      });
      if (ent.result?.isError) {
        fail(`gitnexus_entropy(${repo}): ${ent.result.content[0]?.text}`);
      } else {
        const data = JSON.parse(ent.result.content[0].text);
        pass(`gitnexus_entropy(${repo}) → totalPoints=${data.totalPoints}`);
      }
      // 4b. tools/call gitnexus_ghost_audit — hits gitnexus-web at :4173
      // Tolerant: a repo with no ghosts synced yet is expected to error;
      // we only care that the handler wires through.
      const audit = await send('tools/call', {
        name: 'gitnexus_ghost_audit',
        arguments: { repo },
      });
      if (audit.result?.isError) {
        console.warn(`SKIP: gitnexus_ghost_audit(${repo}) returned error (no ghosts synced yet?): ${audit.result.content[0]?.text}`);
      } else if (Array.isArray(audit.result?.content) && audit.result.content[0]?.type === 'text') {
        const payload = JSON.parse(audit.result.content[0].text);
        pass(`gitnexus_ghost_audit(${repo}) → ${payload.audit?.summary?.total ?? '?'} ghosts (cached=${payload.audit?.cached ?? '?'})`);
      } else {
        fail(`gitnexus_ghost_audit(${repo}): unexpected response shape`);
      }
      // 4c. tools/call gitnexus_clusters — hits gitnexus-web at :4173
      // Tolerant: a repo without synced ghosts (or without clusters.json yet)
      // is expected to error; we only care that the handler wires through.
      const clusters = await send('tools/call', {
        name: 'gitnexus_clusters',
        arguments: { repo },
      });
      if (clusters.result?.isError) {
        console.warn(`SKIP: gitnexus_clusters(${repo}) returned error (no clusters synced yet?): ${clusters.result.content[0]?.text}`);
      } else if (Array.isArray(clusters.result?.content) && clusters.result.content[0]?.type === 'text') {
        const payload = JSON.parse(clusters.result.content[0].text);
        const cs = payload.data?.clusters || [];
        pass(`gitnexus_clusters(${repo}) → ${cs.length} cluster(s)`);
      } else {
        fail(`gitnexus_clusters(${repo}): unexpected response shape`);
      }
      // 4d. tools/call gitnexus_regression — hits gitnexus-web at :4173
      // Tolerant: the endpoint may error if snapshots are insufficient;
      // we only care that the handler wires through and returns a verdict shape.
      const regression = await send('tools/call', {
        name: 'gitnexus_regression',
        arguments: { repo, metric: 'density' },
      });
      if (regression.result?.isError) {
        console.warn(`SKIP: gitnexus_regression(${repo}) returned error (insufficient snapshots?): ${regression.result.content[0]?.text}`);
      } else if (Array.isArray(regression.result?.content) && regression.result.content[0]?.type === 'text') {
        const payload = JSON.parse(regression.result.content[0].text);
        if (typeof payload.metric !== 'string') fail(`gitnexus_regression(${repo}): missing 'metric' field`);
        if (typeof payload.regressed !== 'boolean') fail(`gitnexus_regression(${repo}): 'regressed' is not a boolean`);
        pass(`gitnexus_regression(${repo}) → metric=${payload.metric} regressed=${payload.regressed}`);
      } else {
        fail(`gitnexus_regression(${repo}): unexpected response shape`);
      }
    }
  } else {
    fail(`gitnexus_list_repos: unexpected response shape`);
  }

  // 4e. tools/call gitnexus_copilot_inventory — Tier 3.7 A1 gate (no stack dep)
  // Pure local helper : asserts the inventory shape + GREEN gate verdict.
  const inv = await send('tools/call', { name: 'gitnexus_copilot_inventory', arguments: {} });
  if (inv.result?.isError) fail(`gitnexus_copilot_inventory: ${inv.result.content[0]?.text}`);
  if (!Array.isArray(inv.result?.content) || inv.result.content[0]?.type !== 'text') {
    fail('gitnexus_copilot_inventory: unexpected response shape');
  }
  const invPayload = JSON.parse(inv.result.content[0].text);
  if (!Array.isArray(invPayload.tools) || invPayload.tools.length === 0) {
    fail(`gitnexus_copilot_inventory: tools array empty (got ${invPayload.tools?.length})`);
  }
  if (invPayload.gateVerdict !== 'GREEN') {
    fail(`gitnexus_copilot_inventory: expected GREEN gate verdict, got ${invPayload.gateVerdict} (missing: ${(invPayload.missing || []).join(',')})`);
  }
  if (!Array.isArray(invPayload.mapping) || invPayload.mapping.length !== 9) {
    fail(`gitnexus_copilot_inventory: expected 9 endpoint mappings, got ${invPayload.mapping?.length}`);
  }
  pass(`gitnexus_copilot_inventory → ${invPayload.count} tools, gate=${invPayload.gateVerdict}, 9/9 endpoints mapped`);

  // 4f. tools/call gitnexus_copilot_blt_context — Tier 3.7 Phase A Task A2 (no stack dep)
  // Pure local read of the BLT ledger ; tolerant when the file is absent
  // (mode=absent is a valid live response, not an error).
  const blt = await send('tools/call', { name: 'gitnexus_copilot_blt_context', arguments: { limit: 10 } });
  if (blt.result?.isError) fail(`gitnexus_copilot_blt_context: ${blt.result.content[0]?.text}`);
  if (!Array.isArray(blt.result?.content) || blt.result.content[0]?.type !== 'text') {
    fail('gitnexus_copilot_blt_context: unexpected response shape');
  }
  const bltPayload = JSON.parse(blt.result.content[0].text);
  if (typeof bltPayload.tx_count !== 'number') fail(`gitnexus_copilot_blt_context: missing 'tx_count' field`);
  if (!['live', 'absent', 'error'].includes(bltPayload.mode)) {
    fail(`gitnexus_copilot_blt_context: unexpected mode='${bltPayload.mode}'`);
  }
  pass(`gitnexus_copilot_blt_context → mode=${bltPayload.mode}, tx_count=${bltPayload.tx_count}`);

  // 4g. tools/call gitnexus_copilot_cluster_context — Tier 3.7 Phase A Task A3 (no stack dep)
  // Pure local hash-chain verification ; chain_valid=null when ledger absent
  // (valid live response).
  const cluster = await send('tools/call', { name: 'gitnexus_copilot_cluster_context', arguments: { limit: 10 } });
  if (cluster.result?.isError) fail(`gitnexus_copilot_cluster_context: ${cluster.result.content[0]?.text}`);
  if (!Array.isArray(cluster.result?.content) || cluster.result.content[0]?.type !== 'text') {
    fail('gitnexus_copilot_cluster_context: unexpected response shape');
  }
  const clusterPayload = JSON.parse(cluster.result.content[0].text);
  if (typeof clusterPayload.total_entries !== 'number') fail(`gitnexus_copilot_cluster_context: missing 'total_entries' field`);
  if (!['live', 'absent', 'error'].includes(clusterPayload.mode)) {
    fail(`gitnexus_copilot_cluster_context: unexpected mode='${clusterPayload.mode}'`);
  }
  pass(`gitnexus_copilot_cluster_context → mode=${clusterPayload.mode}, total=${clusterPayload.total_entries}, chain_valid=${clusterPayload.chain_valid}`);

  // 4h. tools/call gitnexus_copilot_forge_context — Tier 3.7 Phase A Task A4 (no stack dep)
  // Pure local read of Forge concepts ; mode=stub when no backend is reachable
  // (valid live response). Tolerant : nodes array can be empty.
  const forge = await send('tools/call', { name: 'gitnexus_copilot_forge_context', arguments: { depth: 1 } });
  if (forge.result?.isError) fail(`gitnexus_copilot_forge_context: ${forge.result.content[0]?.text}`);
  if (!Array.isArray(forge.result?.content) || forge.result.content[0]?.type !== 'text') {
    fail('gitnexus_copilot_forge_context: unexpected response shape');
  }
  const forgePayload = JSON.parse(forge.result.content[0].text);
  if (!Array.isArray(forgePayload.nodes)) fail(`gitnexus_copilot_forge_context: 'nodes' is not an array`);
  if (!Array.isArray(forgePayload.edges)) fail(`gitnexus_copilot_forge_context: 'edges' is not an array`);
  if (!['bridge', 'jsonl', 'stub'].includes(forgePayload.mode)) {
    fail(`gitnexus_copilot_forge_context: unexpected mode='${forgePayload.mode}'`);
  }
  pass(`gitnexus_copilot_forge_context → mode=${forgePayload.mode}, nodes=${forgePayload.nodes.length}, edges=${forgePayload.edges.length}`);

  // 5. Unknown tool → isError content
  const bad = await send('tools/call', { name: 'gitnexus_does_not_exist', arguments: {} });
  if (!bad.error) fail('Unknown tool should have returned an RPC error');
  pass(`unknown tool → RPC error code ${bad.error.code}`);

  // 6. Unknown method → method-not-found
  const noMethod = await send('totally/unknown', {});
  if (noMethod.error?.code !== -32601) fail('Unknown method should return -32601');
  pass(`unknown method → -32601 method-not-found`);

  console.log('\nAll smoke checks passed.');
  server.kill();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
