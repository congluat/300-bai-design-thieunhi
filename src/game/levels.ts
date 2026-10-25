import type { Kind, ReqType } from './components';
import type { Design, Mods, Requirements, Traffic } from './sim';
import { deriveRequirements, referenceDesign, refSummary } from './generate';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Very Hard' | 'Extreme' | 'Boss';

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
}

export interface Chapter {
  title: string;
  subtitle: string;
  difficulty: Difficulty;
  /** the "key idea" flags a naive design leaves out (used by tests) */
  naive: { cdn?: boolean; waf?: boolean; rl?: boolean; cache?: boolean; queue?: boolean; search?: boolean; minInst?: boolean };
  strict: ReqType[];
  success: number;
  allowed: (i: number) => Kind[];
  traffic: (i: number) => Traffic;
  noSPOF: (i: number) => boolean;
  mods: (i: number) => Mods | undefined;
  business: string[];
  hints: string[];
  levels: [string, string][];
}

// ---------- helpers ----------
/** geometric interpolation from a (i=0) to b (i=9), rounded to 2 significant digits */
const g = (a: number, b: number, i: number, from = 0) => {
  if (i < from) return 0;
  const t = (i - from) / Math.max(1, 9 - from);
  const v = a * Math.pow(b / a, t);
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return Math.round(v / p) * p;
};

const BASIC: Kind[] = ['app', 'sql'];
const SCALE: Kind[] = [...BASIC, 'lb', 'cache', 'replica'];
const EDGE: Kind[] = [...SCALE, 'cdn', 'objstore'];
const ASYNC: Kind[] = [...EDGE, 'queue', 'worker', 'nosql'];
const SEARCH: Kind[] = [...ASYNC, 'search'];
const ALL: Kind[] = [...SEARCH, 'waf', 'ratelimiter'];

