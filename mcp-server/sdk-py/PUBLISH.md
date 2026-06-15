# Publishing `gitnexus-copilot-sdk` to PyPI

> Iron Rule **Sigma-COPILOT-SDK-PUBLISH-1** (`Sigma-TAG-DRIVEN-CI-PUBLISH`) :
> the SDK is published EXCLUSIVELY by tag-driven CI. No operator may
> `twine upload` from a workstation. Tagging is the audit trail.

## Tag-driven CI flow (the only supported path)

The workflow `.github/workflows/publish-pypi.yml` triggers on any tag
matching `sdk-py-v*` and uploads the sdist + wheel to PyPI as
`gitnexus-copilot-sdk`.

### Pre-flight (do this before tagging)

1. Bump the `version` field in `pyproject.toml` to the next semver
   (follow [Keep a Changelog](https://keepachangelog.com/) on
   `CHANGELOG.md` : move entries from `[Unreleased]` into the new
   version section).
2. Run locally and confirm green :
   ```bash
   cd mcp-server/sdk-py
   pip install -e ".[dev]"
   python -m pytest tests/ -v
   python -m build  # verifies the package builds (sdist + wheel)
   ```
3. Commit the version + changelog bump :
   ```bash
   git add pyproject.toml CHANGELOG.md
   git commit -m "chore(sdk-py): bump v<X.Y.Z>"
   ```

### Tag + push

```bash
git tag sdk-py-v<X.Y.Z>
git push origin sdk-py-v<X.Y.Z>
```

CI then :
1. Checks out the tagged commit.
2. Sets up Python 3.11 and installs `build` + `twine`.
3. Installs the package with dev extras and runs `pytest`.
4. Verifies `pyproject.toml.version` exactly matches the tag (fails the
   job on drift so we never upload a mismatched version).
5. Runs `python -m build` to produce sdist + wheel in `dist/`.
6. Runs `twine upload dist/*` using the `PYPI_API_TOKEN` secret.

### Required GitHub secret

| Name | Scope | Where to mint |
|---|---|---|
| `PYPI_API_TOKEN` | PyPI API token (project-scoped) | <https://pypi.org/manage/account/token/> -> "Add API token" -> scope = `gitnexus-copilot-sdk`. |

### Verifying the publish

```bash
pip index versions gitnexus-copilot-sdk
# or
pip install gitnexus-copilot-sdk==<X.Y.Z>
```

### Emergency manual publish (require explicit Architecte approval)

Manual publish is treated as a **break-glass** event. If you absolutely
must publish without CI :

1. Get explicit written approval from the Architecte (audit-logged).
2. Log the manual publish in `data/governance/sovereign_push_log.jsonl`
   with reason + commit SHA + PyPI version + your identity.
3. Update this `PUBLISH.md` with the incident date + post-mortem link.

The CI workflow is the source-of-truth ; rebuild the auditable path
ASAP.
