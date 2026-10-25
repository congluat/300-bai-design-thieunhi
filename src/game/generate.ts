// Reference-solution builder used to derive budgets & latency targets for every level,
// so every generated level is guaranteed to be solvable.
import { COMPONENTS, LEGIT_TYPES, type Kind, type ReqType } from './components';
import { designCost, simulate, type Design, type GNode, type Mods, type Requirements, type Traffic } from './sim';

export interface RefFlags {
  cdn: boolean; waf: boolean; rl: boolean; lb: boolean; cache: boolean; queue: boolean; search: boolean;
  db: 'sql' | 'nosql'; replicas: number; minInst: number;
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
  if (has('static') || has('upload')) add('s3', 'objstore');
  if (has('static') && f.cdn) { add('cdn', 'cdn'); link('client', 'cdn', 's3'); }

  const chain: string[] = ['client'];
  if (f.waf) { add('waf', 'waf'); chain.push('waf'); }
  if (f.rl) { add('rl', 'ratelimiter'); chain.push('rl'); }
  if (f.lb) { add('lb', 'lb'); chain.push('lb'); }
  add('app', 'app');
  chain.push('app');
  link(...chain);

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
    if (f.search) { add('se', 'search'); link('app', 'se'); } else link('app', 'db');
  }
  if (has('upload') || (has('static') && !f.cdn)) link('app', 's3');
  return { nodes, edges };
}

const LOOSE = (mods?: Mods): Requirements => ({ success: 0, latency: {}, budget: Infinity, mods });

/** Scale instance counts so every node sits at ≤ TARGET_UTIL. Returns null if impossible. */
export function sizeRef(d: Design, traffic: Traffic, f: RefFlags, mods?: Mods): Design | null {
  const min = new Map<string, number>();
  for (const n of d.nodes) min.set(n.id, n.kind === 'replica' ? Math.max(f.minInst, n.inst) : f.minInst);
  let cur = d;
  for (let iter = 0; iter < 6; iter++) {
    const r = simulate(cur, traffic, LOOSE(mods));
    let changed = false;
    const nodes = cur.nodes.map((n) => {
      const c = COMPONENTS[n.kind];
      if (c.managed) return n;
      if (c.haOnly) {
        const inst = f.minInst >= 2 ? 2 : 1;
        if (inst !== n.inst) changed = true;
        return { ...n, inst };
      }
      const need = Math.max(min.get(n.id) ?? 1, Math.ceil(r.nodes[n.id].load / (c.cap * TARGET_UTIL) - 1e-9));
      if (need > n.inst) { changed = true; return { ...n, inst: need }; }
      return n;
    });
    cur = { ...cur, nodes };
    if (!changed) break;
  }
  const r = simulate(cur, traffic, LOOSE(mods));
  for (const n of cur.nodes) {
    const c = COMPONENTS[n.kind];
    if (!c.managed && n.inst > (c.maxInst ?? 1)) return null;
    if (r.nodes[n.id].util > TARGET_UTIL + 1e-6) return null;
    if (n.kind === 'app' && n.inst > 1 && !f.lb) return null;
  }
  if (!r.types.every((t) => t.ok > 0.9999)) return null;
  return cur;
}

export interface RefPlan { allowed: Kind[]; noSPOF: boolean; disable?: Partial<Record<keyof RefFlags, boolean>> }

/** Build + size the cheapest sensible reference design within the allowed components. */
export function referenceDesign(traffic: Traffic, plan: RefPlan, mods?: Mods): Design | null {
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
    db: 'sql',
    replicas: 0,
    minInst: plan.noSPOF && !off.minInst ? 2 : 1,
  };
  const tryFlags = (f: RefFlags) => sizeRef(buildRef(traffic, f), traffic, f, mods);

  // 1) plain SQL
  let d = tryFlags(base);
  if (d) return d;
  // 2) SQL + read replicas
  if (A('replica')) {
    const probe = simulate(buildRef(traffic, base), traffic, LOOSE(mods));
    const db = probe.nodes['db'];
    const reads = db?.byType.read ?? 0;
    const other = (db?.load ?? 0) - reads;
    const room = COMPONENTS.sql.cap * TARGET_UTIL - other;
    if (room > 0 && reads > 0) {
      const k0 = Math.max(1, Math.ceil(reads / room) - 1);
      for (let k = k0; k <= Math.min(COMPONENTS.replica.maxInst!, k0 + 4); k++) {
        d = tryFlags({ ...base, replicas: k });
        if (d) return d;
      }
    }
  }
  // 3) sharded NoSQL
  if (A('nosql')) {
    d = tryFlags({ ...base, db: 'nosql' });
    if (d) return d;
  }
  return null;
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;

export function niceBudget(cost: number): number {
  const v = cost * 1.3;
  if (v < 1000) return ceilTo(v, 10);
  if (v < 10000) return ceilTo(v, 50);
  if (v < 100000) return ceilTo(v, 500);
  return ceilTo(v, 5000);
}

export function deriveRequirements(
  ref: Design, traffic: Traffic, opts: { success: number; noSPOF: boolean; strict: ReqType[]; mods?: Mods },
): Requirements {
  const r = simulate(ref, traffic, LOOSE(opts.mods));
  const latency: Partial<Record<ReqType, number>> = {};
  for (const t of r.types) {
    latency[t.type] = opts.strict.includes(t.type) ? ceilTo(t.lat + 6, 5) : ceilTo(t.lat * 1.5, 10);
  }
  return { success: opts.success, latency, budget: niceBudget(designCost(ref)), noSPOF: opts.noSPOF || undefined, mods: opts.mods };
}

export function refSummary(ref: Design): string {
  const app = ref.nodes.find((n) => n.kind === 'app');
  return `A reference design uses ~${app?.inst ?? 1} App Server instance${(app?.inst ?? 1) > 1 ? 's' : ''} and costs ~$${Math.round(designCost(ref)).toLocaleString('en-US')}/month.`;
}

export { LEGIT_TYPES };
