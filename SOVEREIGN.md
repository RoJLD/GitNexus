# GitNexus — Sovereign Tracking

- **upstream remote** : `origin` → `abhigyanpatwari/GitNexus` (drift baseline `v1.6.5`)
- **sovereign remote** : `sovereign` → `RoJLD/GitNexus@deployment` (patches-only fork, branding "Elysium")
- **current branch** : `sovereign-deployment` tracking `sovereign/deployment`
- **pattern** : Σ-PATCH-ONLY (additive 914 KB + inplace 313 KB + `cohabitation.config.json`)

Pour rebase upstream → sovereign : `node scripts/bump-upstream.mjs <ref>` (dry-run + report).
