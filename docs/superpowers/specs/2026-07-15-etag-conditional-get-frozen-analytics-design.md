# ETag / conditional-GET (304) sur les analytics de timeline — design

**Date** : 2026-07-15
**SIGIL** : SIGIL-1711 Bloc 1, (ii).4 ⊕ cueillette ETag/304
**Statut** : livré

## Problème

Les 4 endpoints d'analytics de timeline (`/churn`, `/growth`, `/lifespan`,
`/coupling`) renvoient une série déterministe sur les points de snapshot d'un repo.
Depuis le cache partagé per-snapshot (P3, `docker-server-snapshot-nodeids.mjs`), leur
**coût de calcul** est déjà réglé (froid ~0.1 s). Il reste le coût de **re-transfert** :
une re-requête identique renvoie le même corps en entier. `git grep` confirme
qu'**aucun handler n'implémente de 304 conditionnel** aujourd'hui.

## Décision : weak ETag body-hash + `If-None-Match` → 304

Un **ETag = hash du corps de réponse** (sha256 tronqué). Correct **par construction** :
l'ETag ≡ les octets envoyés, donc :
- un snapshot figé (immuable) → même corps → même ETag → 304 sur re-requête ;
- le point LIVE bouge (reindex) → corps différent → ETag différent → jamais servi
  périmé. La contrainte roadmap « LIVE jamais caché » est satisfaite gratuitement.

Rejeté : un ETag dérivé de la clé de cache (repoId+points+params) *avant* calcul —
plus invasif, doit capturer exactement tout ce qui influe sur le corps (fragile). Le
calcul étant déjà bon marché (P3), le body-hash ne sacrifie que l'économie de calcul
(nulle ici) pour une correction totale.

## Forme : intercepteur de réponse `withETag(req, res)` (footprint in-place minimal)

Module owned `upstream/docker-server-etag.mjs` :

- `computeETag(body: string): string` — `"` + sha256(body)[:32] + `"` (weak-ish, quoted).
- `withETag(req, res): void` — enveloppe `res.writeHead`/`res.end`. Pour une réponse
  **200 `application/json` à corps string** uniquement : calcule l'ETag, compare à
  `req.headers['if-none-match']` → `304` sans corps si égal, sinon `200` + header `ETag`.
  **Tout le reste passe à travers inchangé** (400/404/500, non-JSON, corps non-string,
  streams).

Câblage : `withETag(req, res)` en tête des 4 `handleXRoute(req, url, res, opts)` avant
l'appel au handler. Les handlers cœur (`handleChurn`, …) sont **inchangés** (aucun
changement de signature) — footprint = 4 lignes in-place + 1 import chacun.

## Tests

- **Unit** (`tests/unit/etag-conditional-get.test.mjs`) : `computeETag` déterministe +
  différent pour corps différents ; `withETag` : (a) 1re réponse 200 porte l'ETag ;
  (b) `If-None-Match` égal → 304 sans corps ; (c) `If-None-Match` différent → 200 +
  corps ; (d) 404/non-JSON/corps-non-string → pass-through intact.
- **Integration** (`tests/integration/endpoints/etag-conditional-get.test.mjs`) : GET
  `/churn` → capture l'ETag → re-GET avec `If-None-Match` → **304**, corps vide.

## Hors scope

Pas d'ETag sur les endpoints non-déterministes ou à effet de bord. Pas de
`Cache-Control`/`max-age` (le client re-valide toujours via `If-None-Match`).
