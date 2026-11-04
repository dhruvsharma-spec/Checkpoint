'use client';
import { useEffect, useRef } from 'react';
import { BrandMark, DevLogin, ErrorNote, GoogleMark } from './parts';
import { STEPS, type Flow } from './useLoginFlow';

// Iris geometry: six wireframe blades around a hexagonal opening.
const R_IN = 74, R_OUT = 214;
const pt = (r: number, deg: number) => { const a = (deg * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)] as const; };
function bladePath() {
  const v0 = pt(R_IN, -90), v1 = pt(R_IN, -30);
  const dx = v1[0] - v0[0], dy = v1[1] - v0[1];
  // extend the hexagon edge until it meets the outer circle
  const b = v0[0] * dx + v0[1] * dy, c = v0[0] ** 2 + v0[1] ** 2 - R_OUT ** 2, d = dx * dx + dy * dy;
  const t = (-b + Math.sqrt(b * b - d * c)) / d;
  const e = [v0[0] + t * dx, v0[1] + t * dy] as const;
  const eDeg = (Math.atan2(e[1], e[0]) * 180) / Math.PI;
  const o = pt(R_OUT, eDeg + 52);
  const w = pt(R_IN, -150);
  return `M${v0[0]} ${v0[1]} L${e[0]} ${e[1]} A${R_OUT} ${R_OUT} 0 0 1 ${o[0]} ${o[1]} L${w[0]} ${w[1]} Z`;
}
const BLADE = bladePath();
const TICKS = Array.from({ length: 120 }, (_, i) => i);

export function AperturePage({ flow }: { flow: Flow }) {
  const root = useRef<HTMLDivElement>(null);
  // This page is dark only, whatever theme was chosen inside the app.
  useEffect(() => { document.documentElement.dataset.theme = 'dark'; }, []);
  const move = (e: React.PointerEvent) => {
    const el = root.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', String((e.clientX - r.left) / r.width - 0.5));
    el.style.setProperty('--py', String((e.clientY - r.top) / r.height - 0.5));
  };
  const loading = flow.phase === 'loading';

  return (
    <div ref={root} className={`lgA th${loading ? ' is-loading' : ''}`} onPointerMove={move}>
      <div className="lgA-art" aria-hidden="true">
        <div className="lgA-tilt">
          <svg viewBox="-300 -300 600 600" className="lgA-svg">
            <defs>
              <radialGradient id="aCore"><stop offset="0" stopColor="var(--a)" stopOpacity=".95" /><stop offset=".45" stopColor="var(--b)" stopOpacity=".35" /><stop offset="1" stopColor="var(--b)" stopOpacity="0" /></radialGradient>
              <linearGradient id="aBlade" x1="0" y1="-1" x2="1" y2="1"><stop offset="0" stopColor="var(--a)" stopOpacity=".28" /><stop offset="1" stopColor="var(--b)" stopOpacity=".04" /></linearGradient>
            </defs>
            <circle className="lgA-core" r="170" fill="url(#aCore)" />
            <g className="lgA-ticks">
              {TICKS.map((i) => <line key={i} x1="0" y1="-282" x2="0" y2={i % 10 === 0 ? -264 : i % 5 === 0 ? -270 : -275} transform={`rotate(${i * 3})`} />)}
            </g>
            <circle r="250" className="lgA-ring" />
            <circle r="236" className="lgA-ring lgA-dash" />
            <g className="lgA-blades">
              {[0, 1, 2, 3, 4, 5].map((i) => <g key={i} transform={`rotate(${i * 60})`}><path className="lgA-blade" d={BLADE} /></g>)}
            </g>
            <circle r="74" className="lgA-hole" />
            <path className="lgA-check" d="M-22 2l15 15L24 -16" />
          </svg>
        </div>
      </div>

      <header className="lgA-top">
        <span className="lgA-brand"><BrandMark id="lgaB" size={30} /><span>Checkpoint</span></span>
      </header>

      <p className="lgA-claim">Every launch passes through one gate.</p>

      <main className="lgA-panel">
        <div className="lgA-panelIn">
          {loading ? (
            <div aria-live="polite" className="lgA-load">
              <h1>Opening the gate</h1>
              <p>{flow.msg}</p>
              <ol>
                {STEPS.map((l, i) => {
                  const done = flow.step > i, active = flow.step === i;
                  return <li key={l} className={done ? 'done' : active ? 'active' : ''}><i aria-hidden="true">{done ? '✓' : ''}</i>{l}</li>;
                })}
              </ol>
            </div>
          ) : (
            <>
              <h1>Sign in</h1>
              <p className="lgA-sub">Use your Lenskart Google account.</p>
              <button type="button" className="lgA-g" onClick={flow.google}><GoogleMark />Continue with Google</button>
              <ErrorNote flow={flow} />
              <p className="lgA-note">Access is limited to {flow.domains} accounts.</p>
              <DevLogin flow={flow} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
