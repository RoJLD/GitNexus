import { describe, it, expect } from 'vitest';
import {
  serializeTimelineToParams,
  parseTimelineParams,
} from '../../upstream/gitnexus-web/src/lib/timeline-url';

describe('serializeTimelineToParams', () => {
  it('sets all 5 params for a full non-default state', () => {
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: 'a8f3c2d',
      cursorBShortHash: 'live',
      zoom: true,
      graphMode: 'diff',
      filterMode: 'strict',
    });
    expect(set).toEqual({
      tlA: 'a8f3c2d',
      tlB: 'live',
      tlZoom: '1',
      tlMode: 'diff',
      tlFilter: 'strict',
    });
    expect(remove).toEqual([]);
  });

  it('puts default values in the remove list (clean URL)', () => {
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: null,
      cursorBShortHash: null,
      zoom: false,
      graphMode: 'single',
      filterMode: 'off',
    });
    expect(set).toEqual({});
    expect(remove.sort()).toEqual(['tlA', 'tlB', 'tlFilter', 'tlMode', 'tlZoom']);
  });

  it('filter=off → tlFilter removed; filter=normal → tlFilter set', () => {
    const off = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'off' });
    expect(off.remove).toContain('tlFilter');
    const normal = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'normal' });
    expect(normal.set.tlFilter).toBe('normal');
  });

  it('graphMode=single → tlMode removed; diff → tlMode set', () => {
    const single = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'off' });
    expect(single.remove).toContain('tlMode');
    const diff = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'diff', filterMode: 'off' });
    expect(diff.set.tlMode).toBe('diff');
  });
});

describe('parseTimelineParams', () => {
  it('parses all params present', () => {
    const params = new URLSearchParams('tlA=a8f3c2d&tlB=live&tlZoom=1&tlMode=diff&tlFilter=permissive');
    expect(parseTimelineParams(params)).toEqual({
      cursorAShortHash: 'a8f3c2d',
      cursorBShortHash: 'live',
      zoom: true,
      graphMode: 'diff',
      filterMode: 'permissive',
    });
  });

  it('returns defaults when params missing', () => {
    const params = new URLSearchParams('');
    expect(parseTimelineParams(params)).toEqual({
      cursorAShortHash: null,
      cursorBShortHash: null,
      zoom: false,
      graphMode: 'single',
      filterMode: 'off',
    });
  });

  it('invalid tlFilter defaults to off', () => {
    const params = new URLSearchParams('tlFilter=garbage');
    expect(parseTimelineParams(params).filterMode).toBe('off');
  });

  it('tlZoom only true for exactly "1"', () => {
    expect(parseTimelineParams(new URLSearchParams('tlZoom=1')).zoom).toBe(true);
    expect(parseTimelineParams(new URLSearchParams('tlZoom=0')).zoom).toBe(false);
    expect(parseTimelineParams(new URLSearchParams('tlZoom=true')).zoom).toBe(false);
    expect(parseTimelineParams(new URLSearchParams('')).zoom).toBe(false);
  });

  it('tlMode only diff for exactly "diff"', () => {
    expect(parseTimelineParams(new URLSearchParams('tlMode=diff')).graphMode).toBe('diff');
    expect(parseTimelineParams(new URLSearchParams('tlMode=single')).graphMode).toBe('single');
    expect(parseTimelineParams(new URLSearchParams('tlMode=xyz')).graphMode).toBe('single');
  });

  it('round-trips with serializeTimelineToParams (set values)', () => {
    const state = { cursorAShortHash: 'aaa', cursorBShortHash: 'bbb', zoom: true, graphMode: 'diff', filterMode: 'strict' };
    const { set } = serializeTimelineToParams(state);
    const params = new URLSearchParams(set);
    const parsed = parseTimelineParams(params);
    expect(parsed).toEqual(state);
  });
});
