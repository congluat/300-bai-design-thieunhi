// Reference-solution builder used to calibrate every level (budget & latency targets),
// so every level is guaranteed to be solvable.
import { COMPONENTS, SIZES, type Kind, type ReqType } from './components';
import { designCost, simulate, type Design, type GNode, type Mods, type Requirements, type Traffic } from './sim';

export interface RefFlags {
  cdn: boolean; waf: boolean; rl: boolean; lb: boolean; cache: boolean; queue: boolean; search: boolean; s3: boolean;
  db: 'sql' | 'nosql'; replicas: number;
}

export interface RefPlan {
  allowed: Kind[];
  noSPOF: boolean;
  caps?: Partial<Record<Kind, number>>;
  mods?: Mods;
  /** force-disable some "best practice" flags (used by tests to build naive designs) */
  disable?: Partial<Record<'cdn' | 'waf' | 'rl' | 'cache' | 'queue' | 'search', boolean>>;
}

export const TARGET_UTIL = 0.65;

export function buildRef(traffic: Traffic, f: RefFlags): Design {
  const nodes: GNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const add = (id: string, kind: Kind, inst = 1) => { if (!nodes.some((n) => n.id === id)) nodes.push({ id, kind, x: 0, y: 0, inst }); };
  const link = (...ids: string[]) => {
    for (let i = 0; i < ids.length - 1; i++) {
      if (!edges.some((e) => e.from === ids[i] && e.to === ids[i + 1])) edges.push({ from: ids[i], to: ids[i + 1] });
    }
  };
  const has = (t: ReqType) => (traffic[t] ?? 0) > 0;

  add('client', 'client');
  if (f.s3) add('s3', 'objstore');

  const chain: string[] = ['client'];
  if (f.waf) { add('waf', 'waf'); chain.push('waf'); }
  if (f.rl) { add('rl', 'ratelimiter'); chain.push('rl'); }
  if (f.lb) { add('lb', 'lb'); chain.push('lb'); }
  add('app', 'app');
  chain.push('app');
  link(...chain);

  if (has('static') && f.cdn) {
    add('cdn', 'cdn');
    link('client', 'cdn', f.s3 ? 's3' : f.lb ? 'lb' : 'app');
  }

  add('db', f.db);
  const readers = ['db'];
  if (f.db === 'sql' && f.replicas > 0) { add('rr', 'replica', f.replicas); readers.push('rr'); }

  if (has('read')) {
    if (f.cache) { add('cache', 'cache'); link('app', 'cache'); for (const r of readers) link('cache', r); }
    else for (const r of readers) link('app', r);
  }
  if (has('write')) {
    if (f.queue) { add('q', 'queue'); add('w', 'worker'); link('app', 'q', 'w', 'db'); }
    else link('app', 'db');
  }
  if (has('search')) {
    if (f.search) { add('se', 'search'); link('app', 'se'); } else for (const r of readers) link('app', r);
  }
  if (f.s3 && (has('upload') || (has('static') && !f.cdn))) link('app', 's3');
  return { nodes, edges };
}

const LOOSE = (plan: RefPlan): Requirements => ({ success: 0, latency: {}, budget: Infinity, mods: plan.mods });

function limitOf(kind: Kind, plan: RefPlan): number {
  const c = COMPONENTS[kind];
  return Math.min(c.maxInst ?? 1, plan.caps?.[kind] ?? Infinity);
}

/**
 * Scale every node so it sits at ≤ TARGET_UTIL, choosing the cheapest (size, instances) combo
 * within the level's instance caps. horizontalOnly keeps each node's current size.
 * Returns null if impossible.
 */
export function sizeDesign(d: Design, traffic: Traffic, plan: RefPlan, opts: { horizontalOnly?: boolean } = {}): Design | null {
  const minInst = plan.noSPOF ? 2 : 1;
  const hasLB = d.nodes.some((n) => n.kind === 'lb');
  const floor = new Map(d.nodes.map((n) => [n.id, n.kind === 'replica' ? n.inst : 1]));
  let cur: Design = { ...d, nodes: d.nodes.map((n) => ({ ...n })) };
  for (let iter = 0; iter < 8; iter++) {
    const r = simulate(cur, traffic, LOOSE(plan));
    let changed = false;
    const nodes = cur.nodes.map((n) => {
      const c = COMPONENTS[n.kind];
      if (c.managed) return n;
      const load = r.nodes[n.id].load;
      const limit = n.kind === 'app' && !hasLB ? 1 : limitOf(n.kind, plan);
      const sizes = opts.horizontalOnly ? [n.size ?? 0] : SIZES.map((_, i) => i);
      let best: { size: number; inst: number; cost: number } | null = null;
      for (const s of sizes) {
        const per = c.cap * SIZES[s].cap;
        let inst: number;
        if (c.haOnly) {
          if (load > per * TARGET_UTIL) continue;
          inst = minInst;
        } else {
          inst = Math.max(minInst, floor.get(n.id) ?? 1, Math.ceil(load / (per * TARGET_UTIL) - 1e-9));
        }
        if (inst > limit) continue;
        const cost = c.cost * SIZES[s].cost * inst;
        if (!best || cost < best.cost - 1e-9) best = { size: s, inst, cost };
      }
      if (!best) return { ...n, inst: Infinity };
      const grow = best.inst > n.inst || (n.size ?? 0) !== best.size;
      if (!grow) return n;
      // only ever grow capacity to guarantee convergence
      const curCap = c.cap * SIZES[n.size ?? 0].cap * (c.haOnly ? 1 : n.inst);
      const newCap = c.cap * SIZES[best.size].cap * (c.haOnly ? 1 : best.inst);
      if (newCap < curCap - 1e-9 && iter > 0) return n;
      changed = true;
      return { ...n, inst: best.inst, size: best.size || undefined };
    });
    if (nodes.some((n) => !isFinite(n.inst))) return null;
    cur = { ...cur, nodes };
    if (!changed) break;
  }
  const r = simulate(cur, traffic, LOOSE(plan));
  for (const n of cur.nodes) {
    const c = COMPONENTS[n.kind];
    if (c.managed) continue;
    if (n.inst > limitOf(n.kind, plan)) return null;
    if (plan.noSPOF && n.inst < 2) return null;
    if (r.nodes[n.id].util > TARGET_UTIL + 1e-6) return null;
  }
  if (!r.types.every((t) => t.ok > 0.9999)) return null;
  return cur;
}

