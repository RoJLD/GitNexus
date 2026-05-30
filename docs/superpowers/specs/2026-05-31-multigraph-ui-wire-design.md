# Multigraph UI Wire Design — Tasks 9.6 / 9.7 / 9.8

**Date**: 2026-05-31
**Branch**: sovereign-deployment
**Status**: DELIVERED (Tasks 9.6 + 9.7 + 9.8)

## Context

SIGIL-GITNEXUS-MULTIGRAPH introduces N-graph navigation to the GitNexus web
UI. Tasks 9.6–9.8 deliver the React layer that consumes `MultigraphLoader`
(Task 9.5) and exposes it to the user.

## Delivered Components

### GraphSidebar (Task 9.6)
- `src/components/GraphSidebar.tsx`
- Groups `GraphConfigEntry[]` by `schema_type` using `useMemo`
- Calls `onSelect(name)` on click; highlights selected entry with violet ring
- Tests: 2 vitest (render grouped labels, onSelect callback) — 2/2 PASS

### CanvasMultigraph (Task 9.7)
- `src/components/CanvasMultigraph.tsx`
- Shows placeholder text when `selectedGraph === null`
- Renders `selectedGraph.name` as heading when active
- Exposes `data-testid="canvas-mode"` carrying the `ZoomLevel` string
- `useEffect` writes `containerRef.dataset.graphName` for D3/WebGL hookup
- Zoom levels: `'meta' | 'graph' | 'node' | 'inspector'`
- Tests: 3 vitest (placeholder, name render, zoom rerender) — 3/3 PASS

### App.tsx wire (Task 9.8)
- Opt-in via `?multigraph=1` URL query param — zero regression on default path
- Adds `isMultigraphMode`, `multigraphs`, `selectedMG`, `zoomLevel` state
- `useEffect` calls `new MultigraphLoader().listGraphs()` on mount when active
- Early return renders `<GraphSidebar> + <CanvasMultigraph>` in `flex h-screen`
- All existing single-graph state hooks preserved (React hooks rule respected)

## Architecture Decision

Feature-flag via URL param avoids a config file or localStorage toggle.
The `?multigraph=1` flag integrates naturally with the existing `?server=` and
`?project=` bookmarkability pattern already present in App.tsx.

## Test Results

```
3 test files  |  8 tests  |  8 passed (0 failed)
- multigraph-loader.test.ts  : 3/3
- graph-sidebar.test.tsx      : 2/2
- canvas-multigraph.test.tsx  : 3/3
```

## TypeScript

`npx tsc --noEmit` — 0 new errors introduced.

## Next Tasks

- Task 9.9: fractal zoom transitions in CanvasMultigraph (D3 zoom + level FSM)
- Task 9.10: gitnexus.config.json live-reload via SSE
