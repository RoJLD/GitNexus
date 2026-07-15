# Observable d'usage de l'extension VSCode — design

**Date** : 2026-07-15
**SIGIL** : SIGIL-1711 Bloc 1, (ii).5
**Statut** : livré

## Problème

Doctrine : *« pas de v0.2 sans preuve d'usage »*. L'extension VSCode (status-bar
bus-factor, MVP v0.1) n'a **aucune instrumentation d'usage** — le go/no-go d'un v0.2
*fonctionnel* serait un pari. Il faut un signal d'usage **local, privacy-preserving**
(pas de télémétrie réseau — cohérent PolyForm-Noncommercial + vie privée).

## Décision : log JSONL local + verdict pur

- **Log append-only** dans `context.globalStorageUri/usage.jsonl` (survit aux
  redémarrages, jamais de réseau). Écriture best-effort : une panne d'écriture ne doit
  **jamais** perturber l'éditeur (`try/catch` silencieux).
- **3 événements** : `activate` (extension activée), `file_match` (le status-bar a affiché
  un bus-factor réel pour un fichier d'un repo indexé — **le signal le plus fort** : « ça a
  vraiment servi sur du code réel »), `command` (l'utilisateur a invoqué refresh/openWebUI).
  `file_match` est **throttlé 1×/repo:file/session** (un `Set` en mémoire) pour ne pas
  inonder le log au simple défilement de fichiers.
- **Verdict pur** `computeUsageVerdict(events, now, thresholds)` → `USE-PROVEN` si
  `fileMatches ≥ 20` **et** `activeDays ≥ 3` (le spread évite qu'une seule rafale compte),
  sinon `INSUFFICIENT` / `NO-DATA`. Seuils par défaut = le probe 7 j.
- **Commande** `gitnexus.usageReport` lit le log, calcule le verdict, l'affiche
  (`showInformationMessage` modal).

## Séparation testable / non-testable

`vscode-extension/src/usage.ts` = **logique pure** (modèle d'événements, `serializeEvent`,
`parseEvents` tolérant aux lignes corrompues, `computeUsageVerdict`) — **aucun import
`vscode`** → unit-testable depuis la pyramide vitest du fork
(`tests/unit/vscode-usage-verdict.test.ts`, 8 cas). `extension.ts` = **glue** (chemin de
stockage, fs read/write, câblage des événements, commande) — non unit-testable (dépend de
l'hôte VSCode), validé par `tsc`.

## Hors scope

Pas de télémétrie réseau (jamais). Pas de dashboard — le verdict textuel suffit pour un
go/no-go. Pas d'auto-purge du log (append-only ; taille négligeable pour un usage humain).
