import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Level } from '../game/levels';
import { CHAPTERS, DIFF_COLOR } from '../game/levels';
import { COMPONENTS, REQUEST_TYPES, LEGIT_TYPES, type Kind, type ReqType } from '../game/components';
import { designCost, fmt, fmtShort, simulate, type Design, type SimResult } from '../game/sim';
import Canvas, { NODE_H, NODE_W, type CanvasApi, type Selection } from './Canvas';
import { storage } from './storage';
import Stars from './Stars';

const DEFAULT_DESIGN = (): Design => ({ nodes: [{ id: 'client', kind: 'client', x: 60, y: 260, inst: 1 }], edges: [] });
const uid = () => 'n' + Math.random().toString(36).slice(2, 8);

interface Props {
  level: Level;
  onBack: () => void;
  onNext?: () => void;
  onStars: (n: number) => void;
}

export default function Play({ level, onBack, onNext, onStars }: Props) {
  const [design, setDesign] = useState<Design>(() => storage.get().designs[level.id] ?? DEFAULT_DESIGN());
  const [selected, setSelected] = useState<Selection>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [hintIdx, setHintIdx] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const [tab, setTab] = useState<'brief' | 'tools'>('brief');
  const canvasApi = useRef<CanvasApi>(null);
  const toastTimer = useRef<number>(0);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => storage.saveDesign(level.id, design), 300);
    return () => clearTimeout(t);
  }, [design, level.id]);

  const update = (fn: (d: Design) => Design, structural = true) => {
    setDesign(fn);
    if (structural) setResult(null);
  };

  const addNode = (kind: Kind, x?: number, y?: number) => {
    if (x === undefined || y === undefined) {
      const c = canvasApi.current?.viewCenter() ?? { x: 400, y: 300 };
      const free = (px: number, py: number) =>
        design.nodes.every((n) => Math.abs(n.x - px) > NODE_W + 30 || Math.abs(n.y - py) > NODE_H + 40);
      const cx = Math.round(c.x - NODE_W / 2), cy = Math.round(c.y - NODE_H / 2);
      x = cx; y = cy;
      search: for (let r = 0; r < 12; r++) {
        for (let a = 0; a < Math.max(1, r * 6); a++) {
          const ang = (a / Math.max(1, r * 6)) * Math.PI * 2;
          const px = Math.round(cx + Math.cos(ang) * r * 120), py = Math.round(cy + Math.sin(ang) * r * 80);
          if (free(px, py)) { x = px; y = py; break search; }
        }
      }
    }
    const id = uid();
    update((d) => ({ ...d, nodes: [...d.nodes, { id, kind, x: x!, y: y!, inst: 1 }] }));
    setSelected({ type: 'node', id });
  };

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    if (selected.type === 'node') {
      const n = design.nodes.find((x) => x.id === selected.id);
      if (!n || COMPONENTS[n.kind].fixed) return;
      update((d) => ({
        nodes: d.nodes.filter((x) => x.id !== selected.id),
        edges: d.edges.filter((e) => e.from !== selected.id && e.to !== selected.id),
      }));
    } else {
      update((d) => ({ ...d, edges: d.edges.filter((e) => !(e.from === selected.from && e.to === selected.to)) }));
    }
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, design]);

  const run = () => {
    const r = simulate(design, level.traffic, level.req);
    setResult(r);
    setStamp((s) => s + 1);
    if (r.pass) onStars(r.stars);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setInst = (id: string, n: number) => {
    update((d) => ({
      ...d,
      nodes: d.nodes.map((x) => {
        if (x.id !== id) return x;
        const max = COMPONENTS[x.kind].maxInst ?? 1;
        return { ...x, inst: Math.max(1, Math.min(max, Math.round(n) || 1)) };
      }),
    }));
  };

  const reset = () => {
    if (!confirm('Clear the whole canvas for this level?')) return;
    update(() => DEFAULT_DESIGN());
    setSelected(null);
    storage.clearDesign(level.id);
  };

  const cost = useMemo(() => designCost(design), [design]);
  const selNode = selected?.type === 'node' ? design.nodes.find((n) => n.id === selected.id) : undefined;
  const best = storage.get().stars[level.id] ?? 0;

  return (
    <div className="play">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>← Levels</button>
        <div className="title">
          <span className="lv-num">#{level.num}</span>
          <span className="t">{level.title}</span>
          <span className="lv-diff" style={{ color: DIFF_COLOR[level.difficulty], borderColor: DIFF_COLOR[level.difficulty] }}>{level.difficulty}</span>
          <Stars n={best} size={16} />
        </div>
        <div className={`cost-meter ${cost > level.req.budget ? 'over' : ''}`} title="Monthly infrastructure cost">
          💰 ${fmt(cost)} <span className="muted">/ ${fmt(level.req.budget)}</span>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => {
            flash('💡 ' + level.hints[hintIdx % level.hints.length]);
            setHintIdx(hintIdx + 1);
          }}>💡 Hint</button>
          <button className="btn ghost" onClick={reset}>🧽 Clear</button>
          <button className="btn primary" onClick={run}>▶ Run simulation</button>
        </div>
      </header>

      <div className="mob-tabs">
        <button className={tab === 'brief' ? 'on' : ''} onClick={() => setTab('brief')}>📋 Brief</button>
        <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>🧰 Toolbox</button>
      </div>

      <aside className={`left ${tab}`}>
        <Brief level={level} />
        <Palette level={level} onAdd={addNode} />
      </aside>

      <main className="center">
        <Canvas
          ref={canvasApi}
          design={design}
          onMove={(id, x, y) => update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }), false)}
          onConnect={(from, to) => update((d) => ({ ...d, edges: [...d.edges, { from, to }] }))}
          onDropKind={(k, x, y) => addNode(k, x, y)}
          selected={selected}
          setSelected={setSelected}
          result={result}
          flash={flash}
        />
        {toast && <div className="toast sketch-box">{toast}</div>}
        {result && stamp > 0 && (
          <div key={stamp} className={`stamp ${result.pass ? 'ok' : 'fail'}`}>
            {result.pass ? <>PASSED <Stars n={result.stars} size={34} /></> : 'FAILED'}
          </div>
        )}
      </main>

      <aside className="right">
        {selNode && <Inspector node={selNode} result={result} onInst={setInst} onDelete={deleteSelected} />}
        {selected?.type === 'edge' && <EdgeCard sel={selected} design={design} result={result} onDelete={deleteSelected} />}
        <Report result={result} level={level} onRun={run} onNext={onNext} onFocus={(id) => setSelected({ type: 'node', id })} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Brief({ level }: { level: Level }) {
  const r = level.req;
  return (
    <section className="card brief sketch-box">
      <div className="muted small">Chapter {level.chapter + 1} · {CHAPTERS[level.chapter].title}</div>
      <h3>📋 Brief</h3>
      <p className="story">{level.story}</p>
      <h4>Business rules</h4>
      <ul className="biz">
        {level.business.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      <h4>Traffic & targets</h4>
      <table className="req-table">
        <thead><tr><th>Type</th><th>req/s</th><th>Avg latency</th></tr></thead>
        <tbody>
          {(Object.keys(level.traffic) as ReqType[]).map((t) => (
            <tr key={t}>
              <td><span className="swatch" style={{ background: REQUEST_TYPES[t].color }} />{REQUEST_TYPES[t].short}</td>
              <td>{fmt(level.traffic[t]!)}</td>
              <td>{t === 'attack' ? <span className="muted">block it!</span> : r.latency[t] ? `≤ ${r.latency[t]}ms` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="reqs">
        <li>✅ Success rate ≥ {(r.success * 100).toLocaleString('en-US')}%</li>
        <li>💰 Budget ≤ ${fmt(r.budget)}/month</li>
        {r.noSPOF && <li>🧯 No single point of failure</li>}
      </ul>
    </section>
  );
}

function Palette({ level, onAdd }: { level: Level; onAdd: (k: Kind) => void }) {
  return (
    <section className="card palette sketch-box">
      <h3>🧰 Toolbox</h3>
      <p className="muted small">Drag onto the canvas or click to add. Hover for details.</p>
      <div className="pal-list">
        {level.allowed.map((k) => {
          const c = COMPONENTS[k];
          const isNew = level.newComponents.includes(k) && level.num > 1;
          return (
            <button
              key={k}
              className="pal-item"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/x-kind', k); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => onAdd(k)}
              title={c.desc}
            >
              <span className="pi-icon">{c.icon}</span>
              <span className="pi-body">
                <span className="pi-name">{c.name} {isNew && <span className="new-tag">NEW</span>}</span>
                <span className="pi-stats">
                  {c.managed ? 'managed · ∞' : `${fmtShort(c.cap)} req/s`} · {c.lat}ms · ${c.cost}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Inspector({ node, result, onInst, onDelete }: {
  node: Design['nodes'][number]; result: SimResult | null;
  onInst: (id: string, n: number) => void; onDelete: () => void;
}) {
  const c = COMPONENTS[node.kind];
  const st = result?.nodes[node.id];
  const max = c.maxInst ?? 1;
  const need = st && !c.managed && !c.haOnly ? Math.ceil(st.load / (c.cap * 0.7)) : 0;
  return (
    <section className="card inspector sketch-box">
      <h3>{c.icon} {c.name}</h3>
      <p className="small">{c.desc}</p>
      <div className="stats">
        <span>⚡ {c.managed ? '∞' : fmt(c.cap)} req/s{!c.managed && !c.haOnly ? ' / instance' : ''}</span>
        <span>⏱ {c.lat}ms</span>
        <span>💰 ${c.cost}{!c.managed ? ' / instance' : ''}</span>
      </div>
      {!c.managed && (
        <div className="stepper">
          <span>{c.haOnly ? 'Instances (HA)' : 'Instances'}</span>
          {max > 50 && <button className="btn small" onClick={() => onInst(node.id, node.inst - 10)} disabled={node.inst <= 1}>−10</button>}
          <button className="btn small" onClick={() => onInst(node.id, node.inst - 1)} disabled={node.inst <= 1}>−</button>
          <input type="number" min={1} max={max} value={node.inst} onChange={(e) => onInst(node.id, Number(e.target.value))} />
          <button className="btn small" onClick={() => onInst(node.id, node.inst + 1)} disabled={node.inst >= max}>+</button>
          {max > 50 && <button className="btn small" onClick={() => onInst(node.id, node.inst + 10)} disabled={node.inst >= max}>+10</button>}
          <span className="muted small">max {fmt(max)}</span>
        </div>
      )}
      {st && node.kind !== 'client' && (
        <div className="node-load">
          <div>Load: <b>{fmt(st.load)}</b> / {c.managed ? '∞' : fmt(st.capacity)} ({Math.round(st.util * 100)}%)</div>
          <div className="by-type">
            {(Object.entries(st.byType) as [ReqType, number][]).map(([t, v]) => (
              <span key={t} className="mini-chip" style={{ background: REQUEST_TYPES[t].color }}>{REQUEST_TYPES[t].short} {fmtShort(v)}</span>
            ))}
          </div>
          {st.blocked > 0 && <div>🛡️ Blocked {fmt(st.blocked)} attack req/s</div>}
          {need > node.inst && <div className="muted small">Needs ≥ {fmt(need)} instances to stay under 70%.</div>}
        </div>
      )}
      {!c.fixed && <button className="btn danger small" onClick={onDelete}>🗑 Delete component (Del)</button>}
    </section>
  );
}

function EdgeCard({ sel, design, result, onDelete }: {
  sel: { from: string; to: string }; design: Design; result: SimResult | null; onDelete: () => void;
}) {
  const a = design.nodes.find((n) => n.id === sel.from), b = design.nodes.find((n) => n.id === sel.to);
  if (!a || !b) return null;
  const flow = result?.edges[`${sel.from}->${sel.to}`];
  return (
    <section className="card sketch-box">
      <h3>🔗 {COMPONENTS[a.kind].name} ➜ {COMPONENTS[b.kind].name}</h3>
      {flow && (
        <div className="by-type">
          {(Object.entries(flow) as [ReqType, number][]).map(([t, v]) => (
            <span key={t} className="mini-chip" style={{ background: REQUEST_TYPES[t].color }}>{REQUEST_TYPES[t].short} {fmtShort(v)}/s</span>
          ))}
        </div>
      )}
      <button className="btn danger small" onClick={onDelete}>🗑 Delete connection (Del)</button>
    </section>
  );
}

function Report({ result, level, onRun, onNext, onFocus }: {
  result: SimResult | null; level: Level; onRun: () => void; onNext?: () => void; onFocus: (id: string) => void;
}) {
  if (!result) {
    return (
      <section className="card report sketch-box">
        <h3>📊 Report</h3>
        <p>When your design is ready, hit <b>▶ Run simulation</b> (Ctrl+Enter) to fire traffic at it.</p>
        <h4>Request colors</h4>
        <div className="legend">
          {[...LEGIT_TYPES, 'attack' as ReqType].filter((t) => level.traffic[t]).map((t) => (
            <span key={t}><span className="swatch" style={{ background: REQUEST_TYPES[t].color }} />{REQUEST_TYPES[t].label}</span>
          ))}
        </div>
        <h4>Load colors</h4>
        <div className="legend">
          <span><span className="swatch" style={{ background: '#7fd394' }} />≤ 70%: healthy</span>
          <span><span className="swatch" style={{ background: '#ffc94d' }} />70–100%: getting slow</span>
          <span><span className="swatch" style={{ background: '#ef5b5b' }} />&gt; 100%: overloaded, dropping requests</span>
        </div>
      </section>
    );
  }
  const r = result;
  return (
    <section className={`card report sketch-box ${r.pass ? 'pass' : 'fail'}`}>
      <h3>📊 Report {r.pass ? '— PASSED 🎉' : '— not yet'}</h3>
      {r.pass && (
        <div className="star-row">
          <Stars n={r.stars} size={28} />
          <ul className="star-why small">
            <li className="ok">All requirements met</li>
            <li className={r.cost <= r.budget * 0.8 ? 'ok' : 'no'}>Cost ≤ 80% of budget (${fmt(r.budget * 0.8)})</li>
            <li className={r.maxUtil <= 0.7 ? 'ok' : 'no'}>Every component ≤ 70% utilization</li>
          </ul>
        </div>
      )}
      <table className="res-table">
        <thead><tr><th>Type</th><th>Success</th><th>Avg latency</th></tr></thead>
        <tbody>
          {r.types.map((t) => (
            <tr key={t.type}>
              <td><span className="swatch" style={{ background: REQUEST_TYPES[t.type].color }} />{REQUEST_TYPES[t.type].short}</td>
              <td className={t.okPass ? 'ok' : 'no'}>{(Math.floor(t.ok * 10000) / 100).toLocaleString('en-US')}%</td>
              <td className={t.latPass ? 'ok' : 'no'}>
                {t.ok > 0 ? `${Math.round(t.lat)}ms` : '—'}
                {t.latLimit && <span className="muted"> / {t.latLimit}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="checks">
        <li className={r.costPass ? 'ok' : 'no'}>💰 Cost ${fmt(r.cost)} / ${fmt(r.budget)}</li>
        {level.req.noSPOF && <li className={r.spofPass ? 'ok' : 'no'}>🧯 SPOF: {r.spof.length ? `${r.spof.length} found` : 'none'}</li>}
        {r.attackTotal > 0 && (
          <li className={r.attackBlocked / r.attackTotal > 0.9 ? 'ok' : 'warn'}>
            🛡️ Blocked {Math.round((r.attackBlocked / r.attackTotal) * 100)}% of DDoS traffic
          </li>
        )}
      </ul>
      {r.issues.length > 0 && (
        <>
          <h4>Notes</h4>
          <ul className="issues">
            {r.issues.slice(0, 12).map((i, k) => (
              <li key={k} className={i.level} onClick={() => i.nodeId && onFocus(i.nodeId)}>
                {i.level === 'error' ? '✘' : i.level === 'warn' ? '⚠' : 'ℹ'} {i.text}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="report-actions">
        <button className="btn" onClick={onRun}>↻ Run again</button>
        {r.pass && onNext && <button className="btn primary" onClick={onNext}>Next level ➜</button>}
        {r.pass && !onNext && <span className="win">🏆 You beat the game!</span>}
      </div>
    </section>
  );
}
