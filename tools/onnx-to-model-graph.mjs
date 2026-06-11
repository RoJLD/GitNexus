#!/usr/bin/env node
/**
 * OFFLINE, HOST-ONLY. Convert an ONNX graph (dumped to JSON) into a gitnexus
 * model-graph.json: ONNX ops become nodes (type 'op'), tensor-flow between ops
 * becomes edges (kind 'tensor'). Not run in any container; not a CI gate; ZERO
 * deps. The .onnx -> JSON protobuf parse is a documented Python pre-step (below)
 * — this tool only consumes the resulting onnx-graph JSON.
 *
 * It reuses the existing gitnexus `model-graph` import template (no new
 * importer): the emitted { model, nodes, edges } shape is exactly what that
 * template ingests, so point its source dir at the output and import as usual.
 *
 * Usage: node tools/onnx-to-model-graph.mjs <onnx-graph.json> <out-model-graph.json> [name]
 *
 * Pre-step (offline, needs `pip install onnx`) — dump an .onnx to onnx-graph JSON:
 *   python -c "import onnx,json,sys; from google.protobuf.json_format import MessageToDict; json.dump(MessageToDict(onnx.load(sys.argv[1]).graph), open(sys.argv[2],'w'))" model.onnx onnx-graph.json
 * Then: node tools/onnx-to-model-graph.mjs onnx-graph.json out/model-graph.json [name]
 * Then import via the gitnexus `model-graph` template (point its source dir at out/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function onnxGraphToModelGraph(onnxGraph, { name = null, maxNodes = 200000 } = {}) {
  const nodeList = Array.isArray(onnxGraph?.node) ? onnxGraph.node : [];
  if (nodeList.length > maxNodes) {
    throw new Error(`onnx graph has ${nodeList.length} ops > maxNodes ${maxNodes} (raise --max-nodes or use LoD; refusing to silently truncate)`);
  }

  // Stable, deduplicated id per op.
  const used = new Set();
  const ids = new Array(nodeList.length);
  for (let i = 0; i < nodeList.length; i += 1) {
    const node = nodeList[i];
    const base = node.name || `${node.opType ?? 'op'}#${i}`;
    const id = used.has(base) ? `${base}#${i}` : base;
    used.add(id);
    ids[i] = id;
  }

  const nodes = nodeList.map((node, i) => ({ id: ids[i], type: 'op', label: node.opType ?? 'op' }));

  // First op that emits a given tensor is its producer.
  const producer = new Map();
  for (let i = 0; i < nodeList.length; i += 1) {
    for (const t of nodeList[i].output ?? []) {
      if (!producer.has(t)) producer.set(t, ids[i]);
    }
  }

  // Tensor-flow edges: consumer input -> producing op. Skip graph inputs
  // (no producer) and self-loops; dedup identical (from, to, tensor) triples.
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < nodeList.length; i += 1) {
    const to = ids[i];
    for (const t of nodeList[i].input ?? []) {
      if (!producer.has(t)) continue;
      const from = producer.get(t);
      if (from === to) continue;
      const key = `${from}␟${to}␟${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to, kind: 'tensor', label: t });
    }
  }

  return {
    model: { name: name || onnxGraph?.name || 'onnx-model', framework: 'onnx', version: null },
    nodes,
    edges,
  };
}

const USAGE = `usage: node tools/onnx-to-model-graph.mjs <onnx-graph.json> <out-model-graph.json> [name]

Pre-step (offline, needs \`pip install onnx\`) — dump an .onnx to onnx-graph JSON:
  python -c "import onnx,json,sys; from google.protobuf.json_format import MessageToDict; json.dump(MessageToDict(onnx.load(sys.argv[1]).graph), open(sys.argv[2],'w'))" model.onnx onnx-graph.json
Then: node tools/onnx-to-model-graph.mjs onnx-graph.json out/model-graph.json [name]
Then import via the gitnexus \`model-graph\` template (point its source dir at out/).`;

function main() {
  const argv = process.argv;
  if (!argv[2] || !argv[3] || argv[2] === '--help' || argv[3] === '--help') {
    console.error(USAGE);
    process.exit(argv.includes('--help') ? 0 : 2);
  }
  const parsed = JSON.parse(readFileSync(argv[2], 'utf8'));
  const mg = onnxGraphToModelGraph(parsed, { name: argv[4] });
  writeFileSync(argv[3], JSON.stringify(mg, null, 2), 'utf8');
  console.log(`wrote ${mg.nodes.length} nodes / ${mg.edges.length} edges to ${argv[3]}`);
}

// Run only as a script, not on import (so tests can import the pure function).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
