import { describe, it, expect } from 'vitest';
import { LEVELS, CHAPTERS, levelReference, levelPlan, type Level } from './levels';
import { simulate, type Design } from './sim';
import { COMPONENTS } from './components';
import { sizeDesign } from './generate';

/** Re-use a design's topology & machine sizes, only re-scaling instance counts for another level. */
export function carryOver(prev: Design, l: Level): { pass: boolean; why: string } {
  for (const n of prev.nodes) if (n.kind !== 'client' && !l.allowed.includes(n.kind)) return { pass: false, why: `${n.kind} banned` };
  const d = sizeDesign(prev, l.traffic, levelPlan(l), { horizontalOnly: true });
  if (!d) return { pass: false, why: 'cannot scale out within limits' };
  const r = simulate(d, l.traffic, l.req);
  return { pass: r.pass, why: r.pass ? 'PASSES' : r.issues.filter((i) => i.level === 'error')[0]?.text ?? '?' };
}

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
    it(`#${l.num} ${l.title}: reference solution gets 3 stars`, () => {
      const ref = levelReference(l);
      expect(ref).not.toBeNull();
      for (const n of ref!.nodes) if (n.kind !== 'client') expect(l.allowed).toContain(n.kind);
      for (const n of ref!.nodes) if (!COMPONENTS[n.kind].managed) expect(n.inst).toBeLessThanOrEqual(COMPONENTS[n.kind].maxInst ?? 1);
      const r = simulate(ref!, l.traffic, l.req);
      expect(r.pass, JSON.stringify(r.issues.slice(0, 3))).toBe(true);
      expect(r.stars).toBe(3);
    });
  }

  it('levels differ: the previous level\'s design, only scaled out, fails most next levels', () => {
    const report: string[] = [];
    let carried = 0, total = 0;
    for (let i = 1; i < LEVELS.length; i++) {
      const prev = LEVELS[i - 1], cur = LEVELS[i];
      if (prev.chapter !== cur.chapter) continue;
      total++;
      const res = carryOver(levelReference(prev)!, cur);
      if (res.pass) carried++;
      report.push(`#${cur.num} ${cur.title}: ${res.pass ? 'SAME DESIGN WORKS' : 'needs change (' + res.why.slice(0, 60) + ')'}`);
    }
    console.log(report.join('\n'));
    console.log(`carried over: ${carried}/${total}`);
    expect(carried / total).toBeLessThanOrEqual(0.05);
  });

  it('empty design fails', () => {
    const l = LEVELS[0];
    const r = simulate({ nodes: [{ id: 'c', kind: 'client', x: 0, y: 0, inst: 1 }], edges: [] }, l.traffic, l.req);
    expect(r.pass).toBe(false);
  });
});

describe('vertical scaling & spikes', () => {
  it('bigger sizes multiply capacity and cost', async () => {
    const { nodeCapacity, nodeCost } = await import('./sim');
    const base = { id: 'a', kind: 'app' as const, x: 0, y: 0, inst: 3 };
    expect(nodeCapacity({ ...base, size: 2 })).toBe(1000 * 4 * 3);
    expect(nodeCost({ ...base, size: 2 })).toBeCloseTo(40 * 4.8 * 3);
    expect(nodeCapacity({ id: 'd', kind: 'sql' as const, x: 0, y: 0, inst: 2, size: 3 })).toBe(3000 * 8);
  });

  it('a queue absorbs a write spike; a direct DB write path does not', () => {
    const traffic = { write: 1000 };
    const req = { success: 0.99, latency: {}, budget: 1e9, mods: { spike: 4 } };
    const n = (id: string, kind: any, inst = 1) => ({ id, kind, x: 0, y: 0, inst });
    const direct = { nodes: [n('c', 'client'), n('lb', 'lb'), n('a', 'app', 8), n('db', 'sql')], edges: [{ from: 'c', to: 'lb' }, { from: 'lb', to: 'a' }, { from: 'a', to: 'db' }] };
    const queued = { nodes: [n('c', 'client'), n('lb', 'lb'), n('a', 'app', 8), n('q', 'queue'), n('w', 'worker', 3), n('db', 'sql')], edges: [{ from: 'c', to: 'lb' }, { from: 'lb', to: 'a' }, { from: 'a', to: 'q' }, { from: 'q', to: 'w' }, { from: 'w', to: 'db' }] };
    expect(simulate(direct, traffic, req).pass).toBe(false);
    expect(simulate(queued, traffic, req).pass).toBe(true);
  });
});
