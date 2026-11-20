'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Ccb, Status } from '@/lib/types';
import { abbr } from '@/lib/format';

const PILL: Record<Status, [string, string]> = { Awaiting: ['--warnBg', '--warn'], Cleared: ['--okBg', '--ok'], Rejected: ['--badBg', '--bad'], 'Rolled out': ['--fill', '--ink'], 'Rolled back': ['--badBg', '--bad'] };

export const StatusPill = ({ s }: { s: Status }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: `var(${PILL[s][0]})`, color: `var(${PILL[s][1]})` }}>{s}</span>
);
export const TypeBadge = ({ t }: { t: string }) => (
  <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--fill)', color: 'var(--ink)' }}>{t}</span>
);
export const riskColor = (r: string) => (r === 'High' ? 'var(--bad)' : r === 'Medium' ? 'var(--warn)' : 'var(--ok)');
export const Risk = ({ r, suffix = '' }: { r: string; suffix?: string }) => <span style={{ fontSize: 14, fontWeight: 700, color: riskColor(r) }}>{r}{suffix}</span>;

export function Segs({ c }: { c: Ccb }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {c.approvals.map((a) => <span key={a.role} style={{ display: 'inline-block', width: 20, height: 6, borderRadius: 3, background: a.status === 'APPROVED' ? 'var(--solid)' : a.status === 'REJECTED' ? 'var(--bad)' : 'var(--track)' }} />)}
    </span>
  );
}

export const Check = ({ size = 18, w = 2.8 }: { size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);

export function Node({ role, status, mine, size = 40 }: { role: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; mine?: boolean; size?: number }) {
  const done = status === 'APPROVED', held = status === 'REJECTED';
  const base: React.CSSProperties = { width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 11, fontWeight: 800 };
  const look: React.CSSProperties = done ? { background: 'var(--accent)', color: 'var(--accentInk)' } : held ? { background: 'var(--badBg)', color: 'var(--bad)', boxShadow: 'inset 0 0 0 1.5px var(--bad)' } : { background: 'var(--warnBg)', color: 'var(--warn)', boxShadow: 'inset 0 0 0 1.5px var(--warn)' + (mine ? ', 0 0 0 5px var(--warnBg)' : '') };
  return <span className="pop" style={{ ...base, ...look }}>{done ? <Check /> : abbr(role)}</span>;
}

export const SectionTitle = ({ n, title }: { n?: string; title: string }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
    {n && <span className="mono" style={{ color: 'var(--label)' }}>{n}</span>}
    <h3 className="h2" style={{ fontSize: 17 }}>{title}</h3>
  </div>
);

export const Label = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <label htmlFor={id} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 5 }}>{children}</label>
);

export const chip = (on: boolean): React.CSSProperties => ({ minHeight: 34, padding: '0 12px', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background-color .2s,color .2s', background: on ? 'var(--accent)' : 'var(--fill)', color: on ? 'var(--accentInk)' : 'var(--ink)' });

// A filter that stays closed until it is needed: a button showing the current choice, and a list that
// opens under it. Closes on a click elsewhere or Esc. Arrow keys move through the list.
export type DropdownOption = { value: string; label: string; count?: number };
export function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: DropdownOption[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    // Put the focus on the chosen row so the arrow keys work straight away.
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={root} style={{ position: 'relative' }} onKeyDown={onKey}>
      <button type="button" className="th" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 12px', border: '1px solid var(--inLine)', borderRadius: 10, background: 'var(--inBg)', color: 'var(--ink)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}>
        <span style={{ color: 'var(--ink2)' }}>{label}</span>
        <span style={{ fontWeight: 700 }}>{current?.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={id} role="listbox" aria-label={label} className="card rise" style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 6px)', left: 0, minWidth: 230, maxHeight: 340, overflowY: 'auto', padding: 6, boxShadow: 'var(--liftShadow)' }}>
          {options.map((o) => {
            const on = o.value === current?.value;
            return (
              <button key={o.value} type="button" role="option" aria-selected={on} className="nav th" onClick={() => { onChange(o.value); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 38, padding: '0 12px', border: 0, borderRadius: 10, background: on ? 'var(--fill)' : 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 14, fontWeight: on ? 700 : 500, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.count !== undefined && <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{o.count}</span>}
                <span style={{ width: 16, color: 'var(--solid)', visibility: on ? 'visible' : 'hidden' }}><Check size={15} /></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pick several from a list. A button shows what is picked; the list opens under it and stays open while you tick.
// Closes on a click elsewhere or Esc. An option can be shown but not pickable (for example a name with no email).
export type PickOption = { value: string; label: string; hint?: string; disabled?: boolean };
// locked: values that are always picked and cannot be unticked.
export function MultiSelect({ label, values, options, onChange, placeholder = 'Choose…', empty = 'Nobody listed yet', locked = [] }: { label: string; values: string[]; options: PickOption[]; onChange: (v: string[]) => void; placeholder?: string; empty?: string; locked?: string[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const picked = options.filter((o) => values.includes(o.value));
  const toggle = (v: string) => locked.includes(v) ? undefined : onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div ref={root} style={{ position: 'relative', minWidth: 0 }}>
      <button type="button" className="th" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 39, padding: '5px 12px', boxSizing: 'border-box', border: '1px solid var(--inLine)', borderRadius: 14, background: 'var(--inBg)', color: 'var(--ink)', font: 'inherit', fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {picked.length === 0 && <span style={{ color: 'var(--ink2)' }}>{placeholder}</span>}
          {picked.map((o) => <span key={o.value} title={locked.includes(o.value) ? 'Always included' : undefined} style={{ padding: '2px 9px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: 'var(--fill)' }}>{locked.includes(o.value) ? '🔒 ' : ''}{o.label}</span>)}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={id} role="listbox" aria-multiselectable="true" aria-label={label} className="card rise" style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 6px)', left: 0, right: 0, minWidth: 220, maxHeight: 300, overflowY: 'auto', padding: 6, boxShadow: 'var(--liftShadow)' }}>
          {options.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink2)' }}>{empty}</div>}
          {options.map((o) => {
            const on = values.includes(o.value);
            return (
              <button key={o.value} type="button" role="option" aria-selected={on} aria-disabled={o.disabled || locked.includes(o.value)} disabled={o.disabled} className="nav th" onClick={() => toggle(o.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 38, padding: '4px 10px', border: 0, borderRadius: 10, background: on ? 'var(--fill)' : 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 14, textAlign: 'left', cursor: o.disabled ? 'not-allowed' : locked.includes(o.value) ? 'default' : 'pointer', opacity: o.disabled ? 0.5 : 1 }}>
                <span aria-hidden="true" style={{ width: 18, height: 18, flex: 'none', borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--accent)' : 'transparent', color: 'var(--accentInk)', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--inLine)' }}>{on && <Check size={12} w={3} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontWeight: on ? 700 : 500 }}>{o.label}</span>{o.hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--ink2)' }}>{o.hint}</span>}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
