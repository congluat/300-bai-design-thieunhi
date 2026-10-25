import { COMPONENTS, REQUEST_TYPES, type Kind, type ReqType } from './components';
import type { Design, Mods, Requirements, Traffic } from './sim';
import { deriveRequirements, referenceDesign, refSummary, type RefPlan } from './generate';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Very Hard' | 'Extreme' | 'Boss';

/** A twist is what makes a level different from its neighbours. */
export interface Twist {
  ban?: Kind[];
  caps?: Partial<Record<Kind, number>>;
  spike?: number;
  noSPOF?: boolean;
  cacheHit?: number;
  cdnHit?: number;
  strict?: ReqType[];
  /** story reason shown with the twist */
  why?: string;
}

export interface Level {
  id: string;
  num: number;
  chapter: number;
  title: string;
  difficulty: Difficulty;
  story: string;
  business: string[];
  traffic: Traffic;
  req: Requirements;
  allowed: Kind[];
  hints: string[];
  newComponents: Kind[];
  twist: Twist;
  tags: string[];
}

interface Spec { title: string; story: string; traffic: Traffic; twist?: Twist }

export interface Chapter {
  title: string;
  subtitle: string;
  difficulty: Difficulty;
  allowed: Kind[];
  success: number;
  strict: ReqType[];
  noSPOF?: boolean;
  business: string[];
  hints: string[];
  levels: Spec[];
}

// ---------- compact level builder ----------
interface T { r?: number; w?: number; st?: number; up?: number; se?: number; atk?: number }
const tr = (t: T): Traffic => ({ read: t.r, write: t.w, static: t.st, upload: t.up, search: t.se, attack: t.atk });
const L = (title: string, story: string, t: T, twist?: Twist): Spec => ({ title, story, traffic: tr(t), twist });
const k = 1000, M = 1_000_000;

const BASIC: Kind[] = ['app', 'sql', 'lb'];
const SCALE: Kind[] = [...BASIC, 'cache', 'replica'];
const EDGE: Kind[] = [...SCALE, 'cdn', 'objstore'];
const ASYNC: Kind[] = [...EDGE, 'queue', 'worker', 'nosql'];
const SEARCH: Kind[] = [...ASYNC, 'search'];
const ALL: Kind[] = [...SEARCH, 'waf', 'ratelimiter'];

