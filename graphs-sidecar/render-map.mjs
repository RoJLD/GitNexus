/**
 * Pure row -> render-shape mapping for the sidecar (kuzu-free so it's host-testable).
 * ADDITIVE passthrough: spread all stored props, then set the computed id/type/label/...
 * on top — so edge `weight`, node `layer`, and any other stored prop reach the render
 * consumers, while existing consumers keep reading the same named fields.
 */
export function mapRenderRows(nrows, erows) {
  const nodes = (nrows || []).map(({ n, lbl }) => ({
    ...n,
    id: n.id,
    type: n.type ?? lbl ?? '',
    label: n.label ?? n.title ?? n.name ?? String(n.id),
    path: n.path ?? '',
    stage: n.stage ?? '',
  }));
  const edges = (erows || []).map(({ source, target, r, lbl }) => ({
    ...r,
    source, target,
    kind: r.kind ?? lbl ?? '',
    id: r.id ?? `${source}->${target}`,
  }));
  return { nodes, edges };
}
