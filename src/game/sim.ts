import {
  COMPONENTS, HANDLES, PASSTHROUGH, LEGIT_TYPES, REQUEST_TYPES, sizeOf,
  type Kind, type ReqType,
} from './components';

/** inst = horizontal scale (instance count), size = vertical scale (index into SIZES, default 0 = S) */
export interface GNode { id: string; kind: Kind; x: number; y: number; inst: number; size?: number }
export interface GEdge { from: string; to: string }
export interface Design { nodes: GNode[]; edges: GEdge[] }
export type Traffic = Partial<Record<ReqType, number>>

export interface Mods {
  /** override cache hit rate (0..1) */
  cacheHit?: number;
  /** override CDN hit rate (0..1) */
  cdnHit?: number;
  /** peak / average traffic ratio. Everything must survive the peak, except work behind a Message Queue (it buffers the burst). */
  spike?: number;
}

export interface Requirements {
  /** minimum success ratio (0..1) for every legit request type */
  success: number;
  /** max average latency (ms) per request type */
  latency: Partial<Record<ReqType, number>>;
  /** monthly budget in $ */
  budget: number;
  /** no single point of failure allowed */
  noSPOF?: boolean;
  mods?: Mods;
  /** per-level max instance count for some components (e.g. licence / rack limits) */
  caps?: Partial<Record<Kind, number>>;
}

export interface TypeResult {
  type: ReqType; rps: number; ok: number; lat: number; latLimit?: number;
  okPass: boolean; latPass: boolean;
}
export interface NodeStat {
  id: string; load: number; capacity: number; util: number;
  byType: Partial<Record<ReqType, number>>; blocked: number;
}
export interface Issue { level: 'error' | 'warn' | 'info'; text: string; nodeId?: string }
export interface SimResult {
  types: TypeResult[];
  nodes: Record<string, NodeStat>;
  edges: Record<string, Partial<Record<ReqType, number>>>;
  cost: number; budget: number; costPass: boolean;
  spof: string[]; spofPass: boolean;
  attackTotal: number; attackBlocked: number;
  maxUtil: number;
  issues: Issue[];
  pass: boolean; stars: number;
}

interface Route {
  serve: number;
  fwd: { to: string; frac: number }[];
  w: number;     // load multiplier at this node
  lat: number;   // processing ms at this node
  async: boolean;
  degraded?: boolean;
}

export const edgeKey = (from: string, to: string) => `${from}->${to}`;

/** capacity of one instance, including vertical size */
export function instanceCapacity(n: GNode): number {
  const c = COMPONENTS[n.kind];
  return c.managed ? c.cap : c.cap * sizeOf(n.size).cap;
}

export function nodeCapacity(n: GNode): number {
  const c = COMPONENTS[n.kind];
  if (c.managed || c.haOnly) return instanceCapacity(n);
  return instanceCapacity(n) * Math.max(1, n.inst);
}

export function nodeCost(n: GNode): number {
  const c = COMPONENTS[n.kind];
  return c.managed ? c.cost : c.cost * sizeOf(n.size).cost * Math.max(1, n.inst);
}

export function designCost(d: Design): number {
  return d.nodes.reduce((s, n) => s + nodeCost(n), 0);
}

/** true if adding edge from->to would create a cycle */
export function wouldCycle(d: Design, from: string, to: string): boolean {
  if (from === to) return true;
  const out = new Map<string, string[]>();
  for (const e of d.edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of out.get(cur) ?? []) stack.push(nx);
  }
  return false;
}

class Graph {
  nodes = new Map<string, GNode>();
  out = new Map<string, string[]>();
  private acceptMemo = new Map<string, boolean>();
  private routeMemo = new Map<string, Route>();
  private mods: Mods;

  constructor(d: Design, mods: Mods = {}) {
    this.mods = mods;
    for (const n of d.nodes) { this.nodes.set(n.id, n); this.out.set(n.id, []); }
    for (const e of d.edges) {
      if (this.nodes.has(e.from) && this.nodes.has(e.to) && !this.out.get(e.from)!.includes(e.to)) this.out.get(e.from)!.push(e.to);
    }
  }

  kind(id: string): Kind { return this.nodes.get(id)!.kind; }

  accepts(id: string, t: ReqType, depth = 0): boolean {
    const key = id + '|' + t;
    const m = this.acceptMemo.get(key);
    if (m !== undefined) return m;
    if (depth > 64) return false;
    const k = this.kind(id);
    let r = false;
    if (k === 'client') r = false;
    else if (PASSTHROUGH.includes(k)) {
      if (k === 'cdn' && (t === 'static' || t === 'attack')) r = true;
      else if ((k === 'waf' || k === 'ratelimiter') && t === 'attack') r = true;
      else r = this.out.get(id)!.some((c) => this.accepts(c, t, depth + 1));
    } else r = (HANDLES[k] ?? []).includes(t);
    this.acceptMemo.set(key, r);
    return r;
  }

