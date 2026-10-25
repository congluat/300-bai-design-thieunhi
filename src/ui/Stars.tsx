export default function Stars({ n, size = 18 }: { n: number; size?: number }) {
  return (
    <span className="stars" style={{ fontSize: size }} aria-label={`${n} stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? 'on' : 'off'}>★</span>
      ))}
    </span>
  );
}
