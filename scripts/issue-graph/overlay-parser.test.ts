import { describe, it, expect } from 'vitest';
import { parseOverlay } from './overlay-parser.js';

const CLUSTER_FIXTURE = [
  '# Issue graph overlay',
  '',
  '```issue-graph',
  'cluster: hunters',
  'members: [3, 75, 80, 81]',
  'note: Spider, dialect packs, Hawk — compete for the same slot.',
  '```',
].join('\n');

const EDGE_FIXTURE = [
  '```issue-graph',
  'edge: depends-on',
  'from: 75',
  'to: 52',
  'note: Gate B methodology.',
  '```',
].join('\n');

const STATUS_FIXTURE = [
  '```issue-graph',
  'status: in-progress',
  'issue: 75',
  'started: 2026-04-20T14:32:00Z',
  'note: Branch docs/issue-graph-design.',
  '```',
].join('\n');

describe('parseOverlay', () => {
  it('parses a cluster block', () => {
    const overlay = parseOverlay(CLUSTER_FIXTURE);
    expect(overlay.blocks).toHaveLength(1);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('cluster');
    if (block.kind !== 'cluster') throw new Error('unreachable');
    expect(block.cluster).toBe('hunters');
    expect(block.members).toEqual([3, 75, 80, 81]);
    expect(block.note).toContain('Spider');
  });

  it('parses an edge block', () => {
    const overlay = parseOverlay(EDGE_FIXTURE);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('edge');
    if (block.kind !== 'edge') throw new Error('unreachable');
    expect(block.edge).toBe('depends-on');
    expect(block.from).toBe(75);
    expect(block.to).toBe(52);
  });

  it('parses a status block', () => {
    const overlay = parseOverlay(STATUS_FIXTURE);
    const block = overlay.blocks[0];
    expect(block.kind).toBe('status');
    if (block.kind !== 'status') throw new Error('unreachable');
    expect(block.status).toBe('in-progress');
    expect(block.issue).toBe(75);
    expect(block.started).toBe('2026-04-20T14:32:00Z');
  });

  it('throws on malformed member list', () => {
    const bad = '```issue-graph\ncluster: x\nmembers: [notANumber]\n```';
    expect(() => parseOverlay(bad)).toThrow(/members/);
  });

  it('keeps the prose header above the first fence', () => {
    const overlay = parseOverlay(CLUSTER_FIXTURE);
    expect(overlay.proseHeader).toContain('# Issue graph overlay');
  });

  it('returns empty overlay for input with no fences', () => {
    const overlay = parseOverlay('just prose, nothing else');
    expect(overlay.blocks).toEqual([]);
    expect(overlay.proseHeader).toBe('just prose, nothing else');
  });
});
