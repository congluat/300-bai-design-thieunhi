import rough from 'roughjs';
import type { Shape } from '../game/components';

const gen = rough.generator();

export interface PathInfo { d: string; stroke: string; strokeWidth: number; fill?: string }

const cache = new Map<string, PathInfo[]>();

export interface SketchOpts {
  fill?: string;
  fillStyle?: 'hachure' | 'solid' | 'cross-hatch' | 'zigzag';
  stroke?: string;
  strokeWidth?: number;
  roughness?: number;
  seed?: number;
}

function opts(o: SketchOpts) {
  return {
    stroke: o.stroke ?? '#2b2b2b',
    strokeWidth: o.strokeWidth ?? 1.6,
    roughness: o.roughness ?? 1.3,
    bowing: 1.2,
    fill: o.fill,
    fillStyle: o.fillStyle ?? 'hachure',
    hachureGap: 6,
    fillWeight: 1.4,
    seed: o.seed ?? 1,
  };
}

const memo = (key: string, f: () => PathInfo[]) => {
  const c = cache.get(key);
  if (c) return c;
  const v = f();
  if (cache.size > 4000) cache.clear();
  cache.set(key, v);
  return v;
};

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (Math.abs(h) % 100000) + 1;
}

/** Draw a component shape inside a w×h box (origin 0,0). */
export function shapePaths(shape: Shape, w: number, h: number, o: SketchOpts): PathInfo[] {
  const key = `${shape}|${w}|${h}|${JSON.stringify(o)}`;
  return memo(key, () => {
    const op = opts(o);
    const ds = [] as ReturnType<typeof gen.rectangle>[];
    switch (shape) {
      case 'cylinder': {
        const ry = 10;
        const body = `M0,${ry} L0,${h - ry} A${w / 2},${ry} 0 0 0 ${w},${h - ry} L${w},${ry} A${w / 2},${ry} 0 0 0 0,${ry} Z`;
        ds.push(gen.path(body, op));
        ds.push(gen.ellipse(w / 2, ry, w, ry * 2, { ...op, fill: undefined }));
        break;
      }
      case 'cloud': {
        const p = `M${w * 0.2},${h} C${-w * 0.05},${h} ${-w * 0.02},${h * 0.45} ${w * 0.16},${h * 0.42}
          C${w * 0.15},${h * 0.05} ${w * 0.45},${-h * 0.05} ${w * 0.52},${h * 0.2}
          C${w * 0.62},${-h * 0.02} ${w * 0.9},${h * 0.08} ${w * 0.86},${h * 0.38}
          C${w * 1.05},${h * 0.42} ${w * 1.04},${h} ${w * 0.8},${h} Z`;
        ds.push(gen.path(p.replace(/\s+/g, ' '), op));
        break;
      }
      case 'shield': {
        const p = `M${w / 2},0 L${w - 4},${h * 0.12} C${w - 4},${h * 0.6} ${w * 0.75},${h * 0.88} ${w / 2},${h}
          C${w * 0.25},${h * 0.88} 4,${h * 0.6} 4,${h * 0.12} Z`;
        ds.push(gen.path(p.replace(/\s+/g, ' '), op));
        break;
      }
      case 'hex':
        ds.push(gen.polygon([[18, 0], [w - 18, 0], [w, h / 2], [w - 18, h], [18, h], [0, h / 2]], op));
        break;
      case 'diamond':
        ds.push(gen.polygon([[w / 2, -6], [w + 6, h / 2], [w / 2, h + 6], [-6, h / 2]], op));
        break;
      case 'queue': {
        ds.push(gen.rectangle(0, 0, w, h, op));
        for (let i = 1; i <= 3; i++) ds.push(gen.line(w - i * 12, 4, w - i * 12, h - 4, { ...op, strokeWidth: 1 }));
        break;
      }
      case 'bucket':
        ds.push(gen.polygon([[0, 0], [w, 0], [w - 14, h], [14, h]], op));
        ds.push(gen.ellipse(w / 2, 0, w, 12, { ...op, fill: undefined }));
        break;
      case 'gear':
        ds.push(gen.rectangle(0, 0, w, h, op));
        ds.push(gen.rectangle(5, 5, w - 10, h - 10, { ...op, fill: undefined, strokeWidth: 0.8 }));
        break;
      case 'person':
        ds.push(gen.rectangle(0, 0, w, h, op));
        break;
      default:
        ds.push(gen.rectangle(0, 0, w, h, op));
    }
    return ds.flatMap((d) => gen.toPaths(d) as PathInfo[]);
  });
}

export function linePaths(x1: number, y1: number, x2: number, y2: number, o: SketchOpts): PathInfo[] {
  const key = `l|${x1 | 0},${y1 | 0},${x2 | 0},${y2 | 0}|${JSON.stringify(o)}`;
  return memo(key, () => {
    const op = opts({ roughness: 0.9, ...o });
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ah = 13;
    const a1 = ang + Math.PI * 0.85, a2 = ang - Math.PI * 0.85;
    const ds = [
      gen.line(x1, y1, x2, y2, op),
      gen.line(x2, y2, x2 + ah * Math.cos(a1), y2 + ah * Math.sin(a1), op),
      gen.line(x2, y2, x2 + ah * Math.cos(a2), y2 + ah * Math.sin(a2), op),
    ];
    return ds.flatMap((d) => gen.toPaths(d) as PathInfo[]);
  });
}

export function rectPaths(w: number, h: number, o: SketchOpts): PathInfo[] {
  return shapePaths('rect', w, h, o);
}