export const CHAPTERS: Chapter[] = [
  {
    title: 'Hello, Server', subtitle: 'App servers, one SQL database, scale out vs scale up.', difficulty: 'Easy',
    allowed: BASIC, success: 0.99, strict: [],
    business: ['Users read content and write (comments, saves, sign-ups). Every write must be stored in the database.'],
    hints: [
      'Connect Users ➜ App Server ➜ SQL Database (drag from the ● dot on the right edge).',
      'Scale out = more instances (needs a Load Balancer in front of App Servers). Scale up = a bigger machine size (S → 2XL).',
    ],
    levels: [
      L('Personal Blog', 'You just launched a blog. A few friends read it and leave the occasional comment.', { r: 20, w: 2 }),
      L('Guestbook', "A retro guestbook for your band's site — people mostly sign it.", { r: 40, w: 60 }),
      L('Todo App', 'Your todo app took off — but the cheap host gives you one (resizable) server.', { r: 700, w: 300 }, { caps: { app: 1 }, why: 'Cheap host: one server only' }),
      L('Recipe Box', 'Home cooks browse recipes all evening. One small server is not enough any more.', { r: 1500, w: 40 }),
      L('Book Club', 'Your hosting licence only covers ONE app server.', { r: 2500, w: 100 }, { caps: { app: 1 }, why: 'Licence covers a single App Server' }),
      L('Wedding RSVP', 'Everyone RSVPs the same evening — mostly writes.', { r: 300, w: 2000 }),
      L('Pet Adoption Board', 'Adoption day: everyone browses listings and nothing may go offline.', { r: 10000, w: 50 }, { noSPOF: true }),
      L('Campus Notes', 'Quiet all semester, then finals night hits.', { r: 500, w: 30 }, { spike: 5, why: 'Finals night' }),
      L('Local News Desk', 'Everyone in town reads the morning edition. Reads hammer the single database.', { r: 4000, w: 30 }),
      L('Startup API', 'A newsletter feature brings traffic — and the data centre only gives you 3 racks.', { r: 3000, w: 800 }, { caps: { app: 3 }, why: 'Only 3 racks for App Servers' }),
    ],
  },
  {
    title: 'Cache Me If You Can', subtitle: 'Caches, read replicas and their limits.', difficulty: 'Easy',
    allowed: SCALE, success: 0.99, strict: ['read'],
    business: ['Reads dominate and must be fast — a database round-trip alone is too slow.'],
    hints: [
      'App Server ➜ Cache ➜ SQL for reads; App Server ➜ SQL for writes.',
      'Cache misses still hit the database. Read Replicas share read load with the primary.',
    ],
    levels: [
      L('Viral Blog Post', 'One post hits the front page. Readers everywhere, almost no writes.', { r: 3000, w: 30 }),
      L('Wiki Mirror', 'The Redis cluster is down for maintenance — survive on replicas.', { r: 8000, w: 200 }, { ban: ['cache'], why: 'Cache cluster under maintenance', strict: [] }),
      L('Live Sports Scores', 'Everyone asks for the same few scores — the cache is almost always hot.', { r: 30000, w: 20 }, { cacheHit: 0.97 }),
      L('Product Catalog', 'A long tail of products: the cache misses a lot.', { r: 15000, w: 100 }, { cacheHit: 0.6 }),
      L('Weather API', 'Your cloud plan allows just ONE cache node.', { r: 60000, w: 10 }, { caps: { cache: 1 }, why: 'One cache node per plan' }),
      L('Q&A Forum', 'Heavy posting: answers, votes and comments pour in.', { r: 10000, w: 1500 }),
      L('Movie Database', 'Millions of rarely-visited pages — the cache helps little.', { r: 25000, w: 100 }, { cacheHit: 0.45 }),
      L('Exchange Rates API', 'Markets open: traffic triples for an hour.', { r: 20000, w: 300 }, { spike: 3, why: 'Market open' }),
      L('Game Leaderboard', 'Esports final: the leaderboard cannot go down.', { r: 12000, w: 1200 }, { noSPOF: true }),
      L('Celebrity Gossip Feed', 'A scandal breaks — and ops caps you at 20 app servers.', { r: 80000, w: 400 }, { caps: { app: 20 }, why: 'Ops limit: 20 App Servers' }),
    ],
  },
  {
    title: 'Edge of Glory', subtitle: 'Static content belongs on a CDN.', difficulty: 'Medium',
    allowed: EDGE, success: 0.99, strict: ['static'],
    business: ['Pages are heavy: images, scripts, stylesheets. Static files must load fast everywhere.'],
    hints: [
      'Users ➜ CDN ➜ Object Storage for static files. Dynamic requests still go through the Load Balancer.',
      'If there is no Object Storage, the CDN can use your App Servers as origin.',
    ],
    levels: [
      L('Photo Portfolio', 'A photographer\'s portfolio full of high-res images.', { st: 10000, r: 500, w: 10 }),
      L('Online Magazine', 'The CMS cannot invalidate a cache — articles must come from the database. Many images are rarely viewed.', { st: 50000, r: 5000, w: 50 }, { cdnHit: 0.85, ban: ['cache'], strict: ['static'], why: 'CMS cannot invalidate caches' }),
      L('Docs Site', 'Security says no new storage buckets — the CDN must pull from your app servers.', { st: 80000, r: 300, w: 5 }, { ban: ['objstore'], why: 'No new storage buckets allowed' }),
      L('Meme Gallery', 'Memes everywhere, plus a busy comment section.', { st: 200000, r: 8000, w: 2000 }),
      L('Game Patch Downloads', 'Patch day: everyone downloads at once.', { st: 400000, r: 200, w: 10 }, { spike: 5, why: 'Patch release' }),
      L('Font Library', 'Thousands of sites embed your fonts — long tail of rare weights.', { st: 300000, r: 1000, w: 20 }, { cdnHit: 0.7, caps: { app: 1 }, why: 'One origin server' }),
      L('Map Tiles', 'Map tiles plus a busy place-details API.', { st: 400000, r: 20000, w: 50 }, { strict: ['static', 'read'] }),
      L('Podcast Hosting', 'Listeners download every morning; the API must survive any failure.', { st: 100000, r: 2000, w: 100 }, { noSPOF: true }),
      L('App Store Assets', 'Icons and screenshots for millions of apps — and only 6 app servers allowed.', { st: 600000, r: 10000, w: 200 }, { cdnHit: 0.8, caps: { app: 6 }, why: 'Only 6 App Servers' }),
      L('Global Launch Day', 'Launch day worldwide: one million static req/s.', { st: 1 * M, r: 30000, w: 500 }, { spike: 2, strict: ['static', 'read'] }),
    ],
  },
  {
    title: 'Never Go Down', subtitle: 'High availability: no single point of failure.', difficulty: 'Medium',
    allowed: EDGE, success: 0.995, strict: [], noSPOF: true,
    business: ['Any single machine may die at any moment — the system must survive it.'],
    hints: ['Every self-managed component needs ≥ 2 instances; SQL needs a standby (2 instances).', 'CDN, Object Storage and WAF are managed — never a SPOF.'],
    levels: [
      L('Internal Bank Portal', 'Bank staff use this portal all day.', { r: 1000, w: 100 }),
      L('Hospital Scheduling', 'Doctors and nurses book and change shifts constantly.', { r: 3000, w: 1800 }),
      L('Payroll System', 'Payday: thousands of payslips written at once.', { r: 500, w: 1500 }),
      L('Airline Check-in', 'Passengers check in and download boarding passes.', { r: 8000, w: 300, st: 20000 }),
      L('Stock Ticker', 'Prices are read millions of times — always the same hot symbols.', { r: 100000, w: 50 }, { cacheHit: 0.95, strict: ['read'], caps: { cache: 2 }, why: 'Two cache nodes per rack' }),
      L('Emergency Alerts', 'A storm warning goes out; everyone refreshes at once.', { r: 40000, w: 10, st: 100000 }, { spike: 5, why: 'Storm warning' }),
      L('Tax Filing Portal', 'Regulators forbid caching tax data.', { r: 10000, w: 1500 }, { ban: ['cache'], why: 'Tax data must never be cached' }),
      L('Payment Status Page', 'Merchants poll payment status; only 10 app servers are certified.', { r: 20000, w: 500 }, { caps: { app: 10 }, why: 'Only 10 certified App Servers' }),
      L('Insurance Claims', 'After a hailstorm: claims with photos.', { r: 5000, w: 800, st: 50000 }, { cdnHit: 0.85 }),
      L('Election Night Results', 'The whole country refreshes the results page.', { r: 60000, w: 20, st: 300000 }, { spike: 3, why: 'Results announced' }),
    ],
  },
  {
    title: 'Async All the Things', subtitle: 'Queues, workers and sharded databases.', difficulty: 'Hard',
    allowed: ASYNC, success: 0.99, strict: ['write'],
    business: ['Writes must be acknowledged almost instantly; processing can happen in the background — but nothing may be lost.'],
    hints: [
      'App Server ➜ Message Queue ➜ Worker ➜ Database. The queue acks immediately and absorbs traffic spikes.',
      'NoSQL shards scale reads and writes horizontally.',
    ],
    levels: [
      L('Order Inbox', 'A shop that receives orders faster than it can process them.', { r: 2000, w: 1000 }),
      L('Email Sender', 'A newsletter blast arrives in a burst — and only 4 mail-worker boxes exist.', { r: 200, w: 3000 }, { spike: 4, caps: { worker: 4 }, why: 'Only 4 mail-worker boxes' }),
      L('Analytics Events', 'NoSQL only — and just 3 shards are provisioned.', { r: 100, w: 20000 }, { ban: ['sql', 'replica'], caps: { nosql: 3 }, why: 'Data team: NoSQL only, 3 shards' }),
      L('Flash Sale', 'Midnight flash sale: 5× burst of orders — and finance insists on the SQL ledger.', { r: 10000, w: 5000 }, { spike: 5, ban: ['nosql'], why: 'Finance requires the SQL ledger' }),
      L('Concert Ticket Drop', 'The biggest tour of the year — zero downtime allowed.', { r: 30000, w: 8000 }, { noSPOF: true }),
      L('IoT Sensor Ingest', 'Sensors need a synchronous ack from the DB — no queue allowed.', { r: 500, w: 50000 }, { ban: ['queue', 'worker'], why: 'Devices need synchronous DB acks', strict: [] }),
      L('Chat Messages', 'Every message is read and written fast.', { r: 20000, w: 20000 }, { strict: ['write', 'read'] }),
      L('Ride Requests', 'Workers run on special GPU boxes — only 10 of them.', { r: 15000, w: 10000 }, { caps: { worker: 10 }, why: 'Only 10 worker boxes' }),
      L('Ad Click Tracking', 'Prime-time TV ad: clicks triple.', { r: 1000, w: 80000 }, { spike: 3, caps: { nosql: 10 }, why: 'Prime-time ad, 10 shards max' }),
      L('Black Friday Checkout', 'The biggest shopping day of the year — and only 50 app servers are PCI-certified.', { r: 100000, w: 100000 }, { noSPOF: true, caps: { app: 50 }, why: 'Only 50 PCI-certified App Servers' }),
    ],
  },
  {
    title: 'Find It Fast', subtitle: 'Full-text search needs a search engine.', difficulty: 'Hard',
    allowed: SEARCH, success: 0.99, strict: ['search'],
    business: ['Users search constantly and expect instant results. Search on SQL is 10× heavier and +200ms.'],
    hints: ['Add a Search Engine and connect App Server ➜ Search Engine.', 'Search Engine nodes handle 2k req/s each at size S.'],
    levels: [
      L('Job Board', 'Candidates search jobs by title, skill and city.', { se: 500, r: 2000, w: 100 }),
      L('Recipe Search', 'Search-heavy with photo-rich results.', { se: 3000, r: 1000, w: 20, st: 20000 }),
      L('Real Estate Listings', 'House hunters search and browse many photos.', { se: 5000, r: 8000, w: 200, st: 50000 }, { cdnHit: 0.9, ban: ['objstore'], why: 'Photos live on the app servers' }),
      L('Code Search', 'Indexers are huge machines — only 4 search nodes fit in the cluster.', { se: 20000, r: 1000, w: 2000 }, { caps: { search: 4 }, why: 'Cluster fits 4 search nodes' }),
      L('Marketplace Search', 'Second-hand marketplace — must survive any node failure.', { se: 10000, r: 10000, w: 1000, st: 100000 }, { noSPOF: true }),
      L('Hotel Finder', 'Holiday season opens: search traffic triples.', { se: 15000, r: 5000, w: 500 }, { spike: 3, caps: { search: 3 }, why: 'Holiday booking opens; 3 search nodes' }),
      L('Library Catalog', 'No budget line for a search cluster: search must run on the database tier.', { se: 2000, r: 20000, w: 50 }, { ban: ['search'], why: 'No search cluster in the budget', strict: [] }),
      L('Log Explorer', 'Logs are written non-stop while engineers search them.', { se: 30000, r: 100, w: 20000 }),
      L('Music Search', 'Find any song instantly, then play its details page.', { se: 50000, r: 30000, w: 300 }, { strict: ['search', 'read'], ban: ['nosql'], why: 'Catalogue lives in SQL' }),
      L('Mega Store Search', 'A huge store — search is the front door and must never fail.', { se: 80000, r: 50000, w: 5000, st: 300000 }, { noSPOF: true }),
    ],
  },
  {
    title: 'Media Mania', subtitle: 'Uploads, video and massive static traffic.', difficulty: 'Very Hard',
    allowed: SEARCH, success: 0.99, strict: ['static'],
    business: ['Uploads cost 5× a normal request on App Servers and must land in Object Storage. Viewing media is static traffic.'],
    hints: ['App Server ➜ Object Storage for uploads; Users ➜ CDN ➜ Object Storage for viewing.', 'Uploads make App Servers work hard — size them accordingly.'],
    levels: [
      L('Photo Sharing', 'Share photos with friends.', { up: 50, st: 30000, r: 3000, w: 200 }),
      L('Podcast Uploads', 'Creators upload hour-long episodes — the studio has 4 upload servers.', { up: 800, st: 50000, r: 1000, w: 50 }, { caps: { app: 4 }, why: '4 upload servers' }),
      L('Short Video App', 'Endless scrolling of short videos.', { up: 2000, st: 300000, r: 20000, w: 2000 }, { strict: ['static', 'read'] }),
      L('Online Courses', 'Exam week: students binge lessons.', { up: 100, st: 500000, r: 5000, w: 100 }, { spike: 3, why: 'Exam week' }),
      L('Design Asset Hub', 'Designers upload, search and download assets.', { up: 3000, st: 100000, se: 2000, r: 5000, w: 300 }),
      L('Live Clips', 'Gamers clip highlights — but only 40 app servers are allowed.', { up: 5000, st: 200000, r: 10000, w: 3000 }, { caps: { app: 40 }, why: 'Only 40 App Servers' }),
      L('Family Cloud Album', 'Every family photo backed up — long tail, cold CDN, zero downtime.', { up: 1000, st: 400000, r: 5000, w: 500 }, { cdnHit: 0.8, noSPOF: true }),
      L('Music Streaming', 'Artists upload tracks, fans stream and search.', { up: 200, st: 1500000, r: 50000, w: 1000, se: 10000 }),
      L('Video Platform', 'A full video platform — search must be instant.', { up: 10000, st: 1 * M, r: 50000, w: 5000, se: 20000 }, { strict: ['static', 'search'], caps: { search: 5 }, why: '5 search nodes' }),
      L('Creator Economy', 'Millions of creators, two million static req/s.', { up: 20000, st: 2 * M, r: 100000, w: 10000, se: 20000 }, { noSPOF: true, ban: ['cache'], why: 'Personalised feeds cannot be cached' }),
    ],
  },
  {
    title: 'Under Siege', subtitle: 'DDoS: filter the bots before they reach your servers.', difficulty: 'Very Hard',
    allowed: ALL, success: 0.99, strict: [],
    business: ['A botnet floods your dynamic endpoints. Real users must still be served — and the budget cannot absorb the attack.'],
    hints: ['Put a WAF right after Users, before the Load Balancer.', 'WAF blocks 95%; a Rate Limiter behind it blocks 80% of what is left.'],
    levels: [
      L('Script Kiddie', 'Someone found a DDoS tutorial and picked your site.', { atk: 20000, r: 2000, w: 100, st: 5000 }),
      L('Angry Competitor', 'The WAF contract is not signed yet — rate limiters only.', { atk: 100000, r: 5000, w: 200 }, { ban: ['waf'], why: 'WAF contract not signed yet' }),
      L('Scalper Bots', 'Limited sneakers drop: bots and buyers burst together.', { atk: 200000, r: 10000, w: 3000 }, { spike: 3, strict: ['write'], why: 'Sneaker drop' }),
      L('Credential Stuffing', 'Bots hammer the login API; sessions must never be cached.', { atk: 300000, r: 3000, w: 5000 }, { ban: ['cache'], why: 'Session data must not be cached' }),
      L('Game Server Attack', 'Tournament day: an attack and zero tolerance for downtime.', { atk: 500000, r: 20000, w: 2000 }, { noSPOF: true }),
      L('Hacktivists', 'A hacktivist group targets your media site.', { atk: 800000, r: 10000, w: 300, st: 100000 }, { cdnHit: 0.85 }),
      L('Exchange Launch', 'A token launch: trades must be durably written before the ack — no queue.', { atk: 1 * M, r: 50000, w: 10000 }, { strict: ['write'], ban: ['queue', 'worker'], why: 'Trades must be written before ack' }),
      L('Election Site Attack', 'Foreign botnets flood a voter info site on election day.', { atk: 1500000, r: 60000, w: 50, st: 300000 }, { spike: 2, why: 'Election day' }),
      L('Botnet for Hire', 'A professional botnet — and only 20 rate-limiter boxes.', { atk: 2 * M, r: 30000, w: 3000 }, { caps: { ratelimiter: 20 }, why: 'Only 20 rate-limiter boxes' }),
      L('Record-Breaking DDoS', 'Three million junk requests per second. Hold the line, zero SPOF.', { atk: 3 * M, r: 50000, w: 3000, st: 200000 }, { noSPOF: true }),
    ],
  },
  {
    title: 'Hyperscale', subtitle: 'Everything at once, hundreds of thousands to millions of req/s.', difficulty: 'Extreme',
    allowed: ALL, success: 0.995, strict: ['write', 'static', 'search'],
    business: ['A product used by tens of millions of people every day.'],
    hints: [
      'Static: Users ➜ CDN ➜ Object Storage. Dynamic: Users ➜ WAF ➜ Rate Limiter ➜ Load Balancer ➜ App.',
      'Writes: App ➜ Queue ➜ Worker ➜ NoSQL. Reads: App ➜ Cache ➜ NoSQL. Search: App ➜ Search Engine.',
    ],
    levels: [
      L('Social Feed', 'An infinite feed of posts, photos and likes.', { r: 100 * k, w: 10 * k, st: 300 * k, se: 5 * k, up: 500 }),
      L('Food Delivery', 'Dinner rush: orders triple.', { r: 150 * k, w: 30 * k, st: 400 * k, se: 10 * k, up: 300 }, { spike: 3, caps: { app: 60 }, why: 'Dinner rush, 60 App Servers max' }),
      L('Ride Hailing', 'Every ride is reads, writes and map tiles — never down.', { r: 200 * k, w: 50 * k, st: 500 * k }, { noSPOF: true }),
      L('Global Marketplace', 'Buyers and sellers in 100 countries — long-tail listings.', { r: 250 * k, w: 20 * k, st: 800 * k, se: 40 * k, up: 2000 }, { cacheHit: 0.7 }),
      L('News Aggregator', 'Thousands of sources, a cold CDN and a botnet.', { r: 400 * k, w: 5 * k, st: 1200 * k, se: 20 * k, atk: 200 * k }, { cdnHit: 0.85 }),
      L('Streaming Service', 'A whole continent streams — and the DC fits 100 app servers.', { r: 300 * k, w: 10 * k, st: 2 * M, up: 1000, se: 30 * k }, { caps: { app: 100 }, why: 'Data centre fits 100 App Servers' }),
      L('Messaging App', 'Messages must be acked by the database itself — no queue.', { r: 300 * k, w: 150 * k, atk: 500 * k }, { ban: ['queue', 'worker'], strict: ['read'], why: 'Messages need synchronous DB acks' }),
      L('Travel Booking', 'Holiday sale doubles everything; zero downtime.', { r: 200 * k, w: 20 * k, se: 80 * k, st: 600 * k }, { spike: 2, noSPOF: true, why: 'Holiday sale' }),
      L('Super App', 'Payments, chat, shopping, rides — and only 30 DB shards provisioned.', { r: 500 * k, w: 80 * k, st: 1500 * k, se: 50 * k, up: 5000, atk: 1 * M }, { caps: { nosql: 30 }, why: 'Only 30 DB shards provisioned' }),
      L('World Cup Final', 'The whole planet is watching — and posting.', { r: 800 * k, w: 150 * k, st: 3 * M, se: 80 * k, up: 5000, atk: 2 * M }, { spike: 2, noSPOF: true, caps: { app: 300 }, why: 'Final whistle, 300 App Servers max' }),
    ],
  },
  {
    title: 'Planet Scale', subtitle: 'Boss levels: millions of req/s, DDoS up to 10M req/s, zero SPOF, 99.9%.', difficulty: 'Boss',
    allowed: ALL, success: 0.999, strict: ['read', 'write', 'static', 'search'], noSPOF: true,
    business: ['Success ≥ 99.9% for every request type, no single point of failure, tight latency — under attack.'],
    hints: [
      'Layered defense: Users ➜ WAF ➜ Rate Limiter ➜ Load Balancer ➜ App Servers.',
      'Thousands of instances are normal at this scale — compare scale-up vs scale-out costs.',
    ],
    levels: [
      L('Global Search Engine', 'Answer the world\'s questions in milliseconds.', { se: 300 * k, r: 500 * k, w: 50 * k, st: 1 * M, atk: 1 * M }),
      L('Global Social Network', 'Three billion users, one feed, long-tail profiles.', { r: 2 * M, w: 300 * k, st: 3 * M, up: 10 * k, atk: 2 * M }, { cacheHit: 0.75 }),
      L('Planet Video', 'More video uploaded every minute than you could watch in a lifetime.', { up: 30 * k, st: 5 * M, r: 1 * M, w: 100 * k, se: 100 * k, atk: 3 * M }, { cdnHit: 0.9 }),
      L('Global Shopping Day', 'The biggest shopping festival on Earth doubles traffic.', { r: 1500 * k, w: 300 * k, st: 4 * M, se: 300 * k, atk: 4 * M }, { spike: 2, why: 'Festival countdown' }),
      L('New Year\'s Eve', 'Every time zone sends "Happy New Year" at midnight.', { r: 500 * k, w: 2 * M, atk: 2 * M }, { spike: 3, why: 'Midnight' }),
      L('Worldwide Game Launch', 'Launch everywhere at once — only 300 app servers fit.', { r: 1 * M, w: 200 * k, st: 5 * M, up: 5 * k, atk: 5 * M }, { caps: { app: 300 }, why: 'Only 300 App Servers fit' }),
      L('Global Payments', 'Balances must never be stale — no caching.', { r: 800 * k, w: 500 * k, atk: 6 * M }, { ban: ['cache'], why: 'Balances must never be stale' }),
      L('Everything App', 'Chat, pay, shop, ride, watch — with a 50-node search cluster cap.', { r: 2 * M, w: 300 * k, st: 5 * M, se: 300 * k, up: 30 * k, atk: 8 * M }, { caps: { search: 50 }, why: 'Search cluster capped at 50 nodes' }),
      L('Internet Under Attack', 'The largest botnet ever recorded — only 40 rate-limiter boxes.', { r: 1 * M, w: 100 * k, st: 2 * M, atk: 10 * M }, { caps: { ratelimiter: 40 }, why: 'Only 40 rate-limiter boxes' }),
      L('The Final Boss', 'Millions of users, ten million bots, a 2× spike and long-tail data.', { r: 2 * M, w: 300 * k, st: 5 * M, se: 300 * k, up: 30 * k, atk: 10 * M }, { spike: 2, cacheHit: 0.8, why: 'Everything at once' }),
    ],
  },
];

