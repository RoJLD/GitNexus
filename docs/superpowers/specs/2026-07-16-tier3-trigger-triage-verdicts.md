# Tier 3 — triage measure-first des triggers gelés (verdicts)

**Date** : 2026-07-16
**SIGIL** : SIGIL-1711 Bloc 2 (iii)
**Méthode** : workflow multi-agents `tier3-trigger-triage` — un mesureur par item
(inspection code + git, sans stack ni `analyze`), verdict `BUILD`/`STAY-FROZEN`/`DELETE`
falsifiable, **vérification adversariale** de tout verdict `BUILD` (refuter, sinon
rétrograder). Doctrine du triage : *BUILD seulement si (trigger tiré) ET (consommateur/
valeur committé maintenant)* ; sinon STAY-FROZEN avec condition de dégel falsifiable ;
DELETE si raison d'être morte.

**Résultat : 0 BUILD · 8 STAY-FROZEN · 1 DELETE** (9 items). Le gel de 2026-07-10 était
correct — rien ne dégèle aujourd'hui, aucun code à construire. Un seul item (3.9) est un
acte de décès et sort de la roadmap.

## Le catch adversarial (pourquoi la vérification compte)

`versioned-export-import` était le **seul verdict `BUILD` initial** : le mesureur avait
honoré l'exemption écrite dans la roadmap (« fail-loud préventif, buildable quoi qu'il
arrive »). Le **vérificateur adversarial a refusé l'exemption** et re-mesuré : le scénario
que la garde préviendrait (ré-import d'un bundle d'une version de format différente) est
**injoignable** dans le déploiement mono-format actuel — aucun commit ne change le format
d'export (`.gitnexus/meta.json` / lbug on-disk) alors que d'anciens bundles existent. →
rétrogradé `STAY-FROZEN`. **Iron : même un « préventif buildable quoi qu'il arrive » exige
un scénario d'échec atteignable — sinon c'est du code spéculatif (Zero-Placeholder).**

## Verdicts

| Item | Verdict | Trigger tiré ? | Raison d'un mot |
|---|---|---|---|
| 3.1 dead-code runtime | STAY-FROZEN | non | substrat taint/PDG M0 **inerte** (émis par aucune phase), zéro consommateur, besoin OTLP runtime |
| 3.2 profils auteurs git-only | STAY-FROZEN | non | **1 seule** identité humaine (les « 2 » = artefact de casse `DENIS`/`Denis` sur 1 email), 334 trailers Co-Authored-By tous bot, aucun parseur ni consommateur |
| 3.10 plugin architecture | STAY-FROZEN | non | **0** nouvelle analytics depuis le gel (7 modules = sidecar copilot + 2 infra, aucun calcul de métrique) |
| inverted-index repoId | STAY-FROZEN | non | les worktrees **collapsent** vers une identité par design ; pas de bottleneck (<50 repos, reads cachés) |
| versioned export/import | STAY-FROZEN | non | **BUILD rétrogradé** : scénario version-skew injoignable en mono-format |
| 3.4 auto-PR refacto | STAY-FROZEN | non | aucune capacité d'écriture PR ; le consommateur agent est MCP **read-only** |
| 3.5 prédiction bugs | STAY-FROZEN | non | **zéro** source de labels (ni SZZ, ni issue-link, ni dataset) |
| 3.6 CI architectural | STAY-FROZEN | non | licence PolyForm rend la bataille sans objet ; entrée `budgets` elle-même **inerte** (0 parseur) → doublement non-consommé |
| **3.9 dataset public** | **DELETE** | non | seul moteur = Chemin C (SaaS/API publique), **structurellement impossible** sous PolyForm-Noncommercial ; direction = Chemin B |

## Conditions de dégel (STAY-FROZEN — falsifiables, re-vérifiables)

