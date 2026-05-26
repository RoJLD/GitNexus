# Golden snapshots

Chaque test integration `tests/integration/endpoints/<endpoint>.test.mjs`
charge `tests/fixtures/expected/<endpoint>.json` et compare la réponse.

## Capture initiale

La première fois qu'on écrit un test integration, on lance :

```
WRITE_GOLDEN=1 npm run test:integ -- <endpoint>
```

Le helper `expectGolden()` (voir `tests/integration/helpers/golden.mjs`)
écrit la réponse au lieu de comparer.

## Régénération volontaire

Après une évolution consciente d'une analytique (changement de
formule), on relance la capture pour le endpoint concerné et on commit
le `.json` modifié. Le diff doit être petit et expliqué dans le commit.

## Convention de tolérance

- Floats : comparaison `closeTo(value, 1e-6)`.
- Tableaux : ordre préservé (assurer un `ORDER BY` côté serveur si besoin).
- Strings : exact match.