  /** first preferred group of children that accepts type t */
  private pick(id: string, t: ReqType, groups: (Kind[] | '*')[], exclude: Kind[] = []): string[] {
    const acc = this.out.get(id)!.filter((c) => this.accepts(c, t) && !exclude.includes(this.kind(c)));
    for (const g of groups) {
      const s = acc.filter((c) => g === '*' || g.includes(this.kind(c)));
      if (s.length) return s;
    }
    return [];
  }

  /** weighted round-robin weight of a node */
  private weight(id: string): number {
    const n = this.nodes.get(id)!;
    const c = COMPONENTS[n.kind];
    if (c.managed) return 1;
    return (c.haOnly ? 1 : Math.max(1, n.inst)) * sizeOf(n.size).cap;
  }

  route(id: string, t: ReqType): Route {
    const key = id + '|' + t;
    const m = this.routeMemo.get(key);
    if (m) return m;
    const k = this.kind(id);
    const C = COMPONENTS[k];
    const r: Route = { serve: 0, fwd: [], w: 1, lat: C.lat, async: false };
    const split = (arr: string[], frac = 1) => {
      const tw = arr.reduce((s, c) => s + this.weight(c), 0);
      r.fwd = arr.map((to) => ({ to, frac: (frac * this.weight(to)) / tw }));
    };

    switch (k) {
      case 'client': {
        const nonEdge: (Kind[] | '*')[] = [['waf', 'ratelimiter', 'lb', 'app', 'cache', 'sql', 'replica', 'nosql', 'queue', 'worker', 'objstore', 'search'], ['cdn']];
        split(this.pick(id, t, t === 'static' ? [['cdn'], '*'] : nonEdge));
        break;
      }
      case 'cdn': {
        const hit = this.mods.cdnHit ?? C.hit!;
        if (t === 'static') { r.serve = hit; split(this.pick(id, t, ['*']), 1 - hit); }
        else if (t === 'attack') { r.serve = C.absorb!; split(this.pick(id, t, ['*']), 1 - C.absorb!); }
        else split(this.pick(id, t, ['*']));
        break;
      }
      case 'waf':
      case 'ratelimiter': {
        if (t === 'attack') { r.serve = C.block!; split(this.pick(id, t, ['*']), 1 - C.block!); }
        else split(this.pick(id, t, ['*']));
        break;
      }
      case 'lb':
        split(this.pick(id, t, ['*']));
        break;
      case 'app': {
        if (t === 'read') split(this.pick(id, t, [['cache'], ['sql', 'replica', 'nosql'], '*']));
        else if (t === 'write') split(this.pick(id, t, [['queue'], ['sql', 'nosql'], '*']));
        else if (t === 'static') {
          const s = this.pick(id, t, [['objstore'], '*']);
          if (s.length) split(s); else r.serve = 1;
        } else if (t === 'upload') { r.w = 5; split(this.pick(id, t, [['objstore'], '*'])); }
        else if (t === 'search') split(this.pick(id, t, [['search'], ['sql', 'replica', 'nosql'], '*']));
        else if (t === 'attack') r.serve = 1;
        break;
      }
      case 'cache': {
        const hit = this.mods.cacheHit ?? C.hit!;
        r.serve = hit;
        split(this.pick(id, t, [['sql', 'replica', 'nosql'], '*'], ['cache']), 1 - hit);
        break;
      }
      case 'sql':
      case 'replica':
      case 'nosql': {
        r.serve = 1;
        if (t === 'write' && k === 'sql') r.w = 2;
        if (t === 'search') { r.w = 10; r.lat += 200; r.degraded = true; }
        break;
      }
      case 'queue': {
        r.async = true;
        split(this.pick(id, t, [['worker'], '*']));
        break;
      }
      case 'worker':
        split(this.pick(id, t, [['sql', 'nosql'], '*']));
        break;
      case 'objstore':
      case 'search':
        r.serve = 1;
        break;
    }
    this.routeMemo.set(key, r);
    return r;
  }
}

