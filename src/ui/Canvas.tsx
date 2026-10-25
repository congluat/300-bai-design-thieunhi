import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { COMPONENTS, REQUEST_TYPES, sizeOf, type Kind, type ReqType } from '../game/components';
import { edgeKey, fmtShort, nodeCapacity, nodeCost, wouldCycle, type Design, type GNode, type SimResult } from '../game/sim';
import { linePaths, seedOf, shapePaths, type PathInfo } from './sketch';

export const NODE_W = 150;
export const NODE_H = 80;

export type Selection = { type: 'node'; id: string } | { type: 'edge'; from: string; to: string } | null;

export interface CanvasApi {
  viewCenter(): { x: number; y: number };
  fit(): void;
}

interface Props {
  design: Design;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onDropKind: (kind: Kind, x: number, y: number) => void;
  selected: Selection;
  setSelected: (s: Selection) => void;
  result: SimResult | null;
  flash: (msg: string) => void;
}

const KIND_FILL: Record<Kind, string> = {
  client: '#a9c9ff', cdn: '#9fdcff', waf: '#ffb3a6', ratelimiter: '#ffcf8a', lb: '#cbb8ff', app: '#ffe36e',
  cache: '#ffb3d6', sql: '#9de3b6', replica: '#b9ebc9', nosql: '#8fd6c0', queue: '#ffc98a', worker: '#cfcfcf',
  objstore: '#9ee8e1', search: '#c2ee9f',
};

const HAS_OUT: Kind[] = ['client', 'cdn', 'waf', 'ratelimiter', 'lb', 'app', 'cache', 'queue', 'worker'];

function utilColor(u: number): string {
  if (u > 1) return '#ef5b5b';
  if (u > 0.7) return '#ffc94d';
  if (u > 0) return '#7fd394';
  return '#dddddd';
}

function Paths({ paths }: { paths: PathInfo[] }) {
  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? 'none'} strokeLinecap="round" />
      ))}
    </>
  );
}

