# ✏️ System Design Quest

A hand-drawn system design game that runs in the browser — **100 challenges** from 20 req/s to **millions of req/s** with a 10M req/s DDoS on top.

Drag components (Load Balancer, Cache, SQL/NoSQL, Queue, Worker, CDN, WAF, Rate Limiter, Search Engine…) onto the canvas, wire them up, set instance counts and hit **▶ Run simulation** to see whether your design handles the traffic, meets the latency targets, stays on budget, has no single point of failure and survives the attack.

## Chapters

| # | Chapter | Difficulty | Key idea | Peak traffic |
|---|---------|-----------|----------|--------------|
| 1 | Hello, Server | Easy | App + DB, then a Load Balancer | ~1k req/s |
| 2 | Cache Me If You Can | Easy | Cache + read replicas | ~80k |
| 3 | Edge of Glory | Medium | CDN + Object Storage | ~1M |
| 4 | Never Go Down | Medium | No single point of failure | ~340k |
| 5 | Async All the Things | Hard | Queue + Workers + sharded NoSQL | ~200k |
| 6 | Find It Fast | Hard | Search Engine | ~400k |
| 7 | Media Mania | Very Hard | Uploads + massive static traffic | ~2.1M |
| 8 | Under Siege | Very Hard | WAF + Rate Limiter vs DDoS | ~3.3M |
| 9 | Hyperscale | Extreme | Everything at once | ~6M |
| 10 | Planet Scale | Boss | Millions of req/s, 10M DDoS, 99.9%, zero SPOF | ~17.6M |

Stars: ⭐ meet every requirement · ⭐⭐ cost ≤ 80% of budget · ⭐⭐⭐ plus every component ≤ 70% utilization.

## How levels are generated

Levels are defined per chapter in `src/game/levels.ts` (story, traffic curve, allowed components, which latencies are strict).
For each level, `src/game/generate.ts` builds and auto-sizes a **reference design**, simulates it and derives the budget (≈ 1.3× reference cost) and latency targets from it.
The test suite checks that **every one of the 100 levels is solvable with 3 stars** and that the chapter's **naive design** (no cache / no CDN / no queue / no WAF…) **fails**.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # balance tests for all 100 levels
npm run build    # outputs dist/
```

## Deploy to GitHub Pages

0. If `deploy.yml` is in the project root, move it to `.github/workflows/deploy.yml`:
   ```bash
   mkdir -p .github/workflows && mv deploy.yml .github/workflows/deploy.yml
   ```
1. Push to the `main` branch of a GitHub repo:
   ```bash
   git init && git add . && git commit -m "System Design Quest"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow tests, builds and deploys. The game will be live at `https://<user>.github.io/<repo>/`.

`vite.config.ts` uses `base: './'`, so it works under any repo name.

## Project layout

```
src/
  game/components.ts   # component specs: capacity, latency, cost, limits
  game/sim.ts          # simulation engine: routing, load, overload, latency, SPOF, DDoS
  game/generate.ts     # reference-solution builder used to calibrate levels
  game/levels.ts       # 10 chapters × 10 levels
  game/levels.test.ts  # solvability + naive-design tests
  ui/                  # React: level map, hand-drawn canvas (rough.js), report
```

### Simulation model (simplified)

- Each request type (read, write, static, upload, search, DDoS) follows per-component routing rules
  (App reads prefer Cache → DB; writes prefer Queue → DB; cache misses 15% go to the DB; CDN hits 95%).
- Node load = requests through it × weight (SQL write ×2, upload ×5 on App, search on a DB ×10).
- Above 70% utilization latency climbs (up to ×4); above 100% a `1 − 1/util` share of requests fails.
- Splits are weighted by instance count (weighted round-robin).
- Queues acknowledge immediately (async), but overloaded workers/DBs behind them still lose requests.
- WAF blocks 95%, Rate Limiter 80%, CDN absorbs 30% of attack traffic.

Numbers are illustrative, for learning.