const NOROUTE_HINT: Partial<Record<Kind, Partial<Record<ReqType, string>>>> = {
  client: {
    read: 'Users are not connected to anything that can serve reads.',
    write: 'Users are not connected to anything that can handle writes.',
    static: 'No path for static files (needs CDN / App / Object Storage).',
    upload: 'No path for uploads.',
    search: 'No path for search requests.',
  },
  cache: { read: 'Cache misses have no database behind them. Connect Cache ➜ Database.' },
  cdn: { static: 'CDN misses have no origin (Object Storage / App) behind them.' },
  app: {
    read: 'App Server has nowhere to read data from (Cache / Database).',
    write: 'App Server has nowhere to write data (Database / Queue).',
    upload: 'Uploads need Object Storage behind the App Server.',
    search: 'App Server has no Search Engine or Database to search.',
  },
  queue: { write: 'Queue has no Worker consuming its jobs.' },
  worker: { write: 'Worker has no Database to write to.' },
};

export function simulate(d: Design, traffic: Traffic, req: Requirements): SimResult {
  const g = new Graph(d, req.mods);
  const client = d.nodes.find((n) => n.kind === 'client');
  const nodes: Record<string, NodeStat> = {};
  const issues: Issue[] = [];
  for (const n of d.nodes) nodes[n.id] = { id: n.id, load: 0, capacity: nodeCapacity(n), util: 0, byType: {}, blocked: 0 };
  // Several App Servers without a Load Balancer in front -> only one instance actually gets traffic
  for (const n of d.nodes) {
    if (n.kind !== 'app' || n.inst < 2) continue;
    const parents = d.edges.filter((e) => e.to === n.id && g.nodes.has(e.from)).map((e) => g.kind(e.from));
    if (parents.some((k) => k !== 'lb' && k !== 'ratelimiter')) {
      nodes[n.id].capacity = instanceCapacity(n);
      issues.push({ level: 'warn', nodeId: n.id, text: `App Server has ${n.inst} instances but is not behind a Load Balancer → only 1 instance receives traffic.` });
    }
  }
  const edges: SimResult['edges'] = {};
  const lost = new Map<string, number>(); // id|type -> rps
  const degraded = new Set<string>();

  // Pass 1: propagate traffic to compute each node's load
  const spike = Math.max(1, req.mods?.spike ?? 1);
  // amt = peak-rate traffic arriving at this node (average × spike, until a queue flattens it)
  const propagate = (id: string, t: ReqType, amt: number, depth: number, peak: number) => {
    if (amt < 1e-6 || depth > 64) return;
    const r = g.route(id, t);
    const st = nodes[id];
    st.load += amt * r.w;
    st.byType[t] = (st.byType[t] ?? 0) + amt;
    const nextPeak = g.kind(id) === 'queue' ? 1 : peak;
    if (t === 'attack' && r.serve > 0 && g.kind(id) !== 'app') st.blocked += amt * r.serve;
    if (r.degraded) degraded.add(id);
    const handled = r.serve + r.fwd.reduce((s, f) => s + f.frac, 0);
    if (handled < 1 - 1e-9) {
      const k = id + '|' + t;
      lost.set(k, (lost.get(k) ?? 0) + amt * (1 - handled));
    }
    for (const f of r.fwd) {
      const ek = edgeKey(id, f.to);
      const e = (edges[ek] ??= {});
      e[t] = (e[t] ?? 0) + (amt * f.frac * nextPeak) / peak;
      propagate(f.to, t, (amt * f.frac * nextPeak) / peak, depth + 1, nextPeak);
    }
  };
  if (client) for (const [t, rps] of Object.entries(traffic) as [ReqType, number][]) if (rps > 0) propagate(client.id, t, rps * spike, 0, spike);

  let maxUtil = 0;
  for (const st of Object.values(nodes)) {
    st.util = st.capacity === Infinity ? 0 : st.load / st.capacity;
    maxUtil = Math.max(maxUtil, st.util);
  }

  // Pass 2: success ratio and latency for one unit of traffic entering a node
  const memo = new Map<string, { ok: number; lat: number }>();
  const evalNode = (id: string, t: ReqType, depth: number): { ok: number; lat: number } => {
    const key = id + '|' + t;
    const m = memo.get(key);
    if (m) return m;
    if (depth > 64) return { ok: 0, lat: 0 };
    const r = g.route(id, t);
    const u = nodes[id].util;
    const s = u > 1 ? 1 / u : 1;
    const latF = u <= 0.7 ? 1 : 1 + 3 * Math.min(1, (u - 0.7) / 0.3);
    const L = r.lat * latF;
    let okKids = 0, latKids = 0;
    for (const f of r.fwd) {
      const e = evalNode(f.to, t, depth + 1);
      okKids += f.frac * e.ok;
      latKids += f.frac * e.ok * e.lat;
    }
    const okLocal = r.serve + okKids;
    const res = {
      ok: s * okLocal,
      lat: L + (r.async || okLocal === 0 ? 0 : latKids / okLocal),
    };
    memo.set(key, res);
    return res;
  };

  const types: TypeResult[] = [];
  for (const t of LEGIT_TYPES) {
    const rps = traffic[t] ?? 0;
    if (!rps) continue;
    const e = client ? evalNode(client.id, t, 0) : { ok: 0, lat: 0 };
    const latLimit = req.latency[t];
    const okPass = e.ok >= req.success - 1e-9;
    const latPass = latLimit === undefined || (e.ok > 0 && e.lat <= latLimit + 1e-9);
    types.push({ type: t, rps, ok: e.ok, lat: e.lat, latLimit, okPass, latPass });
  }

  for (const [k, amt] of lost) {
    const [id, t] = k.split('|') as [string, ReqType];
    if (t === 'attack') continue;
    const kind = g.kind(id);
    const hint = NOROUTE_HINT[kind]?.[t] ??
      `${COMPONENTS[kind].name} cannot forward "${REQUEST_TYPES[t].short}" requests — missing a suitable connection.`;
    issues.push({ level: 'error', text: `${hint} (${fmt(amt)} req/s dropped)`, nodeId: id });
  }
  for (const st of Object.values(nodes)) {
    const n = g.nodes.get(st.id)!;
    const name = COMPONENTS[n.kind].name;
    if (st.util > 1) {
      issues.push({ level: 'error', nodeId: st.id, text: `${name} is overloaded at ${Math.round(st.util * 100)}% — ~${Math.round((1 - 1 / st.util) * 100)}% of requests through it fail.` });
    } else if (st.util > 0.7) {
      issues.push({ level: 'warn', nodeId: st.id, text: `${name} is running at ${Math.round(st.util * 100)}% — latency climbs fast above 70%.` });
    }
    if (st.load === 0 && n.kind !== 'client') {
      issues.push({ level: 'info', nodeId: st.id, text: `${name} receives no traffic (wasted money?).` });
    }
  }
  for (const id of degraded) {
    issues.push({ level: 'warn', nodeId: id, text: `Search is running directly on ${COMPONENTS[g.kind(id)].name} — slow and heavy. Consider a Search Engine.` });
  }

  const spof: string[] = [];
  for (const st of Object.values(nodes)) {
    const n = g.nodes.get(st.id)!;
    const c = COMPONENTS[n.kind];
    const legit = LEGIT_TYPES.some((t) => (st.byType[t] ?? 0) > 0);
    if (req.noSPOF && legit && !c.managed && n.inst < 2) spof.push(st.id);
  }
  const spofPass = !req.noSPOF || spof.length === 0;
  for (const id of spof) issues.push({ level: 'error', nodeId: id, text: `${COMPONENTS[g.kind(id)].name} has a single instance → single point of failure.` });

  let capPass = true;
  for (const n of d.nodes) {
    const cap = req.caps?.[n.kind];
    if (cap !== undefined && n.inst > cap) {
      capPass = false;
      issues.push({ level: 'error', nodeId: n.id, text: `${COMPONENTS[n.kind].name}: this level allows at most ${cap} instance${cap > 1 ? 's' : ''} — scale up with a bigger size instead.` });
    }
  }

  const cost = designCost(d);
  const costPass = cost <= req.budget;
  if (!costPass) issues.push({ level: 'error', text: `Over budget: $${fmt(cost)} / $${fmt(req.budget)} per month.` });

  for (const tr of types) {
    if (!tr.latPass && tr.ok > 0) issues.push({ level: 'error', text: `"${REQUEST_TYPES[tr.type].short}" averages ${Math.round(tr.lat)}ms, above the ${tr.latLimit}ms target.` });
  }

  const attackTotal = traffic.attack ?? 0;
  const attackBlocked = Object.values(nodes).reduce((s, n) => s + n.blocked, 0);

  const pass = types.length > 0 && types.every((x) => x.okPass && x.latPass) && costPass && spofPass && capPass && !!client;
  let stars = 0;
  if (pass) {
    stars = 1;
    if (cost <= req.budget * 0.8) stars++;
    if (maxUtil <= 0.7 + 1e-9) stars++;
  }

  const order = { error: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return { types, nodes, edges, cost, budget: req.budget, costPass, spof, spofPass, attackTotal, attackBlocked, maxUtil, issues, pass, stars };
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n >= 100) return Math.round(n).toLocaleString('en-US');
  return (Math.round(n * 10) / 10).toLocaleString('en-US');
}

/** compact: 1.2M, 350k */
export function fmtShort(n: number): string {
  if (n >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('en-US') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3).toLocaleString('en-US') + 'k';
  if (n >= 1e3) return (Math.round(n / 100) / 10).toLocaleString('en-US') + 'k';
  return fmt(n);
}