/** Build + size the cheapest sensible reference design within the level's rules. */
export function referenceDesign(traffic: Traffic, plan: RefPlan): Design | null {
  const A = (k: Kind) => plan.allowed.includes(k);
  const has = (t: ReqType) => (traffic[t] ?? 0) > 0;
  const off = plan.disable ?? {};
  const base: RefFlags = {
    cdn: A('cdn') && has('static') && !off.cdn,
    waf: A('waf') && has('attack') && !off.waf,
    rl: A('ratelimiter') && has('attack') && !off.rl,
    lb: A('lb'),
    cache: A('cache') && has('read') && !off.cache,
    queue: A('queue') && A('worker') && has('write') && !off.queue,
    search: A('search') && has('search') && !off.search,
    s3: A('objstore') && (has('static') || has('upload')),
    db: A('sql') ? 'sql' : 'nosql',
    replicas: 0,
  };
  if (has('upload') && !base.s3) return null;
  const candidates: Design[] = [];
  const tryFlags = (f: RefFlags) => {
    const d = sizeDesign(buildRef(traffic, f), traffic, plan);
    if (d) candidates.push(d);
  };

  if (A('sql')) {
    tryFlags(base);
    if (A('replica') && (has('read') || (has('search') && !base.search))) {
      const probe = simulate(buildRef(traffic, base), traffic, LOOSE(plan));
      const db = probe.nodes['db'];
      const readish = (db?.byType.read ?? 0) + (db?.byType.search ?? 0) * 10;
      const other = (db?.load ?? 0) - readish;
      for (const s of [0, 1, 2]) {
        const room = COMPONENTS.sql.cap * SIZES[s].cap * TARGET_UTIL - other;
        if (room <= 0 || readish <= 0) continue;
        const k0 = Math.max(1, Math.ceil(readish / room) - 1);
        for (let k = k0; k <= Math.min(limitOf('replica', plan), k0 + 2); k++) tryFlags({ ...base, replicas: k });
      }
    }
  }
  if (A('nosql')) tryFlags({ ...base, db: 'nosql' });
  if (!candidates.length) return null;
  candidates.sort((a, b) => designCost(a) - designCost(b));
  return candidates[0];
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;

export function niceBudget(cost: number, slack = 1.3): number {
  const v = cost * slack;
  if (v < 1000) return ceilTo(v, 10);
  if (v < 10000) return ceilTo(v, 50);
  if (v < 100000) return ceilTo(v, 500);
  return ceilTo(v, 5000);
}

export function deriveRequirements(
  ref: Design, traffic: Traffic,
  opts: { success: number; noSPOF: boolean; strict: ReqType[]; mods?: Mods; caps?: Partial<Record<Kind, number>>; slack?: number },
): Requirements {
  const r = simulate(ref, traffic, { success: 0, latency: {}, budget: Infinity, mods: opts.mods });
  const latency: Partial<Record<ReqType, number>> = {};
  for (const t of r.types) {
    latency[t.type] = opts.strict.includes(t.type) ? ceilTo(t.lat + 6, 5) : ceilTo(t.lat * 1.5, 10);
  }
  return {
    success: opts.success, latency, budget: niceBudget(designCost(ref), opts.slack),
    noSPOF: opts.noSPOF || undefined, mods: opts.mods, caps: opts.caps,
  };
}

export function refSummary(ref: Design): string {
  const parts = ref.nodes
    .filter((n) => !COMPONENTS[n.kind].managed)
    .map((n) => `${COMPONENTS[n.kind].name} ${SIZES[n.size ?? 0].name}×${n.inst}`);
  return `A reference design uses: ${parts.join(', ')} — about $${Math.round(designCost(ref)).toLocaleString('en-US')}/month.`;
}
