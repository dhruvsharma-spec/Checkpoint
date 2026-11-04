'use client';

// The animated orbit on the sign-in page. Pure CSS and SVG; colours come from the theme tokens.
export function OrbitArt() {
  const particles = Array.from({ length: 28 }, (_, i) => ({ left: (i * 37 + 11) % 100, top: (i * 53 + 7) % 100, s: 2 + (i % 3), delay: (i * 0.9) % 9, dur: 7 + (i % 5) * 2 }));
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '-10%', right: '-10%', bottom: 0, height: '50%', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to top,#000 25%,transparent 100%)', maskImage: 'linear-gradient(to top,#000 25%,transparent 100%)' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(var(--gridLine) 1px,transparent 1px),linear-gradient(90deg,var(--gridLine) 1px,transparent 1px)', backgroundSize: '56px 56px', transform: 'perspective(520px) rotateX(62deg)', transformOrigin: '50% 100%', animation: 'gridMove 2.6s linear infinite' }} />
      </div>
      {particles.map((p, i) => <span key={i} className="particle" style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.s, height: p.s, animationDelay: `-${p.delay}s`, animationDuration: `${p.dur}s` }} />)}

      <div id="orb" style={{ position: 'absolute', left: '30%', top: '46%', width: 460, height: 460, margin: '-230px 0 0 -230px', transition: 'transform .25s ease-out' }}>
        <span className="ripple" /><span className="ripple" style={{ animationDelay: '1.5s' }} /><span className="ripple" style={{ animationDelay: '3s' }} />
        <svg width="460" height="460" viewBox="0 0 460 460" style={{ position: 'absolute', inset: 0, animation: 'spin 70s linear infinite' }}><circle cx="230" cy="230" r="224" fill="none" style={{ stroke: 'var(--solid)' }} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 13" strokeLinecap="round" /></svg>
        <svg width="460" height="460" viewBox="0 0 460 460" style={{ position: 'absolute', inset: 0, animation: 'spinRev 26s linear infinite' }}>
          <defs><linearGradient id="og" x1="0" y1="0" x2="460" y2="460" gradientUnits="userSpaceOnUse"><stop offset="0" style={{ stopColor: 'var(--ringA)' }} /><stop offset="1" style={{ stopColor: 'var(--ringB)' }} /></linearGradient></defs>
          <circle cx="230" cy="230" r="182" fill="none" stroke="url(#og)" strokeWidth="3" strokeDasharray="260 90" strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 56, borderRadius: '50%', animation: 'spin 5s linear infinite', background: 'conic-gradient(from 0deg,transparent 0deg,transparent 290deg,var(--glow) 360deg)', WebkitMaskImage: 'radial-gradient(circle,transparent 0 36%,#000 37%)', maskImage: 'radial-gradient(circle,transparent 0 36%,#000 37%)' }} />
        <div style={{ position: 'absolute', inset: 14, animation: 'spin 9s linear infinite' }}><span style={{ position: 'absolute', left: '50%', top: -5, width: 10, height: 10, marginLeft: -5, borderRadius: '50%', background: 'var(--solid)', boxShadow: '0 0 18px 4px var(--solid)' }} /></div>
        <div style={{ position: 'absolute', inset: 66, animation: 'spinRev 14s linear infinite' }}><span style={{ position: 'absolute', left: '50%', bottom: -4, width: 8, height: 8, marginLeft: -4, borderRadius: '50%', background: 'var(--ringB)', boxShadow: '0 0 14px 3px var(--ringB)' }} /></div>
        <div style={{ position: 'absolute', inset: 112, animation: 'spin 20s linear infinite' }}><span style={{ position: 'absolute', right: -3, top: '50%', width: 6, height: 6, marginTop: -3, borderRadius: '50%', background: 'var(--solid)', boxShadow: '0 0 12px 3px var(--solid)' }} /></div>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 150, height: 150, margin: '-75px 0 0 -75px', borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,var(--ringB),var(--ringA))', animation: 'corePulse 3.2s ease-in-out infinite', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="76" height="76" viewBox="0 0 24 24" fill="none"><path className="check" d="M5 12.5l4.5 4.5L19 7" style={{ stroke: 'var(--brandInk)' }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="60" /></svg>
        </div>
      </div>
    </div>
  );
}
