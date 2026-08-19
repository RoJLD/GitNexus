# La Lentille Souveraine — Phase 1a (moteur gouvernance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promouvoir les lentilles de gouvernance de code-codé-en-dur à artefacts déclaratifs : un moteur pur `evaluate(spec, source, metrics)` qui enveloppe les projections existantes comme built-ins nommés et ajoute une couche color/inLens/insight, piloté par le corps déclaratif descendu dans `lens_registry.yaml`.

**Architecture:** Les 3 fonctions de `projection.py` (`inter_graph_to_braingraph`, `_json_lens` via sigil/workflow, `health_to_braingraph`) deviennent des **built-ins nommés** dans un registre de transforms. Le moteur dispatche vers le built-in du spec (produit le BrainGraph de base), puis applique color → select(inLens) → insight → meaning **par-dessus**. Sans clause `color`, la sortie est byte-identique à la projection actuelle (zéro régression, testable par golden). La gateway remplace son ladder if/elif par un appel moteur.

**Tech Stack:** Python 3.12, `kuzu` + `pyyaml` (seules deps), pytest. Aucune dépendance nouvelle.

## Global Constraints

- **Cible d'implémentation** : monorepo ELYSIUM (`scripts/governance/`, `data/governance/`, `tests/`) — PAS le fork. Tous les chemins ci-dessous sont relatifs à la racine ELYSIUM. Édition via **flux worktree/PR** (garde SIGIL-1555 : le daemon détruit le main-tree non-commité ; cf. topic `project_gitnexus_lens_explorer_live` MAJ 11).
- **Identité git** : `user.email = roblastar@live.fr` (jamais l'email Alten).
- **Moteur PUR** : `lens_engine.py` et `transforms.py` ne font AUCUNE I/O (pas de `open`, `kuzu.Database`, `read_text`). Les I/O (lire kuzu, lire les JSON) restent dans la gateway et sont passées en argument. Cela rend le moteur unit-testable sans stack.
- **Aucun `eval`/`exec`/`compile`** : la grammaire d'expression est un parseur/évaluateur explicite (property refs + comparateurs + fonctions nommées). Les transforms impératifs sont des built-ins référencés par nom, jamais du code dans le YAML.
- **Contrat de sortie fixe** : tout ce que le moteur émet est le contrat BrainGraph existant — `node{id, label:"CodeElement", properties{…}}`, `edge{id, sourceId, targetId, type, confidence, reason}`, `meta{node_count, edge_count, truncated, capabilities, schema_hash}` — augmenté de `properties.inLens` (bool) par nœud, `properties.communityColor` (déjà présent, possiblement écrasé par `color`), et un top-level `insights` (list) + `meaning` (str).
- **Metric-binding externe = HORS Phase 1a** (Phase 2). La démo color Phase-1 lit une propriété **déjà embarquée** (`properties.severity`), zéro jointure.
- **Zéro régression** : pour les 5 lentilles sans clause `color`, la sortie moteur == la sortie de la projection directe (golden test obligatoire).

---

### Task 1: Registre de transforms nommés

**Files:**
- Create: `scripts/governance/brain_graph/transforms.py`
- Test: `tests/governance/brain_graph/test_transforms.py`

**Interfaces:**
- Consumes: `projection.py` (`inter_graph_to_braingraph`, `sigil_graph_to_braingraph`, `workflow_graph_to_braingraph`, `health_to_braingraph`).
- Produces: `TRANSFORMS: dict[str, callable]` et `run_transform(name: str, source: dict) -> dict`. Noms : `"kuzu_inter_graph"`, `"json_nodes_sigil"`, `"json_nodes_workflow"`, `"health_polymorphic"`. `source` est un dict `{"node_rows":…, "rel_rows":…}` (kuzu) OU `{"doc":…}` (json/health) OU `{"doc":…, "name":…}` (health). `run_transform` lève `KeyError(name)` si inconnu.

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_transforms.py
import json
from pathlib import Path
from scripts.governance.brain_graph import transforms
from scripts.governance.brain_graph import projection

ROOT = Path(__file__).resolve().parents[3]

def test_health_polymorphic_matches_direct_projection():
    doc = json.loads((ROOT / "data/governance/critical_services_health.json").read_text("utf-8"))
    via_registry = transforms.run_transform("health_polymorphic", {"doc": doc, "name": "critical_services"})
    direct = projection.health_to_braingraph(doc, "critical_services")
    assert via_registry == direct

def test_unknown_transform_raises():
    import pytest
    with pytest.raises(KeyError):
        transforms.run_transform("nope", {"doc": {}})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_transforms.py -v`
Expected: FAIL with `ModuleNotFoundError: scripts.governance.brain_graph.transforms`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/governance/brain_graph/transforms.py
"""Named built-in transforms. Each existing projection function is registered
under a stable name; a declarative lens spec references one by `transform:`.
Pure — no I/O (the caller reads kuzu/json and passes rows/doc in)."""
from __future__ import annotations
from . import projection


def _kuzu_inter_graph(source: dict) -> dict:
    return projection.inter_graph_to_braingraph(source["node_rows"], source["rel_rows"])


def _json_nodes_sigil(source: dict) -> dict:
    return projection.sigil_graph_to_braingraph(source["doc"])


def _json_nodes_workflow(source: dict) -> dict:
    return projection.workflow_graph_to_braingraph(source["doc"])


def _health_polymorphic(source: dict) -> dict:
    return projection.health_to_braingraph(source["doc"], source["name"])


TRANSFORMS = {
    "kuzu_inter_graph": _kuzu_inter_graph,
    "json_nodes_sigil": _json_nodes_sigil,
    "json_nodes_workflow": _json_nodes_workflow,
    "health_polymorphic": _health_polymorphic,
}


def run_transform(name: str, source: dict) -> dict:
    if name not in TRANSFORMS:
        raise KeyError(name)
    return TRANSFORMS[name](source)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_transforms.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/transforms.py tests/governance/brain_graph/test_transforms.py
git commit -m "feat(lens): named built-in transform registry wrapping projection.py"
```

---

### Task 2: Le Lens Spec — parsing + validation

**Files:**
- Create: `scripts/governance/brain_graph/lens_spec.py`
- Test: `tests/governance/brain_graph/test_lens_spec.py`

**Interfaces:**
- Produces: `parse_spec(entry: dict) -> LensSpec` (dataclass frozen). `LensSpec` fields: `id:str, title:str, family:str, transform:str, color:dict|None, select:dict|None, insight:dict|None, meaning:str`. `parse_spec` lève `ValueError` si `transform` absent/inconnu, si `color.scale` ∉ {`heat`,`categorical`,`community`}. Un `entry` sans corps déclaratif (legacy) → `transform` déduit de `backend`/`name` (rétro-compat : `inter_graph`→`kuzu_inter_graph`, `sigil`→`json_nodes_sigil`, `workflow`→`json_nodes_workflow`, `health::*`→`health_polymorphic`).

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_spec.py
import pytest
from scripts.governance.brain_graph.lens_spec import parse_spec, LensSpec

def test_parse_full_spec():
    spec = parse_spec({
        "name": "health::critical_services", "title": "Services critiques", "family": "HEALTH",
        "transform": "health_polymorphic",
        "color": {"by": "severity", "scale": "categorical"},
        "meaning": "Les services critiques.",
    })
    assert isinstance(spec, LensSpec)
    assert spec.transform == "health_polymorphic"
    assert spec.color == {"by": "severity", "scale": "categorical"}

def test_legacy_entry_infers_transform():
    assert parse_spec({"name": "sigil", "backend": "json"}).transform == "json_nodes_sigil"
    assert parse_spec({"name": "inter_graph"}).transform == "kuzu_inter_graph"
    assert parse_spec({"name": "health::pxe"}).transform == "health_polymorphic"

def test_invalid_scale_raises():
    with pytest.raises(ValueError):
        parse_spec({"name": "x", "transform": "health_polymorphic", "color": {"by": "s", "scale": "rainbow"}})

def test_unknown_transform_raises():
    with pytest.raises(ValueError):
        parse_spec({"name": "x", "transform": "wat"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_spec.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/governance/brain_graph/lens_spec.py
"""Declarative lens spec: parse a lens_registry.yaml entry into a validated
LensSpec. Legacy entries (metadata-only) infer their transform for backward
compatibility, so re-expression can land incrementally."""
from __future__ import annotations
from dataclasses import dataclass
from .transforms import TRANSFORMS

_SCALES = {"heat", "categorical", "community"}


@dataclass(frozen=True)
class LensSpec:
    id: str
    title: str
    family: str
    transform: str
    color: dict | None
    select: dict | None
    insight: dict | None
    meaning: str


def _infer_transform(name: str) -> str:
    if name == "inter_graph":
        return "kuzu_inter_graph"
    if name.startswith("health::"):
        return "health_polymorphic"
    if name in ("sigil", "workflow"):
        return f"json_nodes_{name}"
    raise ValueError(f"cannot infer transform for legacy lens {name!r}")


def parse_spec(entry: dict) -> LensSpec:
    name = entry.get("name") or entry.get("id") or ""
    transform = entry.get("transform") or _infer_transform(name)
    if transform not in TRANSFORMS:
        raise ValueError(f"unknown transform: {transform!r}")
    color = entry.get("color")
    if color is not None:
        if color.get("scale") not in _SCALES:
            raise ValueError(f"invalid color.scale: {color.get('scale')!r}")
        if not color.get("by"):
            raise ValueError("color.by is required when color is set")
    return LensSpec(
        id=name, title=entry.get("title") or name, family=entry.get("family") or "",
        transform=transform, color=color, select=entry.get("select"),
        insight=entry.get("insight"), meaning=entry.get("meaning") or "",
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_spec.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_spec.py tests/governance/brain_graph/test_lens_spec.py
git commit -m "feat(lens): LensSpec parser + validation (legacy entries infer transform)"
```

---

### Task 3: La grammaire minuscule — évaluateur de prédicat + normalizer

**Files:**
- Create: `scripts/governance/brain_graph/lens_expr.py`
- Test: `tests/governance/brain_graph/test_lens_expr.py`

**Interfaces:**
- Produces: `eval_predicate(expr: str, props: dict) -> bool` (grammaire : `<prop> <op> <value>` avec op ∈ `==`, `!=`, `>=`, `<=`, `>`, `<`, `in` ; `in` prend une liste `[a, b]` ; valeurs bareword ou nombres ; comparaison numérique si les deux côtés parsent en float, sinon string). `normalize_key(s: str) -> str` (lower + backslash→slash + strip d'un préfixe `<lens>::`). **Aucun `eval`.** Valeur de prop absente → prédicat `False` (jamais crash).

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_expr.py
from scripts.governance.brain_graph.lens_expr import eval_predicate, normalize_key

def test_eq_string():
    assert eval_predicate("status == CRITICAL", {"status": "CRITICAL"}) is True
    assert eval_predicate("status == CRITICAL", {"status": "OK"}) is False

def test_in_list():
    assert eval_predicate("severity in [critical, warning]", {"severity": "warning"}) is True
    assert eval_predicate("severity in [critical, warning]", {"severity": "info"}) is False

def test_numeric_compare():
    assert eval_predicate("age_hours >= 24", {"age_hours": 48}) is True
    assert eval_predicate("age_hours >= 24", {"age_hours": 1}) is False

def test_missing_prop_is_false_never_crash():
    assert eval_predicate("status == CRITICAL", {}) is False

def test_normalize_key():
    assert normalize_key("Docs\\Governance\\X.md") == "docs/governance/x.md"
    assert normalize_key("sigil::SIGIL-001") == "sigil-001"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_expr.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/governance/brain_graph/lens_expr.py
"""Deliberately tiny, safe expression evaluator for lens select/color. NO eval:
supports `<prop> <op> <value>` with a fixed operator set. Missing prop -> False."""
from __future__ import annotations
import re

_OPS = ["==", "!=", ">=", "<=", ">", "<", " in "]


def normalize_key(s: str) -> str:
    s = str(s).lower().replace("\\", "/")
    if "::" in s:
        s = s.split("::", 1)[1]
    return s


def _as_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cmp(left, op, right) -> bool:
    ln, rn = _as_num(left), _as_num(right)
    if ln is not None and rn is not None:
        left, right = ln, rn
    else:
        left, right = str(left).strip().lower(), str(right).strip().lower()
    return {
        "==": left == right, "!=": left != right, ">=": left >= right,
        "<=": left <= right, ">": left > right, "<": left < right,
    }[op]


def eval_predicate(expr: str, props: dict) -> bool:
    expr = expr.strip()
    if " in " in expr:
        prop, _, rhs = expr.partition(" in ")
        val = props.get(prop.strip())
        if val is None:
            return False
        items = [x.strip().lower() for x in rhs.strip().strip("[]").split(",")]
        return str(val).strip().lower() in items
    for op in ["==", "!=", ">=", "<=", ">", "<"]:
        if op in expr:
            prop, _, rhs = expr.partition(op)
            val = props.get(prop.strip())
            if val is None:
                return False
            return _cmp(val, op, rhs.strip())
    raise ValueError(f"unparseable predicate: {expr!r}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_expr.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_expr.py tests/governance/brain_graph/test_lens_expr.py
git commit -m "feat(lens): tiny safe predicate evaluator + key normalizer (no eval)"
```

---

### Task 4: La couche color (categorical / heat / community, best-effort)

**Files:**
- Modify: `scripts/governance/brain_graph/lens_engine.py` (créé ici)
- Test: `tests/governance/brain_graph/test_lens_color.py`

**Interfaces:**
- Produces: `apply_color(bg: dict, color: dict | None) -> dict` (mute une copie ; sans `color`, retourne `bg` inchangé). `categorical` : `properties.communityColor = stable_palette(properties[color.by])`. `heat` : normalise `properties[color.by]` numérique sur [min,max] observés → gradient bleu→rouge ; valeur absente/non-numérique → couleur neutre `#8f8f8f`. `community` : no-op (garde le communityColor existant). Réutilise `projection.domain_color` pour categorical (palette stable existante).

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_color.py
from scripts.governance.brain_graph.lens_engine import apply_color

def _bg(nodes):
    return {"lens": {}, "nodes": nodes, "edges": [], "meta": {}}

def test_no_color_is_identity():
    bg = _bg([{"id": "a", "properties": {"communityColor": "#111"}}])
    assert apply_color(bg, None) == bg

def test_categorical_by_severity():
    bg = _bg([
        {"id": "a", "properties": {"severity": "critical", "communityColor": "#000"}},
        {"id": "b", "properties": {"severity": "critical", "communityColor": "#000"}},
        {"id": "c", "properties": {"severity": "warning", "communityColor": "#000"}},
    ])
    out = apply_color(bg, {"by": "severity", "scale": "categorical"})
    ca = out["nodes"][0]["properties"]["communityColor"]
    cb = out["nodes"][1]["properties"]["communityColor"]
    cc = out["nodes"][2]["properties"]["communityColor"]
    assert ca == cb and ca != cc and ca != "#000"  # same value -> same color; differs

def test_categorical_missing_value_is_neutral():
    bg = _bg([{"id": "a", "properties": {"communityColor": "#000"}}])
    out = apply_color(bg, {"by": "severity", "scale": "categorical"})
    assert out["nodes"][0]["properties"]["communityColor"] == "#8f8f8f"

def test_heat_normalizes():
    bg = _bg([
        {"id": "a", "properties": {"age_hours": 0}},
        {"id": "b", "properties": {"age_hours": 100}},
    ])
    out = apply_color(bg, {"by": "age_hours", "scale": "heat"})
    assert out["nodes"][0]["properties"]["communityColor"] != out["nodes"][1]["properties"]["communityColor"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_color.py -v`
Expected: FAIL with `ModuleNotFoundError: scripts.governance.brain_graph.lens_engine`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/governance/brain_graph/lens_engine.py
"""Pure lens engine: wraps a named transform then layers color / inLens /
insight / meaning on the BrainGraph. No I/O — the caller reads sources."""
from __future__ import annotations
import copy
from . import projection

_NEUTRAL = "#8f8f8f"


def _heat_color(t: float) -> str:
    """t in [0,1] -> blue(#4f8ff7) .. red(#f74f4f) linear ramp."""
    t = max(0.0, min(1.0, t))
    a, b = (0x4f, 0x8f, 0xf7), (0xf7, 0x4f, 0x4f)
    r, g, bl = (int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return f"#{r:02x}{g:02x}{bl:02x}"


def apply_color(bg: dict, color: dict | None) -> dict:
    if not color:
        return bg
    out = copy.deepcopy(bg)
    by, scale = color["by"], color["scale"]
    if scale == "community":
        return out
    if scale == "heat":
        vals = []
        for n in out["nodes"]:
            v = n["properties"].get(by)
            try:
                vals.append(float(v))
            except (TypeError, ValueError):
                vals.append(None)
        nums = [v for v in vals if v is not None]
        lo, hi = (min(nums), max(nums)) if nums else (0.0, 1.0)
        span = (hi - lo) or 1.0
        for n, v in zip(out["nodes"], vals):
            n["properties"]["communityColor"] = _NEUTRAL if v is None else _heat_color((v - lo) / span)
        return out
    # categorical
    for n in out["nodes"]:
        v = n["properties"].get(by)
        n["properties"]["communityColor"] = _NEUTRAL if v is None else projection.domain_color(str(v))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_color.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_engine.py tests/governance/brain_graph/test_lens_color.py
git commit -m "feat(lens): color layer (categorical/heat/community, best-effort neutral)"
```

---

### Task 5: La couche select → inLens

**Files:**
- Modify: `scripts/governance/brain_graph/lens_engine.py`
- Test: `tests/governance/brain_graph/test_lens_select.py`

**Interfaces:**
- Produces: `apply_select(bg: dict, select: dict | None) -> dict`. Sans `select` : chaque nœud reçoit `properties.inLens = True`. Avec `select.node_where` : `inLens = eval_predicate(node_where, properties)`. (`edge_where` est ignoré en Phase 1a — les lentilles gouvernance ne l'utilisent pas ; documenté pour Phase 2.)

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_select.py
from scripts.governance.brain_graph.lens_engine import apply_select

def _bg(nodes):
    return {"lens": {}, "nodes": nodes, "edges": [], "meta": {}}

def test_no_select_all_in_lens():
    out = apply_select(_bg([{"id": "a", "properties": {}}]), None)
    assert out["nodes"][0]["properties"]["inLens"] is True

def test_node_where_sets_in_lens():
    bg = _bg([
        {"id": "a", "properties": {"status": "CRITICAL"}},
        {"id": "b", "properties": {"status": "OK"}},
    ])
    out = apply_select(bg, {"node_where": "status == CRITICAL"})
    assert out["nodes"][0]["properties"]["inLens"] is True
    assert out["nodes"][1]["properties"]["inLens"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_select.py -v`
Expected: FAIL with `ImportError: cannot import name 'apply_select'`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/governance/brain_graph/lens_engine.py`:

```python
from .lens_expr import eval_predicate


def apply_select(bg: dict, select: dict | None) -> dict:
    out = copy.deepcopy(bg)
    node_where = (select or {}).get("node_where")
    for n in out["nodes"]:
        n["properties"]["inLens"] = (
            True if not node_where else eval_predicate(node_where, n["properties"])
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_select.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_engine.py tests/governance/brain_graph/test_lens_select.py
git commit -m "feat(lens): select layer sets properties.inLens per node"
```

---

### Task 6: La couche insight (top-N)

**Files:**
- Modify: `scripts/governance/brain_graph/lens_engine.py`
- Test: `tests/governance/brain_graph/test_lens_insight.py`

**Interfaces:**
- Produces: `compute_insights(bg: dict, insight: dict | None) -> list[dict]`. Sans `insight` : `[]`. Avec `insight.rank == "top N by X"` : retourne les N nœuds au plus grand `properties[X]` numérique, chacun `{"id","name","value"}`, tri desc, valeurs non-numériques exclues. (`insight.delta "since …"` = Phase 2 : nécessite un historique ; NON implémenté ici, un `delta` présent lève `NotImplementedError` explicite plutôt qu'un silence.)

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_insight.py
import pytest
from scripts.governance.brain_graph.lens_engine import compute_insights

def _bg(nodes):
    return {"lens": {}, "nodes": nodes, "edges": [], "meta": {}}

def test_no_insight_empty():
    assert compute_insights(_bg([]), None) == []

def test_top_n_by():
    bg = _bg([
        {"id": "a", "properties": {"name": "A", "score": 5}},
        {"id": "b", "properties": {"name": "B", "score": 9}},
        {"id": "c", "properties": {"name": "C", "score": 1}},
    ])
    out = compute_insights(bg, {"rank": "top 2 by score"})
    assert [x["id"] for x in out] == ["b", "a"]
    assert out[0]["value"] == 9

def test_delta_not_implemented():
    with pytest.raises(NotImplementedError):
        compute_insights(_bg([]), {"delta": "since 24h"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_insight.py -v`
Expected: FAIL with `ImportError`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/governance/brain_graph/lens_engine.py`:

```python
import re as _re


def compute_insights(bg: dict, insight: dict | None) -> list[dict]:
    if not insight:
        return []
    if insight.get("delta"):
        raise NotImplementedError("insight.delta requires history — Phase 2")
    rank = insight.get("rank") or ""
    m = _re.match(r"top\s+(\d+)\s+by\s+(\w+)", rank.strip())
    if not m:
        return []
    n, field = int(m.group(1)), m.group(2)
    scored = []
    for node in bg["nodes"]:
        v = node["properties"].get(field)
        try:
            scored.append((float(v), node))
        except (TypeError, ValueError):
            continue
    scored.sort(key=lambda t: t[0], reverse=True)
    return [
        {"id": node["id"], "name": node["properties"].get("name"), "value": val}
        for val, node in scored[:n]
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_insight.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_engine.py tests/governance/brain_graph/test_lens_insight.py
git commit -m "feat(lens): insight layer (top-N by field; delta is explicit Phase-2 NotImplemented)"
```

---

### Task 7: `evaluate()` — l'orchestration du pipeline

**Files:**
- Modify: `scripts/governance/brain_graph/lens_engine.py`
- Test: `tests/governance/brain_graph/test_lens_evaluate.py`

**Interfaces:**
- Consumes: `run_transform` (Task 1), `LensSpec` (Task 2), `apply_color`/`apply_select`/`compute_insights` (Tasks 4-6).
- Produces: `evaluate(spec: LensSpec, source: dict) -> dict`. Pipeline **ordonné** : `run_transform(spec.transform, source)` → `apply_select` → `apply_color` → attache `top-level["insights"] = compute_insights(...)` + `top-level["meaning"] = spec.meaning`. Retourne le BrainGraph augmenté. Sans `color`/`select`/`insight`/`meaning`, le seul ajout vs la projection brute est `properties.inLens=True` par nœud + `insights:[]` + `meaning:""`.

- [ ] **Step 1: Write the failing test**

```python
# tests/governance/brain_graph/test_lens_evaluate.py
import json
from pathlib import Path
from scripts.governance.brain_graph.lens_engine import evaluate
from scripts.governance.brain_graph.lens_spec import parse_spec

ROOT = Path(__file__).resolve().parents[3]

def test_evaluate_health_severity():
    doc = json.loads((ROOT / "data/governance/critical_services_health.json").read_text("utf-8"))
    spec = parse_spec({
        "name": "health::critical_services", "transform": "health_polymorphic",
        "color": {"by": "severity", "scale": "categorical"},
        "select": {"node_where": "status == CRITICAL"},
        "insight": {"rank": "top 3 by severity"},   # severity is categorical -> excluded, [] ok
        "meaning": "Services critiques.",
    })
    out = evaluate(spec, {"doc": doc, "name": "critical_services"})
    assert out["meaning"] == "Services critiques."
    assert "insights" in out
    # every node has inLens set + a communityColor
    for n in out["nodes"]:
        assert "inLens" in n["properties"]
        assert n["properties"]["communityColor"].startswith("#")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_evaluate.py -v`
Expected: FAIL with `ImportError: cannot import name 'evaluate'`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/governance/brain_graph/lens_engine.py`:

```python
from .transforms import run_transform
from .lens_spec import LensSpec


def evaluate(spec: LensSpec, source: dict) -> dict:
    bg = run_transform(spec.transform, source)
    bg = apply_select(bg, spec.select)
    bg = apply_color(bg, spec.color)
    bg["insights"] = compute_insights(bg, spec.insight)
    bg["meaning"] = spec.meaning
    return bg
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/governance/brain_graph/test_lens_evaluate.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/governance/brain_graph/lens_engine.py tests/governance/brain_graph/test_lens_evaluate.py
git commit -m "feat(lens): evaluate() orchestrates transform -> select -> color -> insight -> meaning"
```

---

### Task 8: Descendre les 5 specs dans le registre + câbler la gateway + golden zéro-régression

**Files:**
- Modify: `data/governance/lens_registry.yaml` (ajouter le corps déclaratif aux 5 entrées)
- Modify: `scripts/governance/sigma_brain_graph_gateway.py:125-138` (`build_graph_for_repo`)
- Test: `tests/governance/brain_graph/test_lens_no_regression.py`

**Interfaces:**
- Consumes: `evaluate`, `parse_spec`, `run_transform`.
- Produces: `build_graph_for_repo(repo, db_path)` (signature inchangée) délègue à `evaluate(parse_spec(entry), source)` où `source` est lu selon le backend (kuzu rows / json doc). Comportement identique aux consommateurs pour les 5 lentilles SANS `color` ; `health::critical_services` gagne `severity`-driven `communityColor`.

- [ ] **Step 1: Write the failing golden test**

```python
# tests/governance/brain_graph/test_lens_no_regression.py
# The engine, given a spec WITHOUT color/select/insight, must reproduce the
# legacy projection (plus inLens=True + insights=[] + meaning="") — proving
# re-expression is non-destructive for sigil/workflow/health.
import json
from pathlib import Path
from scripts.governance.brain_graph import projection
from scripts.governance.brain_graph.lens_engine import evaluate
from scripts.governance.brain_graph.lens_spec import parse_spec

ROOT = Path(__file__).resolve().parents[3]

def _strip_engine_extras(bg):
    bg = json.loads(json.dumps(bg))  # deep copy
    bg.pop("insights", None); bg.pop("meaning", None)
    for n in bg["nodes"]:
        n["properties"].pop("inLens", None)
    return bg

def test_sigil_reexpression_is_non_destructive():
    doc = json.loads((ROOT / "data/governance/sigil_graph.json").read_text("utf-8"))
    spec = parse_spec({"name": "sigil", "transform": "json_nodes_sigil"})
    out = evaluate(spec, {"doc": doc})
    assert _strip_engine_extras(out) == projection.sigil_graph_to_braingraph(doc)

def test_health_critical_services_gets_severity_color():
    doc = json.loads((ROOT / "data/governance/critical_services_health.json").read_text("utf-8"))
    spec = parse_spec({"name": "health::critical_services", "transform": "health_polymorphic",
                       "color": {"by": "severity", "scale": "categorical"}})
    out = evaluate(spec, {"doc": doc, "name": "critical_services"})
    checks = [n for n in out["nodes"] if n["properties"].get("domainType") == "HealthCheck"]
    assert checks and all("communityColor" in c["properties"] for c in checks)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/governance/brain_graph/test_lens_no_regression.py -v`
Expected: PASS on the two engine tests IF Tasks 1-7 landed (they exercise the library, not the gateway yet). If red, fix the engine — do not touch the gateway until green.

- [ ] **Step 3: Add the declarative body to the 5 registry entries**

Edit `data/governance/lens_registry.yaml` — for each of the 5 `lenses:` entries add, under the existing metadata, the declarative body. Example for the two that change behavior/meaning; the other three get `transform` + `meaning` only:

```yaml
  - name: health::critical_services
    # …existing metadata (family, backend, capabilities, source_path)…
    transform: health_polymorphic
    color: { by: severity, scale: categorical }
    meaning: "Les services dont la panne menace la souveraineté — agis ici d'abord."
  - name: inter_graph
    transform: kuzu_inter_graph
    meaning: "Le graphe-de-graphes : chaque nœud est un graphe enregistré du cerveau."
  - name: sigil
    transform: json_nodes_sigil
    meaning: "Les SIGILs et leurs liens."
  - name: workflow
    transform: json_nodes_workflow
    meaning: "Les workflows Mycelium et leur orchestration."
  - name: health::pxe
    transform: health_polymorphic
    meaning: "Santé du provisioning PXE."
```

- [ ] **Step 4: Rewire `build_graph_for_repo` to the engine**

Replace `scripts/governance/sigma_brain_graph_gateway.py:125-138` (the if/elif ladder) with a registry-spec-driven dispatch. Read the source per backend, then `evaluate`:

```python
from scripts.governance.brain_graph.lens_engine import evaluate as _lens_evaluate
from scripts.governance.brain_graph.lens_spec import parse_spec as _parse_spec


def build_graph_for_repo(repo: str, db_path: Path) -> dict:
    """Registry-spec-driven: find the lens entry, read its source per backend,
    run it through the declarative engine. Unknown repo -> KeyError (503 guard)."""
    entry = next((e for e in load_lens_registry() if e.get("name") == repo), None)
    if entry is None:
        # health::<name> may be served by the dynamic glob without a registry entry
        if repo.startswith(_HEALTH_REPO_PREFIX):
            name = repo[len(_HEALTH_REPO_PREFIX):]
            if not _is_valid_health_name(name):
                raise KeyError(repo)
            entry = {"name": repo, "transform": "health_polymorphic"}
        else:
            raise KeyError(repo)
    spec = _parse_spec(entry)
    if spec.transform == "kuzu_inter_graph":
        node_rows, rel_rows = _read_inter_graph(db_path, "all")
        source = {"node_rows": node_rows, "rel_rows": rel_rows}
    elif spec.transform.startswith("json_nodes_"):
        src, _fn = _JSON_LENSES[repo]
        source = {"doc": json.loads(Path(src).read_text(encoding="utf-8"))}
    else:  # health_polymorphic
        name = repo[len(_HEALTH_REPO_PREFIX):]
        src = ROOT / "data" / "governance" / f"{name}{_HEALTH_SUFFIX}"
        source = {"doc": json.loads(src.read_text(encoding="utf-8")), "name": name}
    return _lens_evaluate(spec, source)
```

> Note: `_read_inter_graph` already returns `(node_rows, rel_rows)` (gateway:221-249); confirm its return tuple order and adapt the unpack if needed. Keep `build_inter_graph_payload` for any caller not yet migrated, or inline its read here.

- [ ] **Step 5: Boot the gateway and smoke the 5 lenses**

Run:
```bash
python scripts/governance/sigma_brain_graph_gateway.py --port 4750 &
sleep 2
for L in inter_graph sigil workflow "health::critical_services" "health::pxe"; do
  curl -s -o /dev/null -w "$L: %{http_code}\n" "http://localhost:4750/api/graph?repo=$L"
done
curl -s "http://localhost:4750/api/graph?repo=health::critical_services" | python -c "import sys,json; d=json.load(sys.stdin); print('meaning:', d.get('meaning')); print('has inLens:', all('inLens' in n['properties'] for n in d['nodes']))"
```
Expected: all 5 → `200`; `meaning:` non-empty for critical_services; `has inLens: True`.

- [ ] **Step 6: Run the full engine test suite**

Run: `python -m pytest tests/governance/brain_graph/ -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/governance/brain_graph/ scripts/governance/sigma_brain_graph_gateway.py data/governance/lens_registry.yaml tests/governance/brain_graph/
git commit -m "feat(lens): registry-driven declarative engine wired into gateway; health::critical_services colored by severity; 5 lenses non-destructively re-expressed"
```

---

## Self-Review

**1. Spec coverage** (contre `2026-07-16-lens-souveraine-northstar-design.md`, Phase 1) :
- Lens Spec + corps dans le registre → Tasks 2, 8. ✅
- Moteur `evaluate()` remplaçant projection.py+ladder → Tasks 1, 7, 8. ✅
- Réexprimer les 5 lentilles (zéro régression) → Task 8 golden. ✅
- Colorer health::critical_services par severity (embarqué) → Tasks 4, 8. ✅
- Built-in nommé `health_polymorphic` → Task 1. ✅
- Grammaire minuscule + normalizer, pas d'eval → Task 3. ✅
- Contrat BrainGraph complet + color/inLens/insights → Tasks 4-7. ✅
- Metric-binding externe **hors Phase 1a** (Phase 2) → non planifié ici (conforme au spec). ✅
- Projecteur navigateur (1b) → **plan séparé** (dépend de la sortie réelle de 1a). ✅
- Glob /health-lens inchangé Phase 1 → `build_graph_for_repo` gère `health::<name>` sans entrée de registre (Task 8 Step 4). ✅

**2. Placeholder scan** : aucune step ne dit « TODO/handle edge cases » ; tout code est concret. `delta` d'insight lève `NotImplementedError` explicite (pas un silence). ✅

**3. Type consistency** : `run_transform(name, source)` (T1) ↔ appelé dans `evaluate` (T7) ↔ `source` construit dans la gateway (T8) — mêmes clés (`node_rows`/`rel_rows`/`doc`/`name`). `parse_spec` (T2) → `LensSpec` → consommé par `evaluate` (T7). `eval_predicate` (T3) → `apply_select` (T5). `apply_color`/`apply_select`/`compute_insights` signatures cohérentes entre T4-7. ✅

## Execution Handoff

Ce plan cible le monorepo ELYSIUM via le **flux worktree/PR** (SIGIL-1555). Le plan 1b (projecteur navigateur, fork) sera écrit après l'atterrissage de 1a (son interface dépend de la sortie réelle du moteur).