export const CHAPTERS: Chapter[] = [
  {
    title: 'Hello, Server',
    subtitle: 'One app, one database — and then a Load Balancer.',
    difficulty: 'Easy',
    naive: {},
    strict: [],
    success: 0.99,
    allowed: (i) => (i < 3 ? BASIC : [...BASIC, 'lb']),
    traffic: (i) => ({ read: g(20, 1200, i), write: g(2, 120, i) }),
    noSPOF: () => false,
    mods: () => undefined,
    business: ['Users read content and occasionally write (comments, saves, sign-ups).', 'Every write must be stored in a database.'],
    hints: [
      'Connect Users ➜ App Server ➜ SQL Database (drag from the ● dot on the right edge).',
      'One App Server handles 1,000 req/s. More instances need a Load Balancer in front.',
    ],
    levels: [
      ['Personal Blog', 'You just launched a blog. A few friends read it and leave the occasional comment.'],
      ['Guestbook', "A retro guestbook for your band's website. Visitors sign it and read each other's messages."],
      ['Todo App', 'Your side-project todo app just got its first hundred users.'],
      ['Recipe Box', 'Home cooks save and browse recipes. One server is starting to sweat.'],
      ['Book Club', 'A book club platform with reviews and reading lists is growing fast.'],
      ['Wedding RSVP', 'The couple invited the whole town — and the town is refreshing the RSVP page.'],
      ['Pet Adoption Board', 'Shelters post pets, families browse listings all day long.'],
      ['Campus Notes', 'Students share lecture notes the night before finals.'],
      ['Local News Desk', 'A small-town newspaper moves online and everyone checks it at breakfast.'],
      ['Startup API', 'Your API got featured in a newsletter. Squeeze everything out of one SQL database.'],
    ],
  },
  {
    title: 'Cache Me If You Can',
    subtitle: 'Read-heavy traffic: caches and read replicas.',
    difficulty: 'Easy',
    naive: { cache: true },
    strict: ['read'],
    success: 0.99,
    allowed: () => SCALE,
    traffic: (i) => ({ read: g(3000, 80000, i), write: g(30, 400, i) }),
    noSPOF: () => false,
    mods: (i) => (i === 3 ? { cacheHit: 0.75 } : i === 6 ? { cacheHit: 0.65 } : i === 8 ? { cacheHit: 0.6 } : undefined),
    business: ['Reads dominate — the same data is requested again and again.', 'Reads must be fast: a database round-trip alone is too slow.'],
    hints: [
      'Users ➜ Load Balancer ➜ App Server ➜ Cache ➜ SQL, plus App Server ➜ SQL for writes.',
      'Cache misses still hit the database. If the primary is overloaded, connect Cache ➜ Read Replica too.',
      'Reads are split between the SQL primary and replicas by instance count.',
    ],
    levels: [
      ['Viral Blog Post', 'One of your posts hit the front page. Readers everywhere, almost no writes.'],
      ['Wiki Mirror', 'A community wiki where every article is read thousands of times per edit.'],
      ['Live Sports Scores', 'Scores update every few seconds and millions of fans keep refreshing.'],
      ['Product Catalog', 'A catalog with a long tail of products — the cache hits less often than you\'d like.'],
      ['Weather API', 'Every app on every phone asks for the forecast of the same few cities.'],
      ['Q&A Forum', 'Answers are written once and read forever.'],
      ['Movie Database', 'A huge movie database: lots of rarely-visited pages, so cache hit rate is low.'],
      ['Exchange Rates API', 'Fintech apps poll exchange rates non-stop.'],
      ['Game Leaderboard', 'Players check the leaderboard constantly; long-tail profiles lower the cache hit rate.'],
      ['Celebrity Gossip Feed', 'A celebrity scandal just broke. Everyone is reading the same story.'],
    ],
  },
  {
    title: 'Edge of Glory',
    subtitle: 'Static files belong on a CDN.',
    difficulty: 'Medium',
    naive: { cdn: true },
    strict: ['static'],
    success: 0.99,
    allowed: () => EDGE,
    traffic: (i) => ({ static: g(10000, 1000000, i), read: g(1000, 10000, i), write: g(20, 200, i) }),
    noSPOF: () => false,
    mods: (i) => (i === 5 ? { cdnHit: 0.9 } : i === 8 ? { cdnHit: 0.85 } : undefined),
    business: ['Pages are heavy: images, scripts, stylesheets — far more static requests than API calls.', 'Static files must load fast for users everywhere.'],
    hints: [
      'Users ➜ CDN ➜ Object Storage for static files. Dynamic requests still go through the Load Balancer.',
      "Don't let App Servers serve images — it's slow and expensive.",
    ],
    levels: [
      ['Photo Portfolio', 'A photographer\'s portfolio full of high-res images.'],
      ['Online Magazine', 'Long-form articles with big hero images and embedded galleries.'],
      ['Docs Site', 'Developer docs: tons of JS, CSS and screenshots per page.'],
      ['Meme Gallery', 'Memes are images. Lots of them. Shared everywhere.'],
      ['Game Patch Downloads', 'A new patch dropped and every player downloads it at once.'],
      ['Font Library', 'Thousands of websites embed your fonts — with a long tail that misses the CDN cache more often.'],
      ['Map Tiles', 'An interactive map serving tiles for every zoom level.'],
      ['Podcast Hosting', 'Episodes are downloaded by apps worldwide every morning.'],
      ['App Store Assets', 'Icons and screenshots for millions of apps, many rarely viewed.'],
      ['Global Launch Day', 'Your product launches worldwide today. One million static requests per second.'],
    ],
  },
  {
    title: 'Never Go Down',
    subtitle: 'High availability: no single point of failure.',
    difficulty: 'Medium',
    naive: { minInst: true },
    strict: [],
    success: 0.995,
    allowed: () => EDGE,
    traffic: (i) => ({ read: g(1000, 40000, i), write: g(50, 400, i), static: i % 2 ? g(5000, 300000, i) : 0 }),
    noSPOF: () => true,
    mods: (i) => (i === 5 ? { cacheHit: 0.7 } : undefined),
    business: ['Any single machine may die at any moment — the system must survive it.', 'Every self-managed component needs ≥ 2 instances. SQL needs a standby (2 instances).'],
    hints: [
      'Bump Load Balancer, App Server, Cache, Replicas and SQL to at least 2 instances.',
      'CDN, Object Storage and WAF are managed services — they never count as SPOFs.',
    ],
    levels: [
      ['Internal Bank Portal', 'Bank staff use this portal all day. Downtime means angry branch managers.'],
      ['Hospital Scheduling', 'Doctors and nurses rely on the schedule. It cannot go down.'],
      ['Payroll System', 'Payday is tomorrow. Nothing is allowed to fail.'],
      ['Airline Check-in', 'Passengers check in online before every flight.'],
      ['Stock Ticker', 'Traders watch prices tick in real time.'],
      ['Emergency Alerts', 'A public alert page during a storm — read-heavy and life-critical.'],
      ['Tax Filing Portal', 'Deadline day for tax returns.'],
      ['Payment Status Page', 'Merchants check whether payments went through.'],
      ['Insurance Claims', 'After a hailstorm, thousands file claims with photos.'],
      ['Election Night Results', 'The whole country refreshes the results page.'],
    ],
  },
  {
    title: 'Async All the Things',
    subtitle: 'Queues, workers and sharded databases for heavy writes.',
    difficulty: 'Hard',
    naive: { queue: true },
    strict: ['write'],
    success: 0.99,
    allowed: () => ASYNC,
    traffic: (i) => ({ read: g(3000, 100000, i), write: g(1000, 100000, i) }),
    noSPOF: () => false,
    mods: () => undefined,
    business: [
      'Writes must be acknowledged almost instantly — users only need to know "we got it".',
      'The actual processing can happen in the background, but no write may be lost.',
      'SQL writes cost 2× a read — a single primary will not keep up.',
    ],
    hints: [
      'App Server ➜ Message Queue ➜ Worker ➜ Database. The queue acknowledges immediately.',
      'Workers process 500 jobs/s each — make sure they keep up or the backlog drops requests.',
      'NoSQL shards scale writes horizontally.',
    ],
    levels: [
      ['Order Inbox', 'A shop that receives orders faster than it can process them.'],
      ['Email Sender', 'Send newsletters and receipts without making users wait.'],
      ['Analytics Events', 'Every click and page view is recorded for analytics.'],
      ['Flash Sale', 'A midnight flash sale. Thousands of orders per second.'],
      ['Concert Ticket Drop', 'Tickets for the biggest tour of the year go on sale.'],
      ['IoT Sensor Ingest', 'Millions of sensors report temperature every few seconds.'],
      ['Chat Messages', 'A chat app where every message is a write.'],
      ['Ride Requests', 'Riders request trips and drivers update their location.'],
      ['Ad Click Tracking', 'Every ad click must be counted — that\'s how you get paid.'],
      ['Black Friday Checkout', 'The biggest shopping day of the year. 100k writes per second.'],
    ],
  },
  {
    title: 'Find It Fast',
    subtitle: 'Full-text search needs a search engine.',
    difficulty: 'Hard',
    naive: { search: true },
    strict: ['search'],
    success: 0.99,
    allowed: () => SEARCH,
    traffic: (i) => ({ search: g(500, 80000, i), read: g(2000, 50000, i), write: g(100, 5000, i), static: g(10000, 300000, i, 4) }),
    noSPOF: () => false,
    mods: () => undefined,
    business: ['Users search constantly and expect instant results.', 'LIKE queries on SQL are 10× heavier and +200ms slower.'],
    hints: ['Add a Search Engine and connect App Server ➜ Search Engine.', 'Search Engine nodes handle 2k req/s each.'],
    levels: [
      ['Job Board', 'Candidates search jobs by title, skill and city.'],
      ['Recipe Search', '"Chicken, no dairy, under 30 minutes."'],
      ['Real Estate Listings', 'House hunters search by neighborhood and price.'],
      ['Code Search', 'Developers grep across millions of repositories.'],
      ['Marketplace Search', 'Second-hand marketplace with photos on every listing.'],
      ['Hotel Finder', 'Travelers search hotels by city and date.'],
      ['Library Catalog', 'A national library puts its whole catalog online.'],
      ['Log Explorer', 'Engineers search logs during an incident.'],
      ['Music Search', 'Find any song by a fragment of its title.'],
      ['Mega Store Search', 'A huge e-commerce store: search is the front door.'],
    ],
  },
  {
    title: 'Media Mania',
    subtitle: 'Uploads, video and massive static traffic.',
    difficulty: 'Very Hard',
    naive: { cdn: true },
    strict: ['static'],
    success: 0.99,
    allowed: () => SEARCH,
    traffic: (i) => ({
      upload: g(50, 20000, i), static: g(30000, 2000000, i), read: g(3000, 100000, i),
      write: g(200, 10000, i), search: g(500, 20000, i, 3),
    }),
    noSPOF: () => false,
    mods: (i) => (i === 6 ? { cdnHit: 0.9 } : undefined),
    business: [
      'Uploads cost 5× a normal request on App Servers and must land in Object Storage.',
      'Watching videos and images is static traffic — it must be fast.',
    ],
    hints: ['App Server ➜ Object Storage for uploads; Users ➜ CDN ➜ Object Storage for viewing.', 'Uploads make App Servers work hard — size them accordingly.'],
    levels: [
      ['Photo Sharing', 'Share photos with friends. Upload, then everyone views.'],
      ['Podcast Uploads', 'Creators upload episodes; listeners download them.'],
      ['Short Video App', 'Short videos, endless scrolling.'],
      ['Online Courses', 'Instructors upload lessons, students binge them before exams.'],
      ['Design Asset Hub', 'Designers upload and download assets and templates.'],
      ['Live Clips', 'Gamers clip highlights and share them instantly.'],
      ['Family Cloud Album', 'Every family photo, backed up — long tail lowers the CDN hit rate.'],
      ['Music Streaming', 'Artists upload tracks, fans stream them.'],
      ['Video Platform', 'A full video platform with search and comments.'],
      ['Creator Economy', 'Millions of creators, two million static requests per second.'],
    ],
  },
  {
    title: 'Under Siege',
    subtitle: 'DDoS: filter the bots before they reach your servers.',
    difficulty: 'Very Hard',
    naive: { waf: true, rl: true },
    strict: [],
    success: 0.99,
    allowed: () => ALL,
    traffic: (i) => ({ attack: g(20000, 3000000, i), read: g(2000, 50000, i), write: g(100, 3000, i), static: g(5000, 200000, i) }),
    noSPOF: () => false,
    mods: () => undefined,
    business: [
      'A botnet is flooding your dynamic endpoints with junk requests.',
      'Real users must still be served.',
      'The budget is nowhere near enough to just scale up for the attack.',
    ],
    hints: [
      'Put a WAF right after Users, before the Load Balancer.',
      'WAF blocks 95%, a Rate Limiter behind it blocks 80% of what is left — layer them.',
    ],
    levels: [
      ['Script Kiddie', 'Someone found a DDoS tutorial and picked your site.'],
      ['Angry Competitor', 'A competitor rented a small botnet.'],
      ['Scalper Bots', 'Bots hammer your store trying to buy limited sneakers.'],
      ['Credential Stuffing', 'Bots try leaked passwords against your login API.'],
      ['Game Server Attack', 'Rival players attack your game\'s API during a tournament.'],
      ['Hacktivists', 'A hacktivist group targets you for the headlines.'],
      ['Exchange Launch', 'A crypto exchange launches a new token — and the attackers show up.'],
      ['Election Site Attack', 'Foreign botnets flood a voter information site.'],
      ['Botnet for Hire', 'A professional botnet with a million devices.'],
      ['Record-Breaking DDoS', 'Three million junk requests per second. Hold the line.'],
    ],
  },
  {
    title: 'Hyperscale',
    subtitle: 'Everything at once, hundreds of thousands of req/s.',
    difficulty: 'Extreme',
    naive: { queue: true },
    strict: ['write', 'static', 'search'],
    success: 0.995,
    allowed: () => ALL,
    traffic: (i) => ({
      read: g(100000, 800000, i), write: g(10000, 150000, i), static: g(300000, 3000000, i),
      search: g(5000, 80000, i), upload: g(500, 5000, i), attack: g(100000, 2000000, i, 3),
    }),
    noSPOF: (i) => i % 2 === 1,
    mods: (i) => (i === 4 ? { cacheHit: 0.7 } : undefined),
    business: [
      'A product used by tens of millions of people every day.',
      'Reads, writes, search, uploads and static content — all at scale.',
      'Some levels require no single point of failure; later ones are under DDoS.',
    ],
    hints: [
      'Static: Users ➜ CDN ➜ Object Storage. Dynamic: Users ➜ WAF ➜ Rate Limiter ➜ Load Balancer ➜ App.',
      'Writes: App ➜ Queue ➜ Worker ➜ NoSQL. Reads: App ➜ Cache ➜ NoSQL. Search: App ➜ Search Engine.',
      'Keep every component under 70% to keep latency flat.',
    ],
    levels: [
      ['Social Feed', 'An infinite feed of posts, photos and likes.'],
      ['Food Delivery', 'Restaurants, riders and hungry customers at dinner time.'],
      ['Ride Hailing', 'Every ride is a burst of writes, reads and map tiles.'],
      ['Global Marketplace', 'Buyers and sellers in 100 countries.'],
      ['News Aggregator', 'Long-tail articles from thousands of sources — cache hit rate drops.'],
      ['Streaming Service', 'Movies and shows for a whole continent.'],
      ['Messaging App', 'Billions of messages per day, and someone is attacking it.'],
      ['Travel Booking', 'Flights, hotels and cars — searched endlessly.'],
      ['Super App', 'Payments, chat, shopping and rides in one app.'],
      ['World Cup Final', 'The whole planet is watching — and posting.'],
    ],
  },
  {
    title: 'Planet Scale',
    subtitle: 'Boss levels: millions of req/s, DDoS up to 10M req/s, zero SPOF.',
    difficulty: 'Boss',
    naive: { waf: true, rl: true },
    strict: ['read', 'write', 'static', 'search'],
    success: 0.999,
    allowed: () => ALL,
    traffic: (i) => ({
      read: g(500000, 2000000, i), write: g(50000, 300000, i), static: g(1000000, 5000000, i),
      search: g(50000, 300000, i), upload: g(5000, 30000, i), attack: g(1000000, 10000000, i),
    }),
    noSPOF: () => true,
    mods: (i) => (i === 3 ? { cdnHit: 0.9 } : undefined),
    business: [
      'Success rate ≥ 99.9% for every request type.',
      'No single point of failure anywhere.',
      'Latency targets are tight for reads, writes, static content and search.',
      'A massive botnet is attacking at the same time.',
    ],
    hints: [
      'Layered defense: Users ➜ WAF ➜ Rate Limiter ➜ Load Balancer ➜ App Servers.',
      'Async writes via Queue ➜ Workers ➜ NoSQL, reads via Cache ➜ NoSQL, search via Search Engine.',
      'Thousands of App Servers are normal at this scale — watch the budget.',
    ],
    levels: [
      ['Global Search Engine', 'Answer the world\'s questions in milliseconds.'],
      ['Global Social Network', 'Three billion users, one feed.'],
      ['Planet Video', 'More video uploaded every minute than you can watch in a lifetime.'],
      ['Global Shopping Day', 'The biggest shopping festival on Earth — and the CDN cache is cold.'],
      ['New Year\'s Eve', 'Every time zone sends "Happy New Year" at midnight.'],
      ['Worldwide Game Launch', 'The most anticipated game ever launches everywhere at once.'],
      ['Global Payments', 'Every card swipe on the planet goes through you.'],
      ['Everything App', 'Chat, pay, shop, ride, watch — one app for everything.'],
      ['Internet Under Attack', 'The largest botnet ever recorded picks you as its target.'],
      ['The Final Boss', 'Millions of real users, ten million bots. Design the system that survives it all.'],
    ],
  },
];

