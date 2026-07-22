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
import { createServer } from 'node:http';
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

  // 2. tools/list — should list 39 tools (34 + 3 generic lens tools, Phase 1
  //    chemin agent, north-star § Update 2026-07-10: list_lenses / get_lens_graph
  //    + narrate_lens, the narration surface wired to MCP; + 2 perimeter-expert
  //    tools, Task 10 expdoc: elysium_ask_expert / elysium_list_experts)
  const list = await send('tools/list');
  if (list.error) fail(`tools/list: ${list.error.message}`);
  const tools = list.result?.tools || [];
  if (tools.length !== 39) fail(`tools/list: expected 39 tools, got ${tools.length}`);
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
    // Phase 1 chemin agent — generic lens tools over the /lens contract.
    'gitnexus_list_lenses',
    'gitnexus_get_lens_graph',
    'gitnexus_narrate_lens',
    // Task 10 expdoc — perimeter-expert tools over the Σ-BRAIN-GRAPH-GATEWAY /expert contract.
    'elysium_ask_expert',
    'elysium_list_experts',
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
  // Tier 3.7 Phase C — assert version field is present so the UI header badge can
  // surface Sigma-COPILOT vX.Y (cf CopilotPanel.tsx > InventoryPayload.version).
  if (invPayload.version != null && typeof invPayload.version !== 'string') {
    fail(`gitnexus_copilot_inventory: 'version' should be a string when present, got ${typeof invPayload.version}`);
  }
  pass(`gitnexus_copilot_inventory → ${invPayload.count} tools, gate=${invPayload.gateVerdict}, 9/9 endpoints mapped, version=${invPayload.version ?? 'unset'}`);

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

  // 4i. tools/call gitnexus_narrate_lens — the narration surface (/lens/<name>/narrate).
  // Env-aware but falsifiable either way, so the tool is never left unexercised:
  //   - no INTER_GRAPH_URL → MUST be the documented stub (stub:true, markdown:null),
  //     never a crash and never a fabricated brief;
  //   - INTER_GRAPH_URL set → MUST be real markdown carrying the lens heading.
  const narr = await send('tools/call', { name: 'gitnexus_narrate_lens', arguments: { name: 'sigil' } });
  if (narr.result?.isError) fail(`gitnexus_narrate_lens(sigil): ${narr.result.content[0]?.text}`);
  if (!Array.isArray(narr.result?.content) || narr.result.content[0]?.type !== 'text') {
    fail('gitnexus_narrate_lens: unexpected response shape');
  }
  const narrPayload = JSON.parse(narr.result.content[0].text);
  if (narrPayload.format !== 'markdown') fail(`gitnexus_narrate_lens: format='${narrPayload.format}', expected 'markdown'`);
  if (!process.env.INTER_GRAPH_URL) {
    if (narrPayload.stub !== true) fail('gitnexus_narrate_lens: no INTER_GRAPH_URL but payload is not a stub');
    if (narrPayload.markdown !== null) fail('gitnexus_narrate_lens: stub must carry markdown:null, not a fabricated brief');
    if (typeof narrPayload.concern !== 'string') fail('gitnexus_narrate_lens: stub is missing its documented `concern`');
    pass('gitnexus_narrate_lens(sigil) → documented stub (INTER_GRAPH_URL unset)');
  } else {
    if (narrPayload.stub) fail(`gitnexus_narrate_lens: INTER_GRAPH_URL set but got a stub: ${narrPayload.concern}`);
    if (typeof narrPayload.markdown !== 'string' || !narrPayload.markdown.startsWith('# Lentille : sigil')) {
      fail(`gitnexus_narrate_lens: markdown does not start with the lens heading (got: ${String(narrPayload.markdown).slice(0, 60)})`);
    }
    if ('synthesis' in narrPayload) fail('gitnexus_narrate_lens: the removed `synthesis` option must not reappear in the payload');
    pass(`gitnexus_narrate_lens(sigil) → ${narrPayload.bytes} bytes of markdown`);
  }

  // 4i-bis. elysium_list_experts / elysium_ask_expert (Task 10 expdoc) — same
  // env-aware-but-falsifiable-either-way shape as the lens tools above:
  //   - no INTER_GRAPH_URL → MUST be the documented stub (stub:true, chunks:[],
  //     answer:null, confidence:'none'), never a crash and never a fabricated answer;
  //   - INTER_GRAPH_URL set → MUST be a live /expert response.
  const listExperts = await send('tools/call', { name: 'elysium_list_experts', arguments: {} });
  if (listExperts.result?.isError) fail(`elysium_list_experts: ${listExperts.result.content[0]?.text}`);
  if (!Array.isArray(listExperts.result?.content) || listExperts.result.content[0]?.type !== 'text') {
    fail('elysium_list_experts: unexpected response shape');
  }
  const listExpertsPayload = JSON.parse(listExperts.result.content[0].text);
  const ask = await send('tools/call', {
    name: 'elysium_ask_expert',
    arguments: { perimeter: 'doctrine', question: 'smoke test question', mode: 'retrieve' },
  });
  if (ask.result?.isError) fail(`elysium_ask_expert: ${ask.result.content[0]?.text}`);
  if (!Array.isArray(ask.result?.content) || ask.result.content[0]?.type !== 'text') {
    fail('elysium_ask_expert: unexpected response shape');
  }
  const askPayload = JSON.parse(ask.result.content[0].text);
  if (!process.env.INTER_GRAPH_URL) {
    if (listExpertsPayload.stub !== true) fail('elysium_list_experts: no INTER_GRAPH_URL but payload is not a stub');
    if (typeof listExpertsPayload.concern !== 'string') fail('elysium_list_experts: stub is missing its documented `concern`');
    pass('elysium_list_experts → documented stub (INTER_GRAPH_URL unset)');
    if (askPayload.stub !== true) fail('elysium_ask_expert: no INTER_GRAPH_URL but payload is not a stub');
    if (!Array.isArray(askPayload.chunks) || askPayload.chunks.length !== 0) {
      fail(`elysium_ask_expert: stub must carry chunks:[], not fabricated data (got ${JSON.stringify(askPayload.chunks)})`);
    }
    if (askPayload.answer !== null) fail('elysium_ask_expert: stub must carry answer:null, not a fabricated answer');
    if (askPayload.confidence !== 'none') fail(`elysium_ask_expert: stub confidence should be 'none', got '${askPayload.confidence}'`);
    pass('elysium_ask_expert(doctrine) → documented stub (INTER_GRAPH_URL unset)');
  } else {
    if (listExpertsPayload.stub) fail(`elysium_list_experts: INTER_GRAPH_URL set but got a stub: ${listExpertsPayload.concern}`);
    if (!Array.isArray(listExpertsPayload.experts)) fail('elysium_list_experts: missing `experts` array on a live response');
    pass(`elysium_list_experts → ${listExpertsPayload.experts.length} expert(s) declared`);
    if (askPayload.stub) fail(`elysium_ask_expert: INTER_GRAPH_URL set but got a stub: ${askPayload.concern}`);
    if (!Array.isArray(askPayload.chunks)) fail('elysium_ask_expert: missing `chunks` array on a live response');
    if (askPayload.answer !== null) fail(`elysium_ask_expert: mode=retrieve must not synthesize an answer, got: ${JSON.stringify(askPayload.answer).slice(0, 80)}`);
    pass(`elysium_ask_expert(doctrine, retrieve) → ${askPayload.chunks.length} chunk(s), confidence=${askPayload.confidence}`);
  }

  // 4j. gitnexus_narrate_lens on an UNKNOWN lens → the gateway 404 must surface
  // as a tool error. Only meaningful against a live gateway; the stub path has
  // no upstream to 404. Zero Masking: an unknown name is not an empty brief.
  if (process.env.INTER_GRAPH_URL) {
    const narrBad = await send('tools/call', {
      name: 'gitnexus_narrate_lens',
      arguments: { name: '__does_not_exist__' },
    });
    if (!narrBad.result?.isError) {
      fail(`gitnexus_narrate_lens(__does_not_exist__): expected an error, got ${narrBad.result?.content?.[0]?.text?.slice(0, 120)}`);
    }
    pass(`gitnexus_narrate_lens(unknown lens) → error surfaced: ${narrBad.result.content[0].text.slice(0, 60)}`);
  }

  // 4k. The gateway-backed tools against a FAKE gateway we control end-to-end.
  //
  // Why a fake and not the live gateway: the assertions below have to pin down
  // (a) that no `synthesis` param leaves the process, (b) that the markdown comes
  // back WHOLE, (c) that `bytes` is derived from that markdown and not a constant,
  // (d) that the contract-drift guard actually fires, and (e) that ALL FOUR
  // gateway routes name the gateway in their failure message. Against the live
  // gateway (b)/(c) are unverifiable — the smoke does not know the expected body —
  // and (e) would require taking the real gateway down. A fake makes all five
  // free, deterministic, and falsifiable.
  //
  // Each assertion was written against a mutation that previously survived BOTH
  // smoke modes:
  //   R1  handler reads `synthesis` again → a removed option silently returns
  //   M2  markdown.slice(0, 300)          → the brief is truncated, nobody notices
  //   M3  bytes: 1                        → the provenance envelope lies
  //   M6  remedy dropped on any one route → operator sent to the wrong service
  {
    const FIXTURE = [
      '# Lentille : fake — fixture de smoke.',
      '',
      '**Provenance** : source `2026-07-21T00:00:00` · fraîcheur **FRAÎCHE** · schéma `deadbeef` · 3 nœuds / 2 arêtes',
      '',
      '## Ce que dit la lentille',
      '- métrique A = 1',
      '- métrique B = 2',
      '',
      '## Répartition',
      '- `alpha` : 1 nœud',
      '- `beta` : 2 nœuds',
      '',
      // Padding so the body is comfortably longer than any plausible truncation
      // constant — a 300-char slice MUST lose the sentinel line below.
      'x'.repeat(400),
      '',
      'FIXTURE_TAIL_SENTINEL',
    ].join('\n');
    if (FIXTURE.length <= 300) fail('smoke bug: FIXTURE must exceed 300 chars for the truncation assertion to bite');

    /** Query strings the fake gateway saw, in order. */
    const seen = [];
    /** Flip to make /narrate answer application/json → exercises the drift guard. */
    let driftMode = false;
    /** Artificial server-side latency, used to prove the two timeout budgets differ. */
    let delayMs = 0;

    const fake = createServer((req, res) => {
      seen.push(req.url);
      const reply = () => {
        if (!/\/lens\/[^/]+\/narrate/.test(req.url)) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown route' }));
          return;
        }
        if (driftMode) {
          // Contract drift: the route stops serving text/markdown.
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ lens: 'fake', markdown: ['not', 'a', 'string'] }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        res.end(FIXTURE);
      };
      if (delayMs > 0) setTimeout(reply, delayMs); else reply();
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const fakePort = fake.address().port;

    // A second server.mjs, wired to the fake gateway. The outer server keeps the
    // ambient env (possibly no INTER_GRAPH_URL) — this one always has one, so the
    // gateway path is exercised regardless of how the smoke was invoked.
    const child = spawn(process.execPath, [join(here, 'server.mjs')], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, INTER_GRAPH_URL: `http://127.0.0.1:${fakePort}` },
    });
    const childPending = new Map();
    let childId = 1;
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && childPending.has(msg.id)) {
          childPending.get(msg.id)(msg);
          childPending.delete(msg.id);
        }
      } catch { /* stderr carries the logs; ignore non-JSON */ }
    });
    const childSend = (method, params) => new Promise((resolve, reject) => {
      const id = childId++;
      childPending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (childPending.has(id)) {
          childPending.delete(id);
          reject(new Error(`Timeout on ${method} (fake-gateway child)`));
        }
      }, 15000);
    });
    const cleanup = () => { child.kill(); fake.close(); };

    try {
      await childSend('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-fake-gateway', version: '0.0.0' },
      });

      const callNarrate = async (args) => {
        const r = await childSend('tools/call', { name: 'gitnexus_narrate_lens', arguments: args });
        return r.result;
      };

      // --- R1: `synthesis` is NOT a parameter of this tool, and cannot be
      // smuggled back in. ---
      //
      // The option was removed (see server.mjs, the tool description): the
      // gateway's synthesis branch is not a paid Claude call — it resolves to a
      // local ollama model — and its latency is workstation scheduling, so no
      // defensible cap exists. The HTTP route keeps the option for a human.
      //
      // Two halves, both necessary:
      //   (a) the ordinary call must not send it — a reintroduced default would
      //       block every narration for tens of seconds;
      //   (b) an agent that sends it ANYWAY (nothing validates inputSchema on
      //       this server — extra properties are simply ignored) must still get a
      //       normal, fast narration, and the gateway must never see the param.
      // (b) is the one that bites: it fails the moment the handler starts
      // reading `synthesis` again, whatever the comparison used (`=== true`,
      // `!!synthesis`, `!== false`).
      seen.length = 0;
      const noSynth = await callNarrate({ name: 'fake' });
      if (noSynth?.isError) fail(`fake-gateway narrate(default): ${noSynth.content[0]?.text}`);
      if (seen.length !== 1) fail(`fake-gateway: expected exactly 1 upstream request, saw ${seen.length}`);
      if (/synthesis/.test(seen[0])) {
        fail(`R1 REGRESSION: an ordinary narration put synthesis on the wire, gateway saw "${seen[0]}"`);
      }
      pass(`R1 covered: ordinary call sends no synthesis param ("${seen[0]}")`);

      seen.length = 0;
      const smuggled = await callNarrate({ name: 'fake', synthesis: true });
      if (smuggled?.isError) {
        fail(`R1: an ignored extra property must not break the call: ${smuggled.content[0]?.text}`);
      }
      if (/synthesis/.test(seen[0])) {
        fail(`R1 REGRESSION: synthesis:true from a client reached the gateway ("${seen[0]}") — the option is supposed to be gone from this surface`);
      }
      const smuggledPayload = JSON.parse(smuggled.content[0].text);
      if (smuggledPayload.markdown !== FIXTURE) fail('R1: smuggled-param call returned a different body');
      if ('synthesis' in smuggledPayload) {
        fail(`R1 REGRESSION: payload still carries a 'synthesis' field (${smuggledPayload.synthesis}) — a constant that only describes a removed option`);
      }
      pass(`R1 covered: client-sent synthesis:true is ignored, gateway saw "${seen[0]}"`);

      // --- N3: the lens name must be PERCENT-ENCODED into the path. ---
      //
      // The tool is advertised (ROADMAP #74) as following "the exact pattern of
      // the 2 existing lens tools (encodeURIComponent, …)" — yet dropping
      // encodeURIComponent left both smoke modes green. Real lens names are not
      // trivial identifiers: `health::graph_registry` already carries colons.
      // A name holding `/`, `?` or `#` would silently build a DIFFERENT URL —
      // route traversal, or an injected query parameter — with nothing to catch
      // it. Unencoded, the request below reaches `/lens/a/b?c`, which the fake
      // gateway 404s; encoded, it reaches one path segment as intended.
      seen.length = 0;
      const HOSTILE = 'a/b?c#d';
      const encoded = await callNarrate({ name: HOSTILE });
      if (seen.length !== 1) fail(`N3: expected exactly 1 upstream request, saw ${seen.length}`);
      if (seen[0] !== `/lens/${encodeURIComponent(HOSTILE)}/narrate`) {
        fail(
          `N3 REGRESSION: lens name not percent-encoded into the path — gateway saw "${seen[0]}", `
          + `expected "/lens/${encodeURIComponent(HOSTILE)}/narrate". A name containing / ? or # `
          + 'silently rewrites the route.',
        );
      }
      if (encoded?.isError) fail(`N3: encoded call should reach the fixture route, got ${encoded.content[0]?.text}`);
      pass(`N3 covered: hostile lens name encoded into one segment ("${seen[0]}")`);

      seen.length = 0;
      await callNarrate({ name: 'fake' });

      const payload = JSON.parse(noSynth.content[0].text);

      // --- M2: the markdown must arrive WHOLE, not truncated. ---
      if (payload.markdown !== FIXTURE) {
        fail(
          `M2 REGRESSION: markdown is not the byte-for-byte fixture `
          + `(got ${payload.markdown?.length} chars, expected ${FIXTURE.length}; `
          + `tail sentinel ${payload.markdown?.includes('FIXTURE_TAIL_SENTINEL') ? 'present' : 'MISSING'})`,
        );
      }
      pass(`M2 covered: markdown returned whole (${FIXTURE.length} chars, tail sentinel intact)`);

      // --- M3: `bytes` must be derived from the payload, not a constant. ---
      // The JSON envelope is justified by carrying interrogable provenance; a
      // hardcoded value would make that justification false.
      // The fixture contains accented characters ON PURPOSE, so UTF-8 bytes and
      // UTF-16 code units differ — which pins the UNIT too, not just the value.
      const fixtureBytes = Buffer.byteLength(FIXTURE, 'utf8');
      if (fixtureBytes === FIXTURE.length) fail('smoke bug: FIXTURE must contain non-ASCII so bytes and chars diverge');
      if (payload.bytes !== fixtureBytes) {
        fail(`M3 REGRESSION: bytes=${payload.bytes} but the markdown is ${fixtureBytes} UTF-8 bytes — provenance field is not derived from the content`);
      }
      if (payload.chars !== FIXTURE.length) {
        fail(`M3 REGRESSION: chars=${payload.chars}, expected ${FIXTURE.length}`);
      }
      if (payload.bytes <= 1) fail(`M3 REGRESSION: bytes=${payload.bytes} is a constant, not a measurement`);
      pass(`M3 covered: bytes=${payload.bytes} (UTF-8) / chars=${payload.chars} both derived from the content`);

      if (payload.lens !== 'fake') fail(`fake-gateway: payload.lens='${payload.lens}', expected 'fake'`);
      if (payload.format !== 'markdown') fail(`fake-gateway: payload.format='${payload.format}'`);

      // --- Contract-drift guard: typeof markdown !== 'string' must FAIL LOUD. ---
      // Presented as the Zero Masking net; until now nothing exercised it.
      driftMode = true;
      const drifted = await callNarrate({ name: 'fake' });
      if (!drifted?.isError) {
        fail(`drift guard REGRESSION: gateway served JSON on /narrate and the tool returned it as a success: ${drifted?.content?.[0]?.text?.slice(0, 160)}`);
      }
      if (!/contract drifted/i.test(drifted.content[0].text)) {
        fail(`drift guard: errored but with the wrong message: ${drifted.content[0].text.slice(0, 160)}`);
      }
      pass(`drift guard covered: non-string body → isError "${drifted.content[0].text.slice(0, 70)}…"`);
      driftMode = false;
    } finally {
      cleanup();
    }

    // --- Every gateway route must name the GATEWAY when it fails. ---
    // doCall is shared by all 37 tools and defaults to advising `docker compose
    // up -d`. For a gateway-backed route that sends an operator to restart a
    // service that was never involved. The fix threads a per-call `remedy`; this
    // block proves it reached ALL FOUR gateway routes of this file, not just the
    // one that motivated it — dropping it on any single route must go red here.
    //
    // Rather than sleep 30 s, we shrink the budget: a server that stalls 600 ms
    // must trip a 250 ms cap. Same failure branch, sub-second.
    //
    // Note the asymmetry this also pins: three routes surface the failure as an
    // isError tool result, while query_meta_graph swallows it into a stub
    // `concern` string. Both must carry the right remedy; only the *shape*
    // differs, and a caller reading `concern` deserves the same guidance.
    {
      const slow = spawn(process.execPath, [join(here, 'server.mjs')], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {
          ...process.env,
          INTER_GRAPH_URL: `http://127.0.0.1:${fakePort}`,
          GITNEXUS_TIMEOUT: '250',
        },
      });
      const slowPending = new Map();
      let slowId = 1;
      createInterface({ input: slow.stdout }).on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && slowPending.has(msg.id)) {
            slowPending.get(msg.id)(msg);
            slowPending.delete(msg.id);
          }
        } catch { /* ignore non-JSON */ }
      });
      const slowSend = (method, params) => new Promise((resolve, reject) => {
        const id = slowId++;
        slowPending.set(id, resolve);
        slow.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        setTimeout(() => {
          if (slowPending.has(id)) { slowPending.delete(id); reject(new Error(`Timeout on ${method} (slow child)`)); }
        }, 20000);
      });

      // Re-open the fake gateway for this second child (the finally above closed it).
      await new Promise((resolve) => fake.listen(fakePort, '127.0.0.1', resolve));
      delayMs = 600;
      try {
        await slowSend('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-timeout-split', version: '0.0.0' },
        });
        // The four gateway routes reachable from THIS file, one tool each.
        // `shape` says where the remedy has to land: 'isError' for the three lens
        // tools, 'concern' for query_meta_graph, which catches and downgrades.
        const GATEWAY_ROUTES = [
          { tool: 'gitnexus_list_lenses', args: {}, route: '/lens', shape: 'isError' },
          { tool: 'gitnexus_get_lens_graph', args: { name: 'fake' }, route: '/lens/<name>', shape: 'isError' },
          { tool: 'gitnexus_narrate_lens', args: { name: 'fake' }, route: '/lens/<name>/narrate', shape: 'isError' },
          { tool: 'query_meta_graph', args: {}, route: '/inter-graph', shape: 'concern' },
        ];

        for (const { tool, args, route, shape } of GATEWAY_ROUTES) {
          const r = (await slowSend('tools/call', { name: tool, arguments: args })).result;
          const text = r?.content?.[0]?.text ?? '';
          let message;
          if (shape === 'isError') {
            if (!r?.isError) {
              fail(`remedy: ${tool} (${route}) should have tripped the 250 ms cap on a 600 ms server, got: ${text.slice(0, 140)}`);
            }
            message = text;
          } else {
            // query_meta_graph catches the doCall error and returns a stub whose
            // `concern` embeds the message. Assert we actually took that branch,
            // otherwise the remedy check below could pass on unrelated prose.
            const payload = JSON.parse(text);
            if (payload.stub !== true || typeof payload.concern !== 'string') {
              fail(`remedy: ${tool} (${route}) was expected to degrade to a stub carrying a concern, got: ${text.slice(0, 200)}`);
            }
            message = payload.concern;
          }
          if (!/Timeout \(250ms\)/.test(message)) {
            fail(`remedy: ${tool} (${route}) did not report the 250 ms cap: ${message.slice(0, 160)}`);
          }
          if (/docker compose/i.test(message)) {
            fail(`remedy REGRESSION: ${tool} (${route}) still advises \`docker compose up -d\`: ${message.slice(0, 200)}`);
          }
          if (!/BRAIN-GRAPH-GATEWAY/.test(message)) {
            fail(`remedy REGRESSION: ${tool} (${route}) does not name the gateway: ${message.slice(0, 200)}`);
          }
          pass(`remedy covered: ${tool} → ${route} names the gateway (${shape})`);
        }
      } finally {
        slow.kill();
        fake.close();
        delayMs = 0;
      }
    }
  }

  // 4l. elysium_ask_expert against a FAKE gateway (Task 10 expdoc) — request
  // shaping + the two timeout budgets. Why a fake and not the live gateway: the
  // assertions below pin (a) the perimeter is percent-encoded into the path,
  // (b) the POST body carries exactly {question, mode, top_k} intact, and
  // (c) mode="answer" really uses a LONGER timeout than mode="retrieve" — the
  // whole reason this tool doesn't just reuse doCall's fixed FETCH_TIMEOUT_MS.
  // Shrunk budgets (250ms / 2000ms) keep this sub-second instead of sleeping 30s+.
  {
    /** Requests the fake gateway saw: {method, url, body}. */
    const seen = [];
    let delayMs = 0;
    const fakeExpert = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
        const reply = () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ chunks: [{ path: 'fake.md:1-3', score: 0.9 }], answer: null, confidence: 'high' }));
        };
        if (delayMs > 0) setTimeout(reply, delayMs); else reply();
      });
    });
    await new Promise((resolve) => fakeExpert.listen(0, '127.0.0.1', resolve));
    const fakeExpertPort = fakeExpert.address().port;

    const spawnExpertChild = (env) => {
      const child = spawn(process.execPath, [join(here, 'server.mjs')], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, INTER_GRAPH_URL: `http://127.0.0.1:${fakeExpertPort}`, ...env },
      });
      const p = new Map();
      let id = 1;
      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && p.has(msg.id)) { p.get(msg.id)(msg); p.delete(msg.id); }
        } catch { /* stderr carries logs */ }
      });
      const s = (method, params) => new Promise((resolve, reject) => {
        const mid = id++;
        p.set(mid, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }) + '\n');
        setTimeout(() => { if (p.has(mid)) { p.delete(mid); reject(new Error(`Timeout on ${method}`)); } }, 15000);
      });
      return { child, s };
    };

    // --- perimeter is percent-encoded + body carries exactly what was asked. ---
    {
      const { child, s } = spawnExpertChild({});
      try {
        await s('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-expert-fake', version: '0.0.0' } });
        seen.length = 0;
        const HOSTILE = 'a/b?c#d';
        const r = await s('tools/call', {
          name: 'elysium_ask_expert',
          arguments: { perimeter: HOSTILE, question: 'quelle Σ règle ?', mode: 'retrieve', top_k: 7 },
        });
        if (seen.length !== 1) fail(`elysium_ask_expert fake-gateway: expected exactly 1 upstream request, saw ${seen.length}`);
        const expectedPath = `/expert/${encodeURIComponent(HOSTILE)}`;
        if (seen[0].url !== expectedPath) {
          fail(`elysium_ask_expert REGRESSION: perimeter not percent-encoded — gateway saw "${seen[0].url}", expected "${expectedPath}"`);
        }
        if (seen[0].method !== 'POST') fail(`elysium_ask_expert: expected POST, gateway saw ${seen[0].method}`);
        const sentBody = seen[0].body;
        if (sentBody.question !== 'quelle Σ règle ?') fail(`elysium_ask_expert: question not forwarded intact (got ${JSON.stringify(sentBody.question)})`);
        if (sentBody.mode !== 'retrieve') fail(`elysium_ask_expert: mode not forwarded (got ${sentBody.mode})`);
        if (sentBody.top_k !== 7) fail(`elysium_ask_expert: top_k not forwarded (got ${sentBody.top_k})`);
        if (r.result?.isError) fail(`elysium_ask_expert fake-gateway call errored: ${r.result.content[0]?.text}`);
        pass(`elysium_ask_expert fake-gateway: perimeter percent-encoded ("${seen[0].url}"), body={question,mode,top_k} forwarded intact, Σ round-trips`);
      } finally {
        child.kill();
      }
    }

    // --- mode="answer" uses a LONGER timeout than mode="retrieve". ---
    // GITNEXUS_TIMEOUT caps the default (retrieve) path; ELYSIUM_EXPERT_ANSWER_TIMEOUT_MS
    // caps mode="answer". A 600ms-delayed fake gateway must trip a 250ms retrieve
    // cap but survive under a 2000ms answer cap — proving the two budgets are
    // actually distinct code paths, not a single shared constant.
    {
      const { child, s } = spawnExpertChild({ GITNEXUS_TIMEOUT: '250', ELYSIUM_EXPERT_ANSWER_TIMEOUT_MS: '2000' });
      try {
        await s('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-expert-timeout', version: '0.0.0' } });
        delayMs = 600;
        seen.length = 0;
        const retr = await s('tools/call', {
          name: 'elysium_ask_expert',
          arguments: { perimeter: 'doctrine', question: 'q', mode: 'retrieve' },
        });
        if (!retr.result?.isError) {
          fail(`elysium_ask_expert(mode=retrieve): should have tripped the 250ms cap on a 600ms server, got: ${retr.result?.content?.[0]?.text?.slice(0, 140)}`);
        }
        if (!/Timeout \(250ms\)/.test(retr.result.content[0].text)) {
          fail(`elysium_ask_expert(mode=retrieve): did not report the 250ms cap: ${retr.result.content[0].text.slice(0, 160)}`);
        }
        pass('elysium_ask_expert(mode=retrieve) → tripped the 250ms cap as expected on a 600ms server');

        const ans = await s('tools/call', {
          name: 'elysium_ask_expert',
          arguments: { perimeter: 'doctrine', question: 'q', mode: 'answer' },
        });
        if (ans.result?.isError) {
          fail(`elysium_ask_expert(mode=answer) REGRESSION: should have survived under the 2000ms cap on a 600ms server, got: ${ans.result.content[0]?.text}`);
        }
        pass('elysium_ask_expert(mode=answer) → survived the 600ms delay under the 2000ms cap (proves the two timeout budgets are distinct)');
      } finally {
        child.kill();
        delayMs = 0;
      }
    }
    fakeExpert.close();
  }

  // 5. Unknown tool → isError content
  const bad = await send('tools/call', { name: 'gitnexus_does_not_exist', arguments: {} });
  if (!bad.error) fail('Unknown tool should have returned an RPC error');
  pass(`unknown tool → RPC error code ${bad.error.code}`);

  // 6. Unknown method → method-not-found
  const noMethod = await send('totally/unknown', {});
  if (noMethod.error?.code !== -32601) fail('Unknown method should return -32601');
  pass(`unknown method → -32601 method-not-found`);

  // 7. --live-gateway (north-star Phase 1 item 8 — agent-symmetry-smoke).
  //    Falsifiable assertions of the /lens agent path against a LIVE
  //    Σ-BRAIN-GRAPH-GATEWAY (127.0.0.1:4750 + INTER_GRAPH_URL). Opt-in so the
  //    default smoke stays stack-optional. This is the phase exit criterion.
  if (process.argv.includes('--live-gateway')) {
    if (!process.env.INTER_GRAPH_URL) {
      fail('--live-gateway needs INTER_GRAPH_URL (start sigma_brain_graph_gateway.py --host 127.0.0.1 --port 4750)');
    }
    /** Raw MCP text of a tool result — this is what the agent's context pays for. */
    const callRaw = async (name, args = {}) => {
      const r = await send('tools/call', { name, arguments: args });
      return r.result.content[0].text;
    };
    const callJson = async (name, args = {}) => JSON.parse(await callRaw(name, args));
    // a. list_lenses advertises the registry incl. health::graph_registry (item 5).
    const lenses = await callJson('gitnexus_list_lenses');
    if (lenses.stub) fail(`live: gitnexus_list_lenses stub — gateway unreachable: ${lenses.concern}`);
    const names = (lenses.lenses || []).map((l) => l.name);
    for (const need of ['inter_graph', 'sigil', 'health::graph_registry']) {
      if (!names.includes(need)) fail(`live: lens "${need}" absent from list_lenses (got: ${names.join(', ')})`);
    }
    pass(`live: list_lenses → ${names.length} lenses incl. health::graph_registry`);
    // b. inter_graph coherent with query_meta_graph (both = the 19 InterGraphRel).
    const ig = await callJson('gitnexus_get_lens_graph', { name: 'inter_graph' });
    const qm = await callJson('query_meta_graph');
    if (ig.stub || qm.stub) fail('live: inter_graph / query_meta_graph returned a stub');
    if ((ig.relationships?.length ?? 0) !== (qm.relationships?.length ?? -1)) {
      fail(`live: inter_graph rels (${ig.relationships?.length}) != query_meta_graph rels (${qm.relationships?.length})`);
    }
    pass(`live: inter_graph == query_meta_graph → ${ig.relationships.length} InterGraphRel`);
    // c. STALE-count coherence: health::graph_registry is fetchable via the
    //    generic /lens contract (item 5 unification) and carries content.
    const hr = await callJson('gitnexus_get_lens_graph', { name: 'health::graph_registry' });
    if (hr.stub || hr.error) fail(`live: health::graph_registry not served via /lens: ${hr.error || hr.concern}`);
    if (!(hr.nodes?.length > 0)) fail('live: health::graph_registry has no nodes');
    pass(`live: health::graph_registry via /lens → ${hr.nodes.length} nodes (item 5 unification)`);
    // d. SIGIL-on-witness-file: the sigil graph is non-empty and its
    //    meta.freshness verdict is present (item 6) — the agent can tell whether
    //    it is trusting stale data.
    const sig = await callJson('gitnexus_get_lens_graph', { name: 'sigil' });
    if (sig.stub) fail('live: sigil lens stub');
    const fr = sig.meta?.freshness;
    if (!fr || typeof fr.stale !== 'boolean') fail(`live: sigil meta.freshness missing/invalid: ${JSON.stringify(fr)}`);
    if (!(sig.nodes?.length > 0)) fail('live: sigil graph empty (regen the ground truth)');
    pass(`live: sigil → ${sig.nodes.length} nodes, freshness.stale=${fr.stale} (item 6)`);
    // e. contention proxy: two concurrent reads both succeed (gateway is
    //    read-only, ThreadingHTTPServer). Full "read during a live sentinel-writer
    //    run" is the graved human-test.
    const [c1, c2] = await Promise.all([
      callJson('gitnexus_get_lens_graph', { name: 'inter_graph' }),
      callJson('gitnexus_get_lens_graph', { name: 'inter_graph' }),
    ]);
    if (c1.stub || c2.stub || !(c1.relationships?.length > 0) || !(c2.relationships?.length > 0)) {
      fail('live: concurrent reads did not both succeed (contention)');
    }
    pass('live: 2 concurrent reads OK (read-only contention proxy)');
    // f. narration surface: the whole point of gitnexus_narrate_lens is that it
    //    is DRASTICALLY cheaper than the graph for a "what does it say" question.
    //    Assert that empirically rather than assume it — same lens, both surfaces.
    const narRaw = await callRaw('gitnexus_narrate_lens', { name: 'sigil' });
    const nar = JSON.parse(narRaw);
    if (nar.stub) fail(`live: gitnexus_narrate_lens stub — gateway unreachable: ${nar.concern}`);
    if (!nar.markdown?.startsWith('# Lentille : sigil')) fail('live: narration missing its lens heading');
    if (!nar.markdown.includes('**Provenance**')) fail('live: narration missing the Provenance line (freshness verdict)');
    if ('synthesis' in nar) fail('live: the removed `synthesis` option reappeared in the payload');
    // The self-reported byte count must match the body it describes.
    const narrationBytes = Buffer.byteLength(nar.markdown, 'utf8');
    if (nar.bytes !== narrationBytes) {
      fail(`live: payload.bytes=${nar.bytes} disagrees with the actual UTF-8 length ${narrationBytes}`);
    }
    // The advertised saving is compared on the basis the AGENT actually pays:
    // the UTF-8 bytes of the MCP text block, pretty-printed by tools/call. An
    // earlier revision compared the raw markdown against a compact re-stringify
    // of the graph — neither side was what either tool delivers, and the two
    // bases differed from each other, so the published ratio described no real
    // transaction. Measured 2026-07-21 on this basis: ~40×. The assertion pins
    // the DIRECTION, since both sides grow with the lens.
    const graphRaw = await callRaw('gitnexus_get_lens_graph', { name: 'sigil' });
    const narDelivered = Buffer.byteLength(narRaw, 'utf8');
    const graphDelivered = Buffer.byteLength(graphRaw, 'utf8');
    if (!(narDelivered < graphDelivered)) {
      fail(`live: narration (${narDelivered}B delivered) is not smaller than the graph (${graphDelivered}B delivered) — the tool has no reason to exist`);
    }
    pass(`live: narrate_lens(sigil) → ${narDelivered}B vs ${graphDelivered}B graph, as delivered to the agent (${(graphDelivered / narDelivered).toFixed(1)}× cheaper)`);

    // g. Task 10 expdoc — elysium_list_experts / elysium_ask_expert against the
    //    LIVE Σ-BRAIN-GRAPH-GATEWAY doctrine index (8251 chunks). mode="retrieve"
    //    only — mode="answer" calls a real local LLM and is deliberately NOT
    //    exercised by an automated test (see server task constraints); it is
    //    verified manually (see expdoc-task-10-report.md).
    const experts = await callJson('elysium_list_experts');
    if (experts.stub) fail(`live: elysium_list_experts stub — gateway unreachable: ${experts.concern}`);
    const expertNames = (experts.experts || []).map((e) => e.name);
    if (!expertNames.includes('doctrine')) fail(`live: "doctrine" perimeter absent from elysium_list_experts (got: ${expertNames.join(', ')})`);
    pass(`live: elysium_list_experts → ${expertNames.length} perimeter(s) incl. doctrine`);

    // Golden question (calibration measured SIGIL-561 as its rank-1 hit,
    // 2026-07-22): the retrieval core must actually surface it, citations
    // must carry path:line, and French/Σ text must round-trip UTF-8 intact.
    const askLive = await callJson('elysium_ask_expert', {
      perimeter: 'doctrine',
      question: 'Quel mécanisme de lock atomique coordonne les sessions concurrentes ?',
      mode: 'retrieve',
    });
    if (askLive.stub) fail(`live: elysium_ask_expert stub — gateway unreachable: ${askLive.concern}`);
    if (!Array.isArray(askLive.chunks) || askLive.chunks.length === 0) fail('live: elysium_ask_expert(doctrine) returned no chunks for the SIGIL-561 golden question');
    if (askLive.answer !== null) fail(`live: mode=retrieve must not synthesize an answer, got: ${JSON.stringify(askLive.answer).slice(0, 80)}`);
    const hitSigil561 = askLive.chunks.find((c) => /SIGIL-561/.test(c.path || ''));
    if (!hitSigil561) {
      fail(`live: SIGIL-561 not found among ${askLive.chunks.length} chunk(s) — paths: ${askLive.chunks.map((c) => c.path).join(', ')}`);
    }
    if (!/:\d+/.test(hitSigil561.path)) fail(`live: SIGIL-561 chunk path missing a :line citation (got "${hitSigil561.path}")`);
    if (!/Σ/.test(JSON.stringify(askLive.chunks))) fail('live: expected an intact "Σ" somewhere in the returned chunks — UTF-8 mangled?');
    pass(`live: elysium_ask_expert(doctrine, retrieve) → SIGIL-561 at "${hitSigil561.path}", confidence=${askLive.confidence}, Σ intact`);
  }

  console.log('\nAll smoke checks passed.');
  server.kill();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
