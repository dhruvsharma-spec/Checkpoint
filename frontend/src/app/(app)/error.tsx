'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="card" style={{ padding: 28 }}><h2 className="h2">Something went wrong.</h2><p style={{ color: 'var(--ink2)' }}>The page could not load. Your data is safe.</p><button className="btnP" onClick={reset}>Try again</button></div>;
}