// ---------- twist → human text ----------
function twistBullets(tw: Twist, noSPOF: boolean, chapterNoSPOF: boolean, strict: ReqType[], chapterStrict: ReqType[]): string[] {
  const out: string[] = [];
  const names = (ks: Kind[]) => ks.map((x) => COMPONENTS[x].name).join(', ');
  if (tw.ban?.length) out.push(`🚫 Not available: ${names(tw.ban)}${tw.why ? ` — ${tw.why}` : ''}.`);
  if (tw.caps) {
    for (const [kind, n] of Object.entries(tw.caps) as [Kind, number][]) {
      out.push(`🔒 At most ${n} ${COMPONENTS[kind].name} instance${n > 1 ? 's' : ''}${tw.why && !tw.ban ? ` — ${tw.why}` : ''}. Scale UP with bigger machine sizes.`);
    }
  }
  if (tw.spike) out.push(`📈 Traffic spikes to ${tw.spike}× the average${tw.why && !tw.ban && !tw.caps ? ` (${tw.why})` : ''}. Everything must survive the peak — except work behind a Message Queue, which buffers the burst.`);
  if (tw.cacheHit) out.push(`🧊 Long-tail data: cache hit rate is only ${Math.round(tw.cacheHit * 100)}%.`);
  if (tw.cdnHit) out.push(`🧊 Long-tail files: CDN hit rate is only ${Math.round(tw.cdnHit * 100)}%.`);
  if (noSPOF) out.push(`🧯 No single point of failure: every self-managed component needs ≥ 2 instances.${chapterNoSPOF ? '' : ' (new for this level)'}`);
  const extra = strict.filter((t) => !chapterStrict.includes(t));
  if (extra.length) out.push(`⏱ Extra-tight latency for ${extra.map((t) => REQUEST_TYPES[t].short).join(', ')}.`);
  return out;
}

