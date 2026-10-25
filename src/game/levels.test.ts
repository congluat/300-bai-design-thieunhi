import { describe, it, expect } from 'vitest';
import { LEVELS, CHAPTERS, levelDesigns } from './levels';
import { simulate } from './sim';
import { COMPONENTS } from './components';

describe('generated levels', () => {
  it('has 100 levels in 10 chapters', () => {
    expect(LEVELS.length).toBe(100);
    expect(CHAPTERS.length).toBe(10);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(100);
  });

  it('hardest level reaches millions of req/s', () => {
    const last = LEVELS[LEVELS.length - 1];
    const legit = Object.entries(last.traffic).filter(([t]) => t !== 'attack').reduce((s, [, v]) => s + (v ?? 0), 0);
    expect(legit).toBeGreaterThan(1_000_000);
    expect(last.traffic.attack).toBeGreaterThanOrEqual(10_000_000);
  });

  for (const l of LEVELS) {
    it(`#${l.num} ${l.title}: reference solution gets 3 stars, naive design fails`, () => {
      const { ref, naive } = levelDesigns(l);
      expect(ref).not.toBeNull();
      for (const n of ref!.nodes) if (n.kind !== 'client') expect(l.allowed).toContain(n.kind);
      for (const n of ref!.nodes) if (!COMPONENTS[n.kind].managed) expect(n.inst).toBeLessThanOrEqual(COMPONENTS[n.kind].maxInst ?? 1);
      const r = simulate(ref!, l.traffic, l.req);
      expect(r.pass, JSON.stringify(r.issues.slice(0, 3))).toBe(true);
      expect(r.stars).toBe(3);
      if (Object.keys(CHAPTERS[l.chapter].naive).length) {
        if (naive) {
          const rn = simulate(naive, l.traffic, l.req);
          expect(rn.pass, `naive passes: cost ${rn.cost} vs ${l.req.budget}`).toBe(false);
        }
      }
    });
  }

  it('empty design fails', () => {
    const l = LEVELS[0];
    const r = simulate({ nodes: [{ id: 'c', kind: 'client', x: 0, y: 0, inst: 1 }], edges: [] }, l.traffic, l.req);
    expect(r.pass).toBe(false);
  });
});

describe('vertical scaling', () => {
  it('bigger sizes multiply capacity and cost', async () => {
    const { nodeCapacity, nodeCost } = await import('./sim');
    const base = { id: 'a', kind: 'app' as const, x: 0, y: 0, inst: 3 };
    expect(nodeCapacity({ ...base, size: 2 })).toBe(1000 * 4 * 3);
    expect(nodeCost({ ...base, size: 2 })).toBeCloseTo(40 * 4.8 * 3);
    const sql = { id: 'd', kind: 'sql' as const, x: 0, y: 0, inst: 2, size: 3 };
    expect(nodeCapacity(sql)).toBe(3000 * 8);
  });

  it('a scaled-up SQL primary absorbs load that overloads a small one', () => {
    const traffic = { read: 4000, write: 500 };
    const req = { success: 0.99, latency: {}, budget: 1e9 };
    const mk = (size: number) => ({
      nodes: [
        { id: 'c', kind: 'client' as const, x: 0, y: 0, inst: 1 },
        { id: 'lb', kind: 'lb' as const, x: 0, y: 0, inst: 1 },
        { id: 'a', kind: 'app' as const, x: 0, y: 0, inst: 7 },
        { id: 'db', kind: 'sql' as const, x: 0, y: 0, inst: 1, size },
      ],
      edges: [{ from: 'c', to: 'lb' }, { from: 'lb', to: 'a' }, { from: 'a', to: 'db' }],
    });
    expect(simulate(mk(0), traffic, req).pass).toBe(false);
    expect(simulate(mk(2), traffic, req).pass).toBe(true);
  });
});