function clip(cx: number, cy: number, tx: number, ty: number, pad = 8) {
  const dx = tx - cx, dy = ty - cy;
  const hw = NODE_W / 2 + pad, hh = NODE_H / 2 + pad;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(Math.abs(hw / (dx || 1e-9)), Math.abs(hh / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

function edgeGeom(a: GNode, b: GNode) {
  const ac = { x: a.x + NODE_W / 2, y: a.y + NODE_H / 2 };
  const bc = { x: b.x + NODE_W / 2, y: b.y + NODE_H / 2 };
  const p1 = clip(ac.x, ac.y, bc.x, bc.y, 4);
  const p2 = clip(bc.x, bc.y, ac.x, ac.y, 10);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

type Drag =
  | { mode: 'node'; id: string; dx: number; dy: number; moved: boolean }
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'connect'; from: string }
  | null;

const Canvas = forwardRef<CanvasApi, Props>(function Canvas(
  { design, onMove, onConnect, onDropKind, selected, setSelected, result, flash },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState({ x: -40, y: -40, s: 1 });
  const [temp, setTemp] = useState<{ x1: number; y1: number; x2: number; y2: number; target?: string } | null>(null);
  const drag = useRef<Drag>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const designRef = useRef(design);
  designRef.current = design;

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const fit = () => {
    const ns = designRef.current.nodes;
    if (!ns.length || !wrapRef.current) return;
    const w = wrapRef.current.clientWidth, h = wrapRef.current.clientHeight;
    const minX = Math.min(...ns.map((n) => n.x)) - 60, minY = Math.min(...ns.map((n) => n.y)) - 60;
    const maxX = Math.max(...ns.map((n) => n.x + NODE_W)) + 60, maxY = Math.max(...ns.map((n) => n.y + NODE_H)) + 80;
    const s = Math.min(1.2, Math.max(0.3, Math.min(w / (maxX - minX), h / (maxY - minY))));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setView({ s, x: cx - w / s / 2, y: cy - h / s / 2 });
  };

  useImperativeHandle(ref, () => ({
    viewCenter: () => {
      const v = viewRef.current;
      return { x: v.x + size.w / v.s / 2, y: v.y + size.h / v.s / 2 };
    },
    fit,
  }));

  // fit on first render
  useEffect(() => {
    const t = setTimeout(() => {
      if (designRef.current.nodes.length > 1) fit();
      else setView({ x: -40, y: 300 - wrapRef.current!.clientHeight / 2, s: 1 });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mouse-wheel zoom
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const p = toWorld(e.clientX, e.clientY);
      const ns = Math.min(2, Math.max(0.25, v.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      setView({ s: ns, x: p.x - (p.x - v.x) * (v.s / ns), y: p.y - (p.y - v.y) * (v.s / ns) });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const nodeById = new Map(design.nodes.map((n) => [n.id, n]));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const port = t.closest('[data-port]');
    const node = t.closest('[data-node]');
    const edge = t.closest('[data-edge]');
    const p = toWorld(e.clientX, e.clientY);
    svgRef.current!.setPointerCapture(e.pointerId);
    if (port) {
      const id = port.getAttribute('data-port')!;
      drag.current = { mode: 'connect', from: id };
      const n = nodeById.get(id)!;
      setTemp({ x1: n.x + NODE_W, y1: n.y + NODE_H / 2, x2: p.x, y2: p.y });
    } else if (node) {
      const id = node.getAttribute('data-node')!;
      const n = nodeById.get(id)!;
      drag.current = { mode: 'node', id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
      setSelected({ type: 'node', id });
    } else if (edge) {
      const [from, to] = edge.getAttribute('data-edge')!.split('->');
      setSelected({ type: 'edge', from, to });
    } else {
      setSelected(null);
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      const v = viewRef.current;
      setView({ ...v, x: d.vx - (e.clientX - d.sx) / v.s, y: d.vy - (e.clientY - d.sy) / v.s });
    } else if (d.mode === 'node') {
      const p = toWorld(e.clientX, e.clientY);
      d.moved = true;
      onMove(d.id, Math.round(p.x - d.dx), Math.round(p.y - d.dy));
    } else if (d.mode === 'connect') {
      const p = toWorld(e.clientX, e.clientY);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
      const target = el?.getAttribute('data-node') ?? undefined;
      setTemp((tm) => (tm ? { ...tm, x2: p.x, y2: p.y, target: target !== d.from ? target : undefined } : tm));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try { svgRef.current!.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (d?.mode === 'connect') {
      const target = temp?.target;
      setTemp(null);
      if (!target) return;
      const tk = nodeById.get(target)!.kind;
      if (tk === 'client') return flash('You cannot connect into Users.');
      if (design.edges.some((x) => x.from === d.from && x.to === target)) return flash('These two are already connected.');
      if (wouldCycle(design, d.from, target)) return flash('No loops allowed (requests would circle forever).');
      onConnect(d.from, target);
    }
  };

  const vb = `${view.x} ${view.y} ${size.w / view.s} ${size.h / view.s}`;
  const showEmpty = design.nodes.length <= 1;

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('text/x-kind') as Kind;
        if (!kind || !COMPONENTS[kind]) return;
        const p = toWorld(e.clientX, e.clientY);
        onDropKind(kind, Math.round(p.x - NODE_W / 2), Math.round(p.y - NODE_H / 2));
      }}
    >
      <svg
        ref={svgRef}
        className={`canvas ${drag.current?.mode === 'pan' ? 'panning' : ''}`}
        viewBox={vb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={view.x - 2000} y={view.y - 2000} width={size.w / view.s + 4000} height={size.h / view.s + 4000} fill="url(#grid)" />

        {showEmpty && (
          <g className="empty-hint" pointerEvents="none">
            <text x={260} y={300}>← Drag components from the toolbox here</text>
            <text x={260} y={334}>then drag from a ● dot to connect them</text>
          </g>
        )}

        {/* edges */}
        <g>
          {design.edges.map((e) => {
            const a = nodeById.get(e.from), b = nodeById.get(e.to);
            if (!a || !b) return null;
            const g = edgeGeom(a, b);
            const k = edgeKey(e.from, e.to);
            const sel = selected?.type === 'edge' && selected.from === e.from && selected.to === e.to;
            const flow = result?.edges[k];
            const total = flow ? Object.values(flow).reduce((s, v) => s + (v ?? 0), 0) : 0;
            const dead = !!result && total === 0;
            const paths = linePaths(g.x1, g.y1, g.x2, g.y2, {
              stroke: sel ? '#e2483d' : dead ? '#aaa' : '#2b2b2b', strokeWidth: sel ? 2.6 : 1.8, seed: seedOf(k),
            });
            const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
            return (
              <g key={k} data-edge={k} className="edge">
                <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="transparent" strokeWidth={16} />
                <Paths paths={paths} />
                {result && total > 0 && (
                  <g transform={`translate(${mx},${my})`} pointerEvents="none">
                    <rect x={-34} y={-11} width={68} height={20} rx={8} className="edge-label-bg" />
                    <text className="edge-label" y={4}>{fmtShort(total)}/s</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {result && <Particles design={design} result={result} />}

        {/* nodes */}
        <g>
          {design.nodes.map((n) => {
            const c = COMPONENTS[n.kind];
            const st = result?.nodes[n.id];
            const sel = selected?.type === 'node' && selected.id === n.id;
            const isTarget = temp?.target === n.id;
            const fill = st && n.kind !== 'client' ? utilColor(st.util) : KIND_FILL[n.kind];
            const paths = shapePaths(c.shape, NODE_W, NODE_H, {
              fill,
              fillStyle: st && st.util > 1 ? 'cross-hatch' : 'hachure',
              stroke: sel ? '#e2483d' : isTarget ? '#2f6fd6' : '#2b2b2b',
              strokeWidth: sel || isTarget ? 2.6 : 1.7,
              seed: seedOf(n.id),
            });
            const spof = result?.spof.includes(n.id);
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} data-node={n.id} className="node">
                <rect x={-8} y={-8} width={NODE_W + 16} height={NODE_H + 16} fill="transparent" />
                <Paths paths={paths} />
                <text x={NODE_W / 2} y={c.shape === 'diamond' ? 32 : 30} className="node-icon">{c.icon}</text>
                <text x={NODE_W / 2} y={c.shape === 'diamond' ? 56 : 58} className="node-label">{c.name}</text>
                {!c.managed && (() => {
                  const label = `${sizeOf(n.size).name}×${n.inst}`;
                  const w = 12 + label.length * 8;
                  return (
                    <g transform={`translate(${NODE_W - w / 2 + 6}, -4)`}>
                      <rect x={-w / 2} y={-11} width={w} height={22} rx={10} className="badge" />
                      <text className="badge-text" y={5}>{label}</text>
                    </g>
                  );
                })()}
                <text x={NODE_W / 2} y={NODE_H + 19} className="node-spec" pointerEvents="none">
                  {n.kind === 'client'
                    ? '~20ms internet'
                    : c.managed
                      ? `managed · ∞ · ${c.lat}ms · $${c.cost}`
                      : `${fmtShort(nodeCapacity(n))} req/s · ${c.lat}ms · $${fmtShort(nodeCost(n))}`}
                </text>
                {st && n.kind !== 'client' && (
                  <g transform={`translate(0, ${NODE_H + 28})`} pointerEvents="none">
                    <rect x={10} y={0} width={NODE_W - 20} height={7} rx={3} className="util-bg" />
                    <rect x={10} y={0} width={Math.min(1, st.util) * (NODE_W - 20)} height={7} rx={3} fill={utilColor(st.util)} />
                    <text x={NODE_W / 2} y={22} className={`util-text ${st.util > 1 ? 'bad' : ''}`}>
                      {c.cap === Infinity ? '' : `${Math.round(st.util * 100)}% load · ${fmtShort(st.load)}/${fmtShort(st.capacity)}`}
                    </text>
                  </g>
                )}
                {spof && <text x={-6} y={-4} className="spof-tag">SPOF!</text>}
                {HAS_OUT.includes(n.kind) && (
                  <g data-port={n.id} className="port">
                    <circle cx={NODE_W + 2} cy={NODE_H / 2} r={14} fill="transparent" />
                    <circle cx={NODE_W + 2} cy={NODE_H / 2} r={7} className="port-dot" />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {temp && (
          <line x1={temp.x1} y1={temp.y1} x2={temp.x2} y2={temp.y2} className="temp-line" pointerEvents="none" />
        )}
      </svg>
      <div className="zoom-ctl">
        <button className="btn small" onClick={() => setView((v) => ({ ...v, s: Math.min(2, v.s * 1.2) }))} title="Zoom in">＋</button>
        <button className="btn small" onClick={() => setView((v) => ({ ...v, s: Math.max(0.25, v.s / 1.2) }))} title="Zoom out">－</button>
        <button className="btn small" onClick={fit} title="Fit to screen">⤢</button>
      </div>
    </div>
  );
});

export default Canvas;

/** Request dots moving along wires (direct DOM updates, no React re-render). */
function Particles({ design, result }: { design: Design; result: SimResult }) {
  const gRef = useRef<SVGGElement>(null);
  const dRef = useRef(design);
  dRef.current = design;

  useEffect(() => {
    const g = gRef.current!;
    g.innerHTML = '';
    type P = { from: string; to: string; t: ReqType; phase: number; speed: number; el: SVGCircleElement };
    const ps: P[] = [];
    for (const [k, flows] of Object.entries(result.edges)) {
      const [from, to] = k.split('->');
      for (const [t, f] of Object.entries(flows) as [ReqType, number][]) {
        if (!f || f < 0.5) continue;
        const n = Math.max(1, Math.min(6, Math.round(Math.log10(f) * 1.5)));
        for (let i = 0; i < n; i++) {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          el.setAttribute('r', t === 'attack' ? '3.2' : '4');
          el.setAttribute('fill', REQUEST_TYPES[t].color);
          el.setAttribute('opacity', '0.85');
          g.appendChild(el);
          ps.push({ from, to, t, phase: i / n + Math.random() * 0.1, speed: 0.35 + Math.random() * 0.15, el });
        }
      }
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const time = (now - start) / 1000;
      const byId = new Map(dRef.current.nodes.map((n) => [n.id, n]));
      for (const p of ps) {
        const a = byId.get(p.from), b = byId.get(p.to);
        if (!a || !b) { p.el.setAttribute('opacity', '0'); continue; }
        const geo = edgeGeom(a, b);
        const u = (time * p.speed + p.phase) % 1;
        p.el.setAttribute('cx', String(geo.x1 + (geo.x2 - geo.x1) * u));
        p.el.setAttribute('cy', String(geo.y1 + (geo.y2 - geo.y1) * u));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  return <g ref={gRef} pointerEvents="none" />;
}
