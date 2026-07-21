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
| 3.2 profils auteurs git-only | STAY-FROZEN | non | **1 seule** identité humaine ; les « 2 » sont des artefacts d'adressage du même compte — casse `DENIS`/`Denis` au 16/07, **plus** la noreply GitHub des merges web au 21/07 ; trailers Co-Authored-By tous bot ; aucun parseur ni consommateur |
| 3.10 plugin architecture | STAY-FROZEN | non | **0** nouvelle analytics depuis le gel (7 modules = sidecar copilot + 2 infra, aucun calcul de métrique) |
| inverted-index repoId | STAY-FROZEN | non | les worktrees **collapsent** vers une identité par design ; pas de bottleneck (<50 repos, reads cachés) |
| versioned export/import | STAY-FROZEN | non | **BUILD rétrogradé** : scénario version-skew injoignable en mono-format |
| 3.4 auto-PR refacto | STAY-FROZEN | non | aucune capacité d'écriture PR ; le consommateur agent est MCP **read-only** |
| 3.5 prédiction bugs | STAY-FROZEN | non | **zéro** source de labels (ni SZZ, ni issue-link, ni dataset) |
| 3.6 CI architectural | STAY-FROZEN | non | licence PolyForm rend la bataille sans objet ; `parseBudgets()` **existe** (config:120) mais **sans appelant ni endpoint `/ci-check`** — cf. correction 2026-07-21, la mention « 0 parseur » était fausse |
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
  rend ≥ 2 emails appartenant à des **PERSONNES** distinctes ; SOIT (b) un parseur de
  trailers `Co-Authored-By` est committé ET câblé à un consommateur (les trailers latents
  deviennent des entités auteur alimentant un nœud/panel). Aujourd'hui : 1 humain, aucun
  consommateur.

  > **Le critère porte sur les personnes, pas sur les chaînes** — durci le 2026-07-21 après
  > un faux positif évité de justesse. La rédaction initiale disait « ≥ 2 emails réellement
  > distincts (les variantes de casse d'un même email ne comptent pas) » : elle nommait UNE
  > forme de faux jumeau et restait aveugle aux autres. Mesuré ce jour, `sort -u` rend bien
  > 2 emails — mais le second est `78423680+RoJLD@users.noreply.github.com`, sur exactement
  > 3 commits, tous `Merge pull request #N from RoJLD/…`. C'est l'adresse noreply que GitHub
  > attribue au **même compte** lors d'un merge via l'interface web. Une personne, deux
  > canaux.
  >
  > Le piège se **rejouera** : il apparaît mécaniquement dès qu'une PR est mergée depuis le
  > web, donc il grossira avec l'usage normal du dépôt.
  >
  > Contrôle à appliquer avant de conclure que (a) est tiré :
  >
  > ```bash
  > git log --since=90.days --format="%ae | %an" | sort -u
  > ```
  >
  > Écarter les `*@users.noreply.github.com` dont le préfixe numérique correspond au compte
  > du dépôt, et vérifier que les `%an` désignent des personnes différentes. Un email est
  > une adresse, pas une identité.
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
  est committé : un endpoint `/ci-check` lisant réellement `.gitnexus.json > budgets` avec un
  vrai appelant. La bataille commerciale reste **définitivement** sans objet sous PolyForm ;
  seule une voie interne dégèle.

  > **Correction 2026-07-21** — la rédaction initiale disait « aujourd'hui 0 parseur ».
  > **Faux** : `parseBudgets()` existe et parse réellement
  > (`upstream/docker-server-config.mjs:120-125` — lecture de `parsed?.budgets`, garde de
  > type, itération des entrées). Ce qui manque est l'**appelant** et l'endpoint `/ci-check`
  > (0 occurrence de `ci-check` dans `upstream/docker-server-*.mjs` ni dans
  > `mcp-server/server.mjs`). Le verdict STAY-FROZEN ne bouge pas — aucune des deux
  > conditions n'est remplie — mais l'écart réel est **un endpoint**, pas « un parseur + un
  > endpoint ». La justification faisait paraître l'item plus lointain qu'il n'est, ce qui
  > fausserait toute ré-estimation future.
  >
  > Note sur (i) : la phase (i) est de fait close à cette date (12/12 specs e2e migrées vers
  > `connectRepo`, quarantaine `cap=0` / 0 active, aucun `continue-on-error` actif). Seul le
  > second membre de la conjonction manque donc encore.

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
- ~~**Σ-AUTHOR-DIVERSITY-IS-KEYED-ON-EMAIL-NOT-NAME-CASE**~~ — *« `%an` piège sur la casse ;
  mesurer `%ae` »*. **Insuffisante, remplacée le 2026-07-21** (voir ci-dessous). Elle avait
  raison sur son cas et tort sur sa portée : `%ae` piège aussi.
- **Σ-AUTHOR-DIVERSITY-COUNTS-PEOPLE-NOT-ADDRESSES** *(remplace la précédente)* — un email
  est une adresse, pas une identité. Une même personne en émet plusieurs : casse variable,
  mais aussi `<id>+<handle>@users.noreply.github.com`, que GitHub attribue au **même compte**
  sur les merges web. Mesuré : `%ae | sort -u` rendait 2 emails là où il y a 1 humain, et les
  3 commits fautifs étaient les merges des PRs de la session en cours — le faux positif
  était **fabriqué par l'acte de livrer**. Toute règle de diversité doit rapprocher l'adresse
  d'un porteur avant de compter, et le piège se rejouera à chaque merge web.
- **Σ-A-NARROW-GUARD-INVITES-THE-VARIANT-IT-DIDNT-NAME** — la règle ci-dessus énumérait UNE
  forme de faux jumeau (la casse) et restait aveugle aux autres. Un garde qui liste le connu
  ne couvre pas l'inconnu : formuler l'invariant (« des personnes distinctes »), pas la liste
  des contre-exemples déjà rencontrés.
- ~~**Σ-AN-UNCONSUMED-INPUT-DOUBLES-THE-FREEZE**~~ — *« 3.6 n'a ni consommateur de sa sortie
  ni parseur de son entrée »*. **Prémisse fausse, corrigée le 2026-07-21** : `parseBudgets()`
  existe (`docker-server-config.mjs:120`). 3.6 reste gelé pour l'autre moitié — pas de
  consommateur, pas d'endpoint `/ci-check` — mais le gel est **simple**, pas double.
- **Σ-A-FREEZE-JUSTIFICATION-DECAYS-AND-MUST-BE-RE-MEASURED** — un verdict de gel est daté.
  Ses raisons vieillissent indépendamment de lui : ici le verdict a tenu 5 jours pendant
  qu'une de ses deux justifications devenait fausse. Re-mesurer les triggers coûte quelques
  minutes ; s'appuyer sur une justification périmée fausse toute ré-estimation du coût.
- **Σ-A-FROZEN-TIER-IS-TRIAGED-BY-TRIGGER-NOT-BUILT-BY-DECREE** (Bloc 2 confirme la cardinale) —
  la mesure décide, pas le décret ; ici elle dit « rien ne dégèle ».
- **Σ-A-DEATH-CERTIFICATE-IS-A-DELETE-NOT-A-FREEZE** — quand la raison d'être est
  structurellement morte (licence), l'item sort de la roadmap avec verdict, il ne reste pas
  gelé (3.9).

---

## Update 2026-07-21 — re-audit des triggers (5 jours après le gel)

**Méthode** : chaque condition de dégel ci-dessus ré-exécutée telle qu'elle est écrite, sur
l'état du dépôt à cette date. Rien n'a été pris sur parole du triage initial.

**Verdict global : aucun trigger n'a tiré. Les 8 STAY-FROZEN tiennent.** Ce qui a bougé, ce
sont deux *justifications*, pas deux verdicts.

| Item | Ré-exécuté | Résultat |
|---|---|---|
| 3.1 dead-code | `grep BasicBlock registration-table.ts` | `BasicBlock: 'inert'` (l. 187) — inchangé |
| 3.2 profils auteurs | `git log --since=90d --format=%ae \| sort -u` | **2 emails, 1 personne** — voir ci-dessous |
| 3.4 auto-PR | `grep -rl "pulls.create\|gh pr create\|octokit"` | 0 occurrence — aucune capacité d'écriture |
| 3.5 prédiction bugs | recherche labelleur SZZ / issue-link / dataset | aucune source de labels |
| 3.6 CI architectural | `grep budgets` + `grep ci-check` | **parseur PRÉSENT, endpoint absent** — justification corrigée |
| 3.10 plugin architecture | modules `docker-server-*.mjs` ajoutés depuis le gel | **0** — voir ci-dessous |

### 3.2 — un faux positif évité, fabriqué par la session elle-même

`sort -u` rend bien 2 emails, ce qui aurait suffi à déclarer le trigger tiré en lisant le
critère au pied de la lettre. Le second est `78423680+RoJLD@users.noreply.github.com`, `%an`
= `Robin DENIS`, sur exactement 3 commits — tous `Merge pull request #3/#4/#5 from RoJLD/…`,
c'est-à-dire les merges web des PRs livrées **ce jour même**. `RoJLD` est le compte
propriétaire du dépôt : une personne, deux canaux.

Le critère et l'Iron Rule qui le portait ont été durcis (« compter des personnes, pas des
adresses »), parce que le piège grossira mécaniquement à chaque merge web.

### 3.10 — `gitnexus_narrate_lens` ne compte pas

Un outil MCP a bien été ajouté depuis le gel, mais le critère exige **≥ 2 analytics
génuinement nouvelles** = calcul de métrique neuf + route REST + colonne CSV + outil MCP.
`gitnexus_narrate_lens` proxifie une route gateway **existante** : aucun calcul neuf, aucune
colonne CSV. C'est exactement l'exclusion déjà écrite pour le sidecar copilot
(« lit l'existant, n'ajoute rien »). Compte réel depuis le gel : **0**.

### Ce que ce re-audit démontre

Un verdict de gel est daté, et ses justifications vieillissent **indépendamment de lui**.
En 5 jours, sans que le verdict 3.6 bouge d'un pouce, l'une de ses deux raisons est devenue
fausse — et l'écart réel est passé de « un parseur + un endpoint » à « un endpoint », ce qui
change l'estimation du coût de dégel du simple au double.

Re-mesurer coûte quelques minutes. Ne pas re-mesurer laisse la roadmap raisonner sur un état
qui n'existe plus.
