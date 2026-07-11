import { describe, it, expect } from 'vitest';
import { hiddenMarkerPath } from '../../upstream/docker-server-snapshots.mjs';

describe('hiddenMarkerPath', () => {
  it('returns the .hidden sentinel path inside a snapshot dir', () => {
    // path.join emits the host separator ('\' on a Windows dev machine); the
    // production path is always the Linux container. Normalize so the test
    // asserts the CONTENT, not the platform separator.
    expect(hiddenMarkerPath('/data/gitnexus/snapshots/demo/abc123').replaceAll('\\', '/')).toBe(
      '/data/gitnexus/snapshots/demo/abc123/.hidden',
    );
  });
});
