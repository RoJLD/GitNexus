import { describe, it, expect, vi } from 'vitest';
import { planeConnector } from '../../upstream/connectors/plane.mjs';

describe('planeConnector.fetchOpenWorkItems', () => {
  it('throws when apiKey missing', async () => {
    await expect(
      planeConnector.fetchOpenWorkItems({ apiUrl: 'http://x', workspaceSlug: 'w', projectId: 'p' }),
    ).rejects.toThrow(/PLANE_API_KEY/);
  });

  it('returns mapped issues filtered by state', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: '1', name: 'foo', description_html: '<p>x</p>', state_detail: { name: 'Backlog' }, target_date: null },
          { id: '2', name: 'bar', state_detail: { name: 'Done' }, target_date: '2026-01-01' },
        ],
      }),
    }));
    const r = await planeConnector.fetchOpenWorkItems({ apiUrl: 'http://x', workspaceSlug: 'w', projectId: 'p', apiKey: 'k' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: '1', title: 'foo', state: 'open' });
  });
});
