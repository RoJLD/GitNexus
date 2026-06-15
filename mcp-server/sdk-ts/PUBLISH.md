# Publishing `@gitnexus/copilot-sdk` to npm

> Iron Rule **Sigma-COPILOT-SDK-PUBLISH-1** (`Sigma-TAG-DRIVEN-CI-PUBLISH`) :
> the SDK is published EXCLUSIVELY by tag-driven CI. No operator may
> `npm publish` from a workstation. Tagging is the audit trail.

## Tag-driven CI flow (the only supported path)

The workflow `.github/workflows/publish-npm.yml` triggers on any tag
matching `sdk-ts-v*` and publishes to the public npm registry as
`@gitnexus/copilot-sdk`.

### Pre-flight (do this before tagging)

1. Bump `package.json` `version` to the next semver (follow
   [Keep a Changelog](https://keepachangelog.com/) on `CHANGELOG.md` :
   move entries from `[Unreleased]` into the new version section).
2. Run locally and confirm green :
   ```bash
   cd mcp-server/sdk-ts
   npm ci
   npm run typecheck
   npm run build
   npm test
   ```
3. Commit the version + changelog bump :
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(sdk-ts): bump v<X.Y.Z>"
   ```

### Tag + push

```bash
git tag sdk-ts-v<X.Y.Z>
git push origin sdk-ts-v<X.Y.Z>
```

CI then :
1. Checks out the tagged commit.
2. Sets up Node 20 with the npm registry URL.
3. Runs `npm ci`, `npm run typecheck`, `npm run build`.
4. Verifies `package.json.version` exactly matches the tag (fails the job
   on drift so we never publish a mismatched version).
5. Runs `npm publish --access public --provenance` using the
   `NPM_TOKEN` automation secret.

### Required GitHub secret

| Name | Scope | Where to mint |
|---|---|---|
| `NPM_TOKEN` | npm automation token (publish) | <https://www.npmjs.com/settings/<user>/tokens> -> "Generate New Token" -> "Automation". |

The token must have publish rights on the `@gitnexus` scope.

### Verifying the publish

```bash
npm view @gitnexus/copilot-sdk@<X.Y.Z>
```

### Emergency manual publish (require explicit Architecte approval)

Manual publish is treated as a **break-glass** event. If you absolutely
must publish without CI :

1. Get explicit written approval from the Architecte (audit-logged).
2. Log the manual publish in `data/governance/sovereign_push_log.jsonl`
   with reason + commit SHA + npm version + your identity.
3. Update this `PUBLISH.md` with the incident date + post-mortem link.

The CI workflow is the source-of-truth ; rebuild the auditable path
ASAP.