function twistTags(tw: Twist, noSPOF: boolean): string[] {
  const t: string[] = [];
  if (tw.ban?.length) t.push('🚫');
  if (tw.caps) t.push('🔒');
  if (tw.spike) t.push('📈');
  if (tw.cacheHit || tw.cdnHit) t.push('🧊');
  if (noSPOF) t.push('🧯');
  if (tw.strict?.length) t.push('⏱');
  return t;
}

export function levelPlan(l: Pick<Level, 'allowed' | 'req'>): RefPlan {
  return { allowed: l.allowed, noSPOF: !!l.req.noSPOF, caps: l.req.caps, mods: l.req.mods };
}

function buildLevels(): Level[] {
  const out: Level[] = [];
  let prevAllowed: Kind[] = [];
  CHAPTERS.forEach((ch, ci) => {
    const newInChapter = ch.allowed.filter((x) => !prevAllowed.includes(x));
    prevAllowed = ch.allowed;
    ch.levels.forEach((spec, i) => {
      const traffic: Traffic = {};
      for (const [kk, v] of Object.entries(spec.traffic)) if (v) traffic[kk as ReqType] = v;
      const tw = spec.twist ?? {};
      const allowed = ch.allowed.filter((x) => !tw.ban?.includes(x));
      const noSPOF = !!(ch.noSPOF || tw.noSPOF);
      const strict = tw.strict ?? ch.strict;
      const mods: Mods | undefined = tw.spike || tw.cacheHit || tw.cdnHit ? { spike: tw.spike, cacheHit: tw.cacheHit, cdnHit: tw.cdnHit } : undefined;
      const plan: RefPlan = { allowed, noSPOF, caps: tw.caps, mods };
      const ref = referenceDesign(traffic, plan);
      if (!ref) throw new Error(`Level ${ci + 1}-${i + 1} "${spec.title}" has no reference solution`);
      const req = deriveRequirements(ref, traffic, { success: ch.success, noSPOF, strict, mods, caps: tw.caps });
      out.push({
        id: `c${ci + 1}l${i + 1}`,
        num: out.length + 1,
        chapter: ci,
        title: spec.title,
        difficulty: ch.difficulty,
        story: spec.story,
        business: [...ch.business, ...twistBullets(tw, noSPOF, !!ch.noSPOF, strict, ch.strict)],
        traffic,
        req,
        allowed,
        newComponents: i === 0 ? newInChapter : [],
        twist: tw,
        tags: twistTags(tw, noSPOF && !ch.noSPOF),
        hints: [...ch.hints, `Spoiler — ${refSummary(ref)}`],
      });
    });
  });
  return out;
}

export const LEVELS: Level[] = buildLevels();

/** Exposed for tests. */
export function levelReference(l: Level): Design | null {
  return referenceDesign(l.traffic, levelPlan(l));
}

export const DIFF_COLOR: Record<Difficulty, string> = {
  Easy: '#3c9d5d',
  Medium: '#2f6fd6',
  Hard: '#d98a00',
  'Very Hard': '#d6452f',
  Extreme: '#b0207a',
  Boss: '#7a2fd1',
};
