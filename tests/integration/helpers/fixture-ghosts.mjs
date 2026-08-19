/**
 * The ghost set the fixture repo DECLARES — derived, never copied.
 *
 * Why this helper exists (measured 2026-08-19): `ghosts.test.mjs` and
 * `ghosts-sync.test.mjs` both hardcoded `expect(body.ghosts.length).toBe(6)`.
 * PR #9 added `### 1.3 — Config validator` to the SHARED fixture
 * (tests/fixtures/make-fixture.mjs, commit 14) so the cluster-halos e2e spec
 * would have a real Ghost Cluster to exercise — a necessary, correct change
 * that turned both assertions red (`expected 7 to be 6`). The copied `6` even
 * carried a comment that was already false ("2 table rows + 3 Tier sections =
 * 5 ghosts"): the copy nobody edits always wins, silently.
 *
 * So the count is not written down here either. It is DERIVED, and both ends
 * of the derivation are the real thing:
 *
 *   - the DATA is the ROADMAP.md the stack actually serves — read straight out
 *     of tests/fixtures/sample-repo.tar.gz, i.e. the very tarball
 *     `helpers/stack.mjs → extractFixture()` unpacks into the containers'
 *     /data/projects mount. No second copy of the roadmap exists to drift.
 *   - the RULE is `parseRoadmap()` from upstream/docker-server-ghosts-core.mjs
 *     — the exact function the `/ghosts/sync` builtin source calls
 *     (docker-server-ghosts.mjs → registerBuiltinGhostSource). We do not
 *     re-implement "what counts as a ghost" here; re-implementing it would
 *     recreate the same two-sources defect one level up.
 *
 * What that leaves the integration assertions testing: the ENDPOINT contract
 * — sync parses the roadmap, persists it, and `/ghosts` serves back exactly
 * the declared set, in order, with no drops and no extras. The parsing rules
 * themselves are locked one tier down by tests/unit/ghosts-parser.test.mjs,
 * and feeding a roadmap to the CORE parser from an integration test is an
 * established move in this suite (see brainstorm-hook-e2e.test.mjs).
 *
 * Regenerate the tarball after touching make-fixture.mjs:
 *   npm run fixture:rebuild   (in tests/)
 * If you forget, these assertions go red — which is the point.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoadmap } from '../../../upstream/docker-server-ghosts-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARBALL = join(HERE, '..', '..', 'fixtures', 'sample-repo.tar.gz');
const ROADMAP_MEMBER = 'sample-repo/ROADMAP.md';

let cachedGhosts = null;

/** Raw ROADMAP.md bytes of the fixture repo, straight from the tarball. */
export function fixtureRoadmapMd() {
  // Feed the archive on stdin (`-f -`) instead of by path: the fixture lives
  // under a Windows drive-letter path, which GNU tar (Git for Windows) reads
  // as a remote host. stdin sidesteps that entirely, and `-O` streams the one
  // member to stdout on both GNU tar and bsdtar. execFileSync = no shell.
  const archive = readFileSync(TARBALL);
  return execFileSync('tar', ['-xzOf', '-', ROADMAP_MEMBER], {
    input: archive,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

/** Every ghost the fixture ROADMAP declares, as the server's own parser sees them. */
export function fixtureDeclaredGhosts() {
  if (!cachedGhosts) cachedGhosts = parseRoadmap(fixtureRoadmapMd());
  return cachedGhosts;
}

/**
 * Declared ghost ids, in parse order. `buildGhosts` (docker-server-ghosts.mjs)
 * maps declared→runtime 1:1 and keeps both the id and the order, so a synced
 * `/ghosts` payload must match this list exactly.
 */
export function fixtureDeclaredGhostIds() {
  return fixtureDeclaredGhosts().map(g => g.id);
}