// ---------- build all levels ----------
function buildLevels(): Level[] {
  const out: Level[] = [];
  let prevAllowed: Kind[] = [];
  CHAPTERS.forEach((ch, ci) => {
    ch.levels.forEach(([title, story], i) => {
      const traffic: Traffic = {};
      for (const [k, v] of Object.entries(ch.traffic(i))) if (v) traffic[k as ReqType] = v;
      const allowed = ch.allowed(i);
      const noSPOF = ch.noSPOF(i);
      const mods = ch.mods(i);
      const ref = referenceDesign(traffic, { allowed, noSPOF }, mods);
      if (!ref) throw new Error(`Level ${ci + 1}-${i + 1} "${title}" has no reference solution`);
      const req = deriveRequirements(ref, traffic, { success: ch.success, noSPOF, strict: ch.strict, mods });
      const newComponents = allowed.filter((k) => !prevAllowed.includes(k));
      prevAllowed = allowed;
      const business = [...ch.business];
      if (mods?.cacheHit) business.push(`Long-tail data: the cache hit rate is only ${Math.round(mods.cacheHit * 100)}% here.`);
      if (mods?.cdnHit) business.push(`Long-tail files: the CDN hit rate is only ${Math.round(mods.cdnHit * 100)}% here.`);
      if (noSPOF && !ch.noSPOF(-1)) business.push('This level requires no single point of failure.');
      out.push({
        id: `c${ci + 1}l${i + 1}`,
        num: out.length + 1,
        chapter: ci,
        title,
        difficulty: ch.difficulty,
        story,
        business,
        traffic,
        req,
        allowed,
        newComponents,
        hints: [...ch.hints, refSummary(ref)],
      });
    });
  });
  return out;
}

export const LEVELS: Level[] = buildLevels();

/** Exposed for tests: reference + naive designs of a level. */
export function levelDesigns(l: Level): { ref: Design | null; naive: Design | null } {
  const ch = CHAPTERS[l.chapter];
  const plan = { allowed: l.allowed, noSPOF: !!l.req.noSPOF };
  const ref = referenceDesign(l.traffic, plan, l.req.mods);
  const hasNaive = Object.keys(ch.naive).length > 0;
  const naive = hasNaive ? referenceDesign(l.traffic, { ...plan, disable: ch.naive }, l.req.mods) : null;
  return { ref, naive };
}

export const DIFF_COLOR: Record<Difficulty, string> = {
  Easy: '#3c9d5d',
  Medium: '#2f6fd6',
  Hard: '#d98a00',
  'Very Hard': '#d6452f',
  Extreme: '#b0207a',
  Boss: '#7a2fd1',
};