- **3.1 dead-code** — dégel quand TOUT tient : (a) une phase d'ingestion appelle réellement
  `basicBlockWriter.write()` — indexer un vrai repo produit une table `BasicBlock` non vide
  (upstream milestone M3, issue #2083 ; aujourd'hui `registration-table.ts:187` marque
  `BasicBlock: 'inert'`, `csv-generator.ts:309` « Emitted by no phase yet ») ; (b) un
  endpoint `/dead-code` ou `/heat` committé le consomme ; (c) pour la vraie raison d'être
  (coloration par fréquence d'exécution en prod), un adaptateur OTLP/APM existe (0 code
  `opentelemetry` aujourd'hui). Le trigger écrit (« émet des spans ») est un proxy **plus
  faible** que le besoin : même un substrat statique plein émettrait des nœuds de flot de
  contrôle, pas les spans de fréquence runtime.
- **3.2 profils auteurs** — dégel si SOIT (a) `git log --since=90d --format="%ae" | sort -u`
  ≥ 2 emails **réellement** distincts (les variantes de casse d'un même email ne comptent
  pas) ; SOIT (b) un parseur de trailers `Co-Authored-By` est committé ET câblé à un
  consommateur (les 334 trailers latents deviennent des entités auteur alimentant un nœud/
  panel). Aujourd'hui : 1 humain, aucun consommateur.
- **3.10 plugin architecture** — dégel quand ≥ 2 analytics **génuinement nouvelles**
  (calcul de métrique neuf + route REST + colonne CSV + outil MCP) sont committées après le
  gel. N'en comptent PAS : l'infra (ETag, cache node-ids, tests), ni le sidecar copilot
  (COPILOT-1 : lit l'existant, n'ajoute rien), ni les modules pré-gel re-posés via reconcile.
- **inverted-index repoId** — dégel si SOIT (a) le registre `/api/repos` contient ≥ 3
  entrées distinctes résolvant au **même** repoId (vrai pattern multi-clone/worktree, pas un
  fixture) ; SOIT (b) `/metrics` rapporte un p95 `/repos/by-id` actionnable (> 200 ms) sous
  charge réelle. Aujourd'hui le scan O(n) porte sur < 50 petits reads cachés.
- **versioned export/import** — dégel si SOIT (a) un vrai import produit en prod un graphe
  cassé/mal-reconstruit (le trigger écrit) ; SOIT (b) un commit change le format d'export
  (`meta.json` / lbug) **alors que** d'anciens bundles existent, rendant un chemin de
  ré-import cross-version réellement atteignable.
- **3.4 auto-PR** — dégel quand une capacité d'écriture PR committée atterrit (un
  `octokit`/`pulls.create`, un `gh pr create`, ou un outil MCP créant une PR — pas les POST
  locaux actuels) ET un producteur de diff de refacto la nourrit.
- **3.5 prédiction bugs** — dégel quand SOIT un labelleur SZZ, SOIT une intégration
  issue-tracker, SOIT un dataset labellisé committé fournit des labels bug/no-bug, ET un
  scoreur les consomme (churn × coupling × bus-factor). Les features d'entrée existent déjà ;
  seul le seam de vérité-terrain manque.
- **3.6 CI architectural** — dégel quand (i) est déclarée close ET un usage interne concret
  est committé : un endpoint `/ci-check` lisant réellement `.gitnexus.json > budgets`
  (aujourd'hui 0 parseur) avec un vrai appelant. La bataille commerciale reste **définitivement**
  sans objet sous PolyForm ; seule une voie interne dégèle.

## DELETE — 3.9 dataset public (verdict écrit)

**Retiré de la roadmap.** Le seul moteur de 3.9 est le **Chemin C** (« Galaxie OSS /
Industry baseline », modèle *SaaS / API publique*) — structurellement impossible sous la
licence **PolyForm-Noncommercial** héritée de l'upstream (que le fork ne peut relicencier
unilatéralement). La direction retenue est le **Chemin B** (mono-utilisateur/agent), qui n'a
pas besoin d'un dataset public. Le seul résidu compatible-licence (comparer *ses propres*
repos à des médianes OSS) **n'est pas** 3.9 — il vit sous Galaxie 2.5/2.6, tracées
indépendamment. Retirer 3.9 ne perd aucune capacité. Coût évité : ~1 mois compute + ~100 Go
stockage + maintenance mensuelle. La seule revival concevable (upstream relicencie hors
PolyForm **ET** le fork ré-adopte explicitement le Chemin C) est hors du contrôle du fork et
contredit la stratégie enregistrée → ne franchit pas la barre STAY-FROZEN.

## Iron Rules

- **Σ-A-PREVENTIVE-GUARD-STILL-NEEDS-A-REACHABLE-FAILURE-SCENARIO** — un « buildable quoi
  qu'il arrive » sans scénario d'échec atteignable est du code spéculatif (export/import
  rétrogradé par la vérification adversariale).
- **Σ-AUTHOR-DIVERSITY-IS-KEYED-ON-EMAIL-NOT-NAME-CASE** — `%an` piège sur la casse ;
  mesurer `%ae`.
- **Σ-AN-UNCONSUMED-INPUT-DOUBLES-THE-FREEZE** — 3.6 n'a ni consommateur de sa sortie ni
  parseur de son entrée (`budgets`) : doublement inerte.
- **Σ-A-FROZEN-TIER-IS-TRIAGED-BY-TRIGGER-NOT-BUILT-BY-DECREE** (Bloc 2 confirme la cardinale) —
  la mesure décide, pas le décret ; ici elle dit « rien ne dégèle ».
- **Σ-A-DEATH-CERTIFICATE-IS-A-DELETE-NOT-A-FREEZE** — quand la raison d'être est
  structurellement morte (licence), l'item sort de la roadmap avec verdict, il ne reste pas
  gelé (3.9).
