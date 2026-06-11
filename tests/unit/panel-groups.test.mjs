import { describe, it, expect } from 'vitest';
import { PANEL_GROUP_OF, PANEL_GROUPS, modesInGroup } from '../../upstream/gitnexus-web/src/lib/panel-groups.ts';
describe('panel-groups', () => {
  it('has 3 groups', () => { expect(PANEL_GROUPS.map((g) => g.id)).toEqual(['health', 'social', 'cross-repo']); });
  it('social = ownership + lifespan', () => { expect(modesInGroup('social').sort()).toEqual(['lifespan', 'ownership']); });
  it('cross-repo = similarity', () => { expect(modesInGroup('cross-repo')).toEqual(['similarity']); });
  it('every mode maps to a group; union covers all modes with no dup', () => {
    const all = Object.keys(PANEL_GROUP_OF);
    const union = PANEL_GROUPS.flatMap((g) => modesInGroup(g.id));
    expect(union.sort()).toEqual(all.sort());
    expect(new Set(union).size).toBe(all.length);
  });
});
