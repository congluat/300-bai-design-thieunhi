import type { Design } from '../game/sim';

const KEY = 'sdq:v2';

interface Saved {
  stars: Record<string, number>;
  designs: Record<string, Design>;
  unlockAll?: boolean;
  seenHelp?: boolean;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { stars: {}, designs: {}, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { stars: {}, designs: {} };
}

let state = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export const storage = {
  get: () => state,
  setStars(id: string, n: number) {
    if ((state.stars[id] ?? 0) < n) { state = { ...state, stars: { ...state.stars, [id]: n } }; persist(); }
  },
  saveDesign(id: string, d: Design) { state = { ...state, designs: { ...state.designs, [id]: d } }; persist(); },
  clearDesign(id: string) { const designs = { ...state.designs }; delete designs[id]; state = { ...state, designs }; persist(); },
  setUnlockAll(v: boolean) { state = { ...state, unlockAll: v }; persist(); },
  setSeenHelp() { state = { ...state, seenHelp: true }; persist(); },
  resetAll() { state = { stars: {}, designs: {} }; persist(); },
};
