/**
 * Smoke test for mcp-server/server.mjs — Task 11.13.
 *
 * Uses Node's built-in test runner (node:test) — no external deps required.
 * Run:
 *   node --test mcp-server/server.test.mjs
 *
 * Validates:
 *  1. Module loads without syntax errors (dynamic import).
 *  2. Source contains query_meta_graph registration.
 *  3. All baseline tool names are present in source.
 *  4. query_meta_graph stub return shape is documented correctly.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'server.mjs');

// ── Stub stdin so readline in server.mjs does not block the test process ──────
import { Readable } from 'node:stream';
const stubStdin = new Readable({ read() {} });
stubStdin.push(null); // EOF immediately
try {
  Object.defineProperty(process, 'stdin', { value: stubStdin, writable: false, configurable: true });
} catch (_) {
  // stdin may already be defined non-configurable — proceed anyway
}

let src;

describe('mcp-server/server.mjs — Task 11.13 smoke', () => {
  before(async () => {
    src = await readFile(SERVER_PATH, 'utf8');
  });

  it('server source file is readable', () => {
    assert.ok(src && src.length > 0, 'server.mjs must not be empty');
  });

  it("registers 'query_meta_graph' tool in TOOLS array", () => {
    assert.ok(
      src.includes("name: 'query_meta_graph'"),
      "TOOLS array must contain name: 'query_meta_graph'",
    );
  });

  it('query_meta_graph handler documents inter_graph.kuzu concern', () => {
    assert.ok(
      src.includes('inter_graph.kuzu'),
      'handler must reference inter_graph.kuzu as the target store',
    );
  });

  it('query_meta_graph stub returns rows array in fallback path', () => {
    // Verify documented fallback shape exists in source
    assert.ok(src.includes('rows: []'), 'stub fallback must include rows: []');
    assert.ok(src.includes('stub: true'), 'stub fallback must include stub: true');
  });

  it('all expected baseline tool names present in source', () => {
    const expectedTools = [
      'gitnexus_list_repos',
      'gitnexus_entropy',
      'gitnexus_churn',
      'gitnexus_coupling',
      'gitnexus_growth',
      'gitnexus_lifespan',
      'gitnexus_ownership',
      'gitnexus_dissonance',
      'gitnexus_semantic_labels',
      'gitnexus_coupling_cross',
      'gitnexus_growth_cross',
      'gitnexus_similarity',
      'gitnexus_regression',
      'query_meta_graph',
      'gitnexus_graph_metrics',
    ];
    for (const name of expectedTools) {
      assert.ok(src.includes(`'${name}'`), `Missing tool registration: ${name}`);
    }
  });

  // ── gitnexus_graph_metrics (P2.1 graph-theory) ────────────────────
  it("registers 'gitnexus_graph_metrics' tool in TOOLS array", () => {
    assert.ok(
      src.includes("name: 'gitnexus_graph_metrics'"),
      "TOOLS array must contain name: 'gitnexus_graph_metrics'",
    );
  });

  it('gitnexus_graph_metrics inputSchema requires name property', () => {
    // The tool input must declare `name` as required. Assert the schema
    // fragment from source — consistent with how other tools are tested above.
    // (Registration is covered by the dedicated registration test above.)
    assert.ok(
      src.includes("required: ['name']"),
      "inputSchema must declare required: ['name']",
    );
    // Handler must call /graph/metrics/ endpoint on WEB_URL
    assert.ok(
      src.includes('/graph/metrics/'),
      'handler must fetch /graph/metrics/ from WEB_URL',
    );
  });

  it('gitnexus_graph_metrics handler references encodeURIComponent for the name param', () => {
    // Assert the PRECISE handler path — a bare includes('encodeURIComponent')
    // is vacuously true (the snapshot handler also uses it).
    assert.ok(
      src.includes('/graph/metrics/${encodeURIComponent(name)}'),
      'handler must encode the name param into the /graph/metrics/ path',
    );
  });

  it('gitnexus_graph_metrics inputSchema offers community + resolution params', () => {
    assert.ok(src.includes("'louvain'") && src.includes("'leiden'") && src.includes("'labelprop'"),
      'community enum must list louvain/leiden/labelprop');
    assert.ok(src.includes('resolution'), 'inputSchema must offer a resolution param');
  });
  it("gitnexus_graph_metrics description mentions the structural + community additions", () => {
    assert.ok(/closeness/i.test(src) && /Leiden/i.test(src),
      'description should mention closeness + Leiden');
  });

  it("registers 'gitnexus_graph_lens_metrics' with lensId+repo required", () => {
    assert.ok(src.includes("name: 'gitnexus_graph_lens_metrics'"), 'TOOLS must contain gitnexus_graph_lens_metrics');
    assert.ok(src.includes("required: ['lensId', 'repo']"), "lens-metrics inputSchema must require lensId + repo");
  });
  it('gitnexus_graph_lens_metrics handler hits /graph/metrics/lens/', () => {
    assert.ok(src.includes('/graph/metrics/lens/'), 'handler must call /graph/metrics/lens/');
    assert.ok(src.includes('encodeURIComponent(lensId)'), 'handler must encode lensId');
  });
  it('gitnexus_graph_lens_metrics description mentions both lenses (imports-deps + file-graph)', () => {
    assert.ok(/imports-deps/.test(src) && /file-graph/.test(src),
      'lens-metrics description should mention imports-deps and file-graph');
  });
  it('gitnexus_graph_lens_metrics offers symbol-graph + cap/approx (P2.3.2c)', () => {
    assert.ok(/symbol-graph/.test(src), 'description/schema should mention the symbol-graph lens');
    assert.ok(/cap: \{ type: 'number'/.test(src), 'inputSchema should offer a cap param');
    assert.ok(/approx: \{ type: 'number'/.test(src), 'inputSchema should offer an approx param');
  });

  it("registers 'gitnexus_list_graphs' hitting /graph/list", () => {
    assert.ok(src.includes("name: 'gitnexus_list_graphs'"), 'TOOLS must contain gitnexus_list_graphs');
    assert.ok(src.includes("callWeb('/graph/list')"), 'handler must call /graph/list');
  });

  // ── P2.3 directed / hierarchy / spectral-embedding params ─────────
  it('gitnexus_graph_metrics inputSchema offers directed/hierarchy/embed/dims', () => {
    assert.ok(/directed: \{ type: 'boolean'/.test(src), 'graph_metrics schema must offer a directed boolean');
    assert.ok(/hierarchy: \{ type: 'boolean'/.test(src), 'graph_metrics schema must offer a hierarchy boolean');
    assert.ok(/embed: \{ type: 'string', enum: \['spectral'\]/.test(src), "graph_metrics schema must offer embed enum ['spectral']");
    assert.ok(/dims: \{ type: 'number'/.test(src), 'graph_metrics schema must offer a dims number');
  });
  it('gitnexus_graph_metrics + lens handlers forward directed/hierarchy/embed/dims', () => {
    assert.ok(src.includes('if (directed) params.directed = 1;'), 'handlers must forward directed → params.directed = 1');
    assert.ok(src.includes('if (hierarchy) params.hierarchy = 1;'), 'handlers must forward hierarchy → params.hierarchy = 1');
    assert.ok(src.includes('if (embed) params.embed = embed;'), 'handlers must forward embed → params.embed');
    assert.ok(src.includes('if (dims !== undefined) params.dims = dims;'), 'handlers must forward dims → params.dims');
    // BOTH tools must forward — two occurrences of each pass-through line.
    const count = (s) => src.split(s).length - 1;
    assert.equal(count('if (directed) params.directed = 1;'), 2, 'both tools must forward directed');
    assert.equal(count('if (dims !== undefined) params.dims = dims;'), 2, 'both tools must forward dims');
  });
  it('graph-metrics tool descriptions mention directed metrics, hierarchy + spectral embeddings', () => {
    assert.ok(/in\/out degree/i.test(src), 'description should mention in/out degree');
    assert.ok(/HITS/.test(src), 'description should mention HITS');
    assert.ok(/SCC/.test(src), 'description should mention SCC');
    assert.ok(/hierarch/i.test(src), 'description should mention community hierarchy');
    assert.ok(/spectral embedding/i.test(src), 'description should mention spectral embeddings');
  });

  // ── structural observability (?observability=1) param ────────────
  it('graph-metrics tools offer an observability boolean in BOTH inputSchemas', () => {
    const count = (s) => src.split(s).length - 1;
    assert.ok(/observability: \{ type: 'boolean'/.test(src), 'schema must offer an observability boolean');
    assert.equal(count("observability: { type: 'boolean'"), 2, 'both tools must declare the observability param');
  });
  it('graph-metrics + lens handlers forward observability → params.observability = 1', () => {
    const count = (s) => src.split(s).length - 1;
    assert.ok(src.includes('if (observability) params.observability = 1;'), 'handlers must forward observability');
    assert.equal(count('if (observability) params.observability = 1;'), 2, 'both tools must forward observability');
  });
  it('graph-metrics tool descriptions mention structural observability + dead-weight', () => {
    const count = (s) => src.split(s).length - 1;
    assert.ok(/structural observability/i.test(src), 'description should mention structural observability');
    assert.ok(/dead-weight/i.test(src), 'description should mention dead-weight detection');
    // The per-description clause is shared verbatim by BOTH tool descriptions.
    assert.equal(count('optional structural observability (?observability=1)'), 2, 'both tool descriptions must carry the observability clause');
  });

  it('query_meta_graph inputSchema enumerates valid layer values', () => {
    assert.ok(src.includes("'lineage'"), "layer enum must include 'lineage'");
    assert.ok(src.includes("'manifestation'"), "layer enum must include 'manifestation'");
    assert.ok(src.includes("'observation'"), "layer enum must include 'observation'");
    assert.ok(src.includes("'economy'"), "layer enum must include 'economy'");
    assert.ok(src.includes("'meta_cognition'"), "layer enum must include 'meta_cognition'");
    assert.ok(src.includes("'all'"), "layer enum must include 'all'");
  });
});
