// Component & request type definitions.
// cap  = max load per instance (req/s equivalent; some request types are heavier)
// lat  = processing latency (ms)
// cost = $/month per instance
// managed = managed service (auto-scaling, built-in HA) -> no instance count, never a SPOF

export type ReqType = 'read' | 'write' | 'static' | 'upload' | 'search' | 'attack';

export type Kind =
  | 'client' | 'cdn' | 'waf' | 'ratelimiter' | 'lb' | 'app' | 'cache'
  | 'sql' | 'replica' | 'nosql' | 'queue' | 'worker' | 'objstore' | 'search';

export interface ReqTypeDef { label: string; short: string; color: string }

export const REQUEST_TYPES: Record<ReqType, ReqTypeDef> = {
  read: { label: 'Read data', short: 'Read', color: '#2f6fd6' },
  write: { label: 'Write data', short: 'Write', color: '#d6452f' },
  static: { label: 'Static files (images, JS, CSS, video)', short: 'Static', color: '#d99a00' },
  upload: { label: 'File / video upload', short: 'Upload', color: '#8a3fd1' },
  search: { label: 'Full-text search', short: 'Search', color: '#1a9b6c' },
  attack: { label: 'DDoS (botnet traffic)', short: 'DDoS', color: '#222222' },
};

export const LEGIT_TYPES: ReqType[] = ['read', 'write', 'static', 'upload', 'search'];

export type Shape = 'person' | 'cloud' | 'shield' | 'hex' | 'diamond' | 'rect' | 'cylinder' | 'queue' | 'gear' | 'bucket';

export interface ComponentDef {
  name: string;
  icon: string;
  shape: Shape;
  cap: number;
  lat: number;
  cost: number;
  desc: string;
  managed?: boolean;
  fixed?: boolean;
  haOnly?: boolean;
  maxInst?: number;
  hit?: number;
  absorb?: number;
  block?: number;
}

export const COMPONENTS: Record<Kind, ComponentDef> = {
  client: {
    name: 'Users', icon: '👥', shape: 'person', cap: Infinity, lat: 20, cost: 0, fixed: true, managed: true,
    desc: 'Where requests come from (includes ~20ms of internet round-trip). Cannot be removed.',
  },
  cdn: {
    name: 'CDN', icon: '☁️', shape: 'cloud', cap: 20_000_000, lat: 5, cost: 50, managed: true, hit: 0.95, absorb: 0.3,
    desc: 'Caches static files at the edge, close to users (95% hit rate). Misses are fetched from the origin behind it (Object Storage or App). Absorbs ~30% of DDoS traffic. Dynamic requests are passed through.',
  },
  waf: {
    name: 'WAF / Anti-DDoS', icon: '🛡️', shape: 'shield', cap: 50_000_000, lat: 2, cost: 150, managed: true, block: 0.95,
    desc: 'Managed web application firewall. Blocks 95% of attack traffic and lets legitimate requests through.',
  },
  ratelimiter: {
    name: 'Rate Limiter', icon: '🚦', shape: 'hex', cap: 25000, lat: 1, cost: 30, block: 0.8, maxInst: 500,
    desc: 'Throttles requests per IP / token. Blocks ~80% of attack traffic. Has its own throughput limit (25k req/s per instance).',
  },
  lb: {
    name: 'Load Balancer', icon: '⚖️', shape: 'diamond', cap: 20000, lat: 1, cost: 25, maxInst: 500,
    desc: 'Spreads requests across the nodes behind it (weighted by instance count). 20k req/s per instance.',
  },
  app: {
    name: 'App Server', icon: '🖥️', shape: 'rect', cap: 1000, lat: 20, cost: 40, maxInst: 5000,
    desc: 'Runs business logic. Reads: Cache first, then DB. Writes: Queue first, then DB. Search: Search Engine first (falls back to a very slow DB query). Uploads need Object Storage and cost 5× a normal request.',
  },
  cache: {
    name: 'Cache (Redis)', icon: '⚡', shape: 'rect', cap: 40000, lat: 1, cost: 60, hit: 0.85, maxInst: 200,
    desc: 'Keeps hot data in RAM (85% hit rate by default). On a miss it asks the database behind it → connect Cache ➜ Database.',
  },
  sql: {
    name: 'SQL Database', icon: '🗄️', shape: 'cylinder', cap: 3000, lat: 15, cost: 150, maxInst: 2, haOnly: true,
    desc: 'Primary relational DB. Writes cost 2× a read; full-text search costs 10× and adds 200ms. A 2nd instance is a hot standby for HA (no extra throughput).',
  },
  replica: {
    name: 'Read Replica', icon: '📚', shape: 'cylinder', cap: 3000, lat: 15, cost: 100, maxInst: 30,
    desc: 'Read-only copy of the SQL DB that shares read load with the primary. Does not accept writes.',
  },
  nosql: {
    name: 'NoSQL (sharded)', icon: '🧱', shape: 'cylinder', cap: 6000, lat: 12, cost: 180, maxInst: 500,
    desc: 'Horizontally sharded database: each shard adds 6k req/s for both reads and writes.',
  },
  queue: {
    name: 'Message Queue', icon: '📨', shape: 'queue', cap: 20000, lat: 3, cost: 50, maxInst: 200,
    desc: 'Accepts writes and acknowledges immediately (async). Workers behind it process jobs and write to the DB. If workers can\'t keep up → backlog → lost requests.',
  },
  worker: {
    name: 'Worker', icon: '⚙️', shape: 'gear', cap: 500, lat: 50, cost: 30, maxInst: 5000,
    desc: 'Pulls jobs from the queue, does heavy processing (500 jobs/s per instance) and writes to the database.',
  },
  objstore: {
    name: 'Object Storage', icon: '🪣', shape: 'bucket', cap: 20_000_000, lat: 30, cost: 20, managed: true,
    desc: 'S3-style blob storage for files, images and video. Serves static files and accepts uploads. Managed and practically unlimited.',
  },
  search: {
    name: 'Search Engine', icon: '🔎', shape: 'rect', cap: 2000, lat: 25, cost: 120, maxInst: 500,
    desc: 'Full-text index (Elasticsearch-style) for fast search. 2k req/s per node.',
  },
};

export const DB_KINDS: Kind[] = ['sql', 'replica', 'nosql'];

/** Request types a component can handle itself (ignoring forwarding). */
export const HANDLES: Partial<Record<Kind, ReqType[]>> = {
  app: ['read', 'write', 'static', 'upload', 'search', 'attack'],
  cache: ['read'],
  sql: ['read', 'write', 'search'],
  replica: ['read', 'search'],
  nosql: ['read', 'write', 'search'],
  queue: ['write'],
  worker: ['write'],
  objstore: ['static', 'upload'],
  search: ['search'],
};

export const PASSTHROUGH: Kind[] = ['cdn', 'waf', 'ratelimiter', 'lb'];
