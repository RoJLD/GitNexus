import { describe, it, expect } from 'vitest';
import { filesInDiff, compareDiffFileSets, normalizeDiff } from '../../scripts/check-patch-drift.mjs';

const DIFF = `diff --git a/docker-server-foo.mjs b/docker-server-foo.mjs
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/docker-server-foo.mjs
@@ -0,0 +1 @@
+export const x = 1;
diff --git a/gitnexus-web/src/App.tsx b/gitnexus-web/src/App.tsx
index 2222222..3333333 100644
--- a/gitnexus-web/src/App.tsx
+++ b/gitnexus-web/src/App.tsx
@@ -1 +1 @@
-old
+new
`;

describe('filesInDiff', () => {
  it('extrait les chemins depuis les lignes `diff --git a/.. b/..`', () => {
    const s = filesInDiff(DIFF);
    expect(s).toBeInstanceOf(Set);
    expect([...s].sort()).toEqual(['docker-server-foo.mjs', 'gitnexus-web/src/App.tsx']);
  });
  it('renvoie un set vide pour un diff vide', () => {
    expect(filesInDiff('').size).toBe(0);
  });
});

describe('compareDiffFileSets', () => {
  it('détecte un fichier présent dans le clone mais absent du diff commité (missing)', () => {
    const committed = new Set(['a.mjs']);
    const live = new Set(['a.mjs', 'b.mjs']);
    const r = compareDiffFileSets(committed, live);
    expect(r.drifted).toBe(true);
    expect(r.missing).toEqual(['b.mjs']);
    expect(r.extra).toEqual([]);
  });
  it('détecte un fichier commité mais disparu du clone (extra)', () => {
    const r = compareDiffFileSets(new Set(['a.mjs', 'c.mjs']), new Set(['a.mjs']));
    expect(r.drifted).toBe(true);
    expect(r.extra).toEqual(['c.mjs']);
    expect(r.missing).toEqual([]);
  });
  it('pas de dérive quand les ensembles sont identiques', () => {
    const r = compareDiffFileSets(new Set(['a.mjs']), new Set(['a.mjs']));
    expect(r.drifted).toBe(false);
  });
});

describe('normalizeDiff', () => {
  it('normalise les fins de ligne CRLF → LF', () => {
    expect(normalizeDiff('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('laisse le texte LF inchangé', () => {
    expect(normalizeDiff('a\nb\n')).toBe('a\nb\n');
  });
});
