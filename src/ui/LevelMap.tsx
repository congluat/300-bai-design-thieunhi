import { useEffect } from 'react';
import { LEVELS, CHAPTERS, DIFF_COLOR } from '../game/levels';
import { REQUEST_TYPES, type ReqType } from '../game/components';
import { fmtShort } from '../game/sim';
import { storage } from './storage';
import Stars from './Stars';

export function isUnlocked(i: number): boolean {
  const s = storage.get();
  if (s.unlockAll || i === 0) return true;
  return (s.stars[LEVELS[i - 1].id] ?? 0) > 0;
}

export default function LevelMap({ onPick, onChange, focus }: { onPick: (i: number) => void; onChange: () => void; focus?: number }) {
  const s = storage.get();
  const total = LEVELS.reduce((a, l) => a + (s.stars[l.id] ?? 0), 0);
  const solved = LEVELS.filter((l) => (s.stars[l.id] ?? 0) > 0).length;
  const nextIdx = LEVELS.findIndex((l, i) => isUnlocked(i) && !(s.stars[l.id] ?? 0));

  useEffect(() => {
    const target = focus ?? nextIdx;
    if (target > 0) document.getElementById(`lv-${target}`)?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="map">
      <header className="map-head">
        <h1>
          <span className="scribble">System Design</span> Quest
          <span className="pencil" aria-hidden>✏️</span>
        </h1>
        <p className="tagline">
          100 challenges. Drag components, wire them up, hit run — can your design handle the traffic, hit the latency
          targets, stay on budget and survive a DDoS? From 20 req/s to millions.
        </p>
        <div className="map-meta">
          <span className="chip">✅ {solved} / {LEVELS.length} solved</span>
          <span className="chip">⭐ {total} / {LEVELS.length * 3}</span>
          {nextIdx >= 0 && <button className="btn primary" onClick={() => onPick(nextIdx)}>▶ Continue: #{nextIdx + 1}</button>}
          <label className="chip toggle">
            <input type="checkbox" checked={!!s.unlockAll} onChange={(e) => { storage.setUnlockAll(e.target.checked); onChange(); }} />
            Unlock all levels
          </label>
          <button
            className="btn ghost small"
            onClick={() => { if (confirm('Erase all progress and saved designs?')) { storage.resetAll(); onChange(); } }}
          >
            Reset progress
          </button>
        </div>
      </header>

      <section className="how sketch-box">
        <h2>How to play</h2>
        <ol>
          <li>Read the brief: business rules, traffic (req/s), latency targets and budget.</li>
          <li>Drag components from the toolbox onto the canvas (or click to add).</li>
          <li>Drag from the <b className="dot">●</b> on a component's right edge to another component to connect them.</li>
          <li>Scale each component <b>out</b> (more instances) or <b>up</b> (bigger machine S → 2XL), hit <b>▶ Run simulation</b> and read the report.</li>
        </ol>
        <p className="muted">Each level has its own twist: 🚫 banned component · 🔒 instance limit (scale up!) · 📈 traffic spike · 🧊 low cache/CDN hit rate · 🧯 no single point of failure · ⏱ extra-tight latency</p>
        <p className="muted">⭐ Meet every requirement · ⭐⭐ Cost ≤ 80% of budget · ⭐⭐⭐ Plus every component ≤ 70% utilization</p>
      </section>

      {CHAPTERS.map((ch, ci) => {
        const levels = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) => l.chapter === ci);
        const chStars = levels.reduce((a, { l }) => a + (s.stars[l.id] ?? 0), 0);
        const maxRps = Math.max(...levels.map(({ l }) => Object.values(l.traffic).reduce((a, b) => a + (b ?? 0), 0)));
        return (
          <section key={ci} className="chapter">
            <div className="ch-head">
              <span className="ch-num">Chapter {ci + 1}</span>
              <h2>{ch.title}</h2>
              <span className="lv-diff" style={{ color: DIFF_COLOR[ch.difficulty], borderColor: DIFF_COLOR[ch.difficulty] }}>{ch.difficulty}</span>
              <span className="muted ch-sub">{ch.subtitle} Up to {fmtShort(maxRps)} req/s.</span>
              <span className="ch-stars">⭐ {chStars}/30</span>
            </div>
            <div className="levels">
              {levels.map(({ l, i }) => {
                const unlocked = isUnlocked(i);
                const stars = s.stars[l.id] ?? 0;
                const totalRps = Object.values(l.traffic).reduce((a, b) => a + (b ?? 0), 0);
                return (
                  <button
                    key={l.id}
                    id={`lv-${i}`}
                    className={`level-card ${unlocked ? '' : 'locked'} ${stars ? 'done' : ''} ${i === nextIdx ? 'next' : ''}`}
                    style={{ ['--tilt' as string]: `${((i * 37) % 7) - 3}deg`, ['--note' as string]: NOTE_COLORS[ci % NOTE_COLORS.length] }}
                    disabled={!unlocked}
                    onClick={() => onPick(i)}
                  >
                    <span className="lv-num">#{i + 1}</span>
                    <span className="lv-title">{l.title}</span>
                    <span className="lv-traffic">
                      {(Object.keys(l.traffic) as ReqType[]).map((t) => (
                        <span key={t} className="dot-chip" style={{ background: REQUEST_TYPES[t].color }} title={REQUEST_TYPES[t].label} />
                      ))}
                    </span>
                    {l.tags.length > 0 && <span className="lv-tags" title={l.business.slice(1).join('\n')}>{l.tags.join(' ')}</span>}
                    <span className="lv-foot">
                      <span>{fmtShort(totalRps)}/s</span>
                      {unlocked ? <Stars n={stars} size={14} /> : <span>🔒</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <footer className="map-foot muted">
        The simulation model is simplified for learning purposes — numbers are illustrative.
      </footer>
    </div>
  );
}

const NOTE_COLORS = ['#fff9c9', '#dff1ff', '#ffe3ee', '#e3f7dc', '#efe4ff', '#ffe9cf', '#dcf5f3', '#ffe0dc', '#f0f0e0', '#e9e0ff'];
