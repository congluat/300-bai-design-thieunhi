import { useState } from 'react';
import { LEVELS } from './game/levels';
import { storage } from './ui/storage';
import LevelMap from './ui/LevelMap';
import Play from './ui/Play';

export default function App() {
  const [levelIdx, setLevelIdx] = useState<number | null>(null);
  const [lastIdx, setLastIdx] = useState<number | undefined>(undefined);
  const [, force] = useState(0);
  const refresh = () => force((x) => x + 1);

  if (levelIdx === null) {
    return <LevelMap onPick={setLevelIdx} onChange={refresh} focus={lastIdx} />;
  }
  const level = LEVELS[levelIdx];
  return (
    <Play
      key={level.id}
      level={level}
      onBack={() => { setLastIdx(levelIdx); setLevelIdx(null); }}
      onNext={levelIdx < LEVELS.length - 1 ? () => setLevelIdx(levelIdx + 1) : undefined}
      onStars={(n) => { storage.setStars(level.id, n); refresh(); }}
    />
  );
}
