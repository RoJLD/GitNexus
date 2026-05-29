import { describe, it, expect } from 'vitest';
import { hiddenMarkerPath } from '../../upstream/docker-server-snapshots.mjs';

describe('hiddenMarkerPath', () => {
  it('returns the .hidden sentinel path inside a snapshot dir', () => {
    expect(hiddenMarkerPath('/data/gitnexus/snapshots/demo/abc123')).toBe(
      '/data/gitnexus/snapshots/demo/abc123/.hidden',
    );
  });
});
