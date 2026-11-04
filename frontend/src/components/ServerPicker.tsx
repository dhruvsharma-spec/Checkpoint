'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, DropdownOption } from './ui';
import type { Inventory } from '@/lib/types';

// The servers a Database CCB is about. For MySQL: pick a type (Master, Slave, ...), optionally a group, then the IPs.
// For MongoDB: pick a cluster, then a role in it, then the IPs. Any other engine, or any IP that is not in the list,
// is typed. The chosen servers are saved as one line each: "ip — label", or just "ip" when typed.

type Entry = { ip: string; label: string };
type Candidate = { ip: string; label: string; sub: string };
const SEP = ' — ';
export const parseServers = (v: string): Entry[] => v.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(SEP); return i < 0 ? { ip: l, label: '' } : { ip: l.slice(0, i), label: l.slice(i + SEP.length) }; });
const serialize = (e: Entry[]) => e.map((x) => (x.label ? `${x.ip}${SEP}${x.label}` : x.ip)).join('\n');
const VALID = /^[A-Za-z0-9._:-]{3,100}$/;
const ROLE_ORDER = ['Master', 'Slave', 'Proxy', 'Standalone', 'Other'];

// A text box that offers the matching servers as you click or type, and also accepts one that is not in the list.
function IpBox({ candidates, chosen, onAdd, placeholder }: { candidates: Candidate[]; chosen: Set<string>; onAdd: (e: Entry[]) => void; placeholder: string }) {
  const [text, setText] = useState(''); const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const free = candidates.filter((c) => !chosen.has(c.ip));
  const q = text.trim().toLowerCase();
  const shown = q ? free.filter((c) => c.ip.includes(q) || c.sub.toLowerCase().includes(q)) : free;
  const addTyped = () => {
    const ip = text.trim();
    if (!ip) return;
    if (!VALID.test(ip)) { setErr('Enter an IP address or a host name.'); return; }
    if (chosen.has(ip)) { setErr('That server is already added.'); return; }
    const known = candidates.find((c) => c.ip === ip);
    onAdd([{ ip, label: known?.label ?? '' }]); setText(''); setErr('');
  };
  return (
    <div ref={root} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="inp th mono" aria-label="Add a server by IP" placeholder={placeholder} value={text} autoComplete="off"
          onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setErr(''); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } else if (e.key === 'Escape') setOpen(false); }} />
        <button type="button" className="btnS" onClick={addTyped}>Add</button>
      </div>
      {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--bad)', marginTop: 5 }}>{err}</div>}
      {open && free.length > 0 && (
        <div role="listbox" aria-label="Servers" className="card rise" style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 6px)', left: 0, right: 0, maxHeight: 280, overflowY: 'auto', padding: 6, boxShadow: 'var(--liftShadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px 6px', fontSize: 12, color: 'var(--ink2)' }}>
            <span style={{ flex: 1 }}>{shown.length} server{shown.length === 1 ? '' : 's'}{q ? ' match' : ''}. Click to add, or type one that is not listed.</span>
            {shown.length > 1 && <button type="button" className="btnS btnSm" onClick={() => { onAdd(shown.map((c) => ({ ip: c.ip, label: c.label }))); setText(''); }}>Add all {shown.length}</button>}
          </div>
          {shown.map((c) => (
            <button key={c.ip} type="button" role="option" aria-selected={false} className="nav th" onClick={() => onAdd([{ ip: c.ip, label: c.label }])}
              style={{ display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', minHeight: 36, padding: '4px 10px', border: 0, borderRadius: 10, background: 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 13.5, textAlign: 'left', cursor: 'pointer' }}>
              <span className="mono" style={{ flex: '0 0 auto', fontWeight: 700 }}>{c.ip}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--ink2)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
            </button>
          ))}
          {shown.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink2)' }}>No listed server matches. Press Enter to add “{text.trim()}” anyway.</div>}
        </div>
      )}
    </div>
  );
}

// engine: the engine already answered on the form (Database CCB). Where nothing has asked, such as Planned Downtime or
// Instance Resize, the picker asks for the engine itself.
export function ServerPicker({ engine, value, onChange, inv }: { engine: string; value: string; onChange: (v: string) => void; inv: Inventory | null }) {
  const [own, setOwn] = useState('');
  const eng = engine || own;
  const kind = /^mysql/i.test(eng) ? 'mysql' : /mongo/i.test(eng) ? 'mongodb' : null;
  const [role, setRole] = useState(''); const [group, setGroup] = useState(''); const [cluster, setCluster] = useState('');
  // Another engine means another list, so the earlier choices no longer apply.
  useEffect(() => { setRole(''); setGroup(''); setCluster(''); }, [kind]);
  const chosen = parseServers(value);
  const set = useMemo(() => new Set(chosen.map((c) => c.ip)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (e: Entry[]) => onChange(serialize([...chosen, ...e.filter((x) => !set.has(x.ip))]));

  let controls: React.ReactNode = null;
  let candidates: Candidate[] = [];
  let placeholder = 'Type an IP address or host name, then press Enter';

  if (kind === 'mysql' && inv) {
    const all = inv.mysql.groups.flatMap((g) => g.servers.map((s) => ({ ...s, group: g.name })));
    const roles = ROLE_ORDER.filter((r) => all.some((s) => s.role === r));
    const byRole = role ? all.filter((s) => s.role === role) : [];
    const groupNames = inv.mysql.groups.map((g) => g.name).filter((n) => byRole.some((s) => s.group === n));
    const g = groupNames.includes(group) ? group : '';
    const typeOpts: DropdownOption[] = [{ value: '', label: 'Choose…' }, ...roles.map((r) => ({ value: r, label: r, count: all.filter((s) => s.role === r).length }))];
    const groupOpts: DropdownOption[] = [{ value: '', label: 'All groups', count: byRole.length }, ...groupNames.map((n) => ({ value: n, label: n, count: byRole.filter((s) => s.group === n).length }))];
    const seen = new Set<string>();
    candidates = byRole.filter((s) => (!g || s.group === g) && !seen.has(s.ip) && !!seen.add(s.ip)).map((s) => ({ ip: s.ip, label: [s.group, s.role].join(', '), sub: [s.instance || s.dns || s.label, s.group].filter(Boolean).join(' · ') }));
    controls = <><Dropdown label="MySQL type" value={role} options={typeOpts} onChange={(v) => { setRole(v); setGroup(''); }} />{role && <Dropdown label="Group" value={g} options={groupOpts} onChange={setGroup} />}</>;
    placeholder = role ? `Pick a ${role.toLowerCase()} below, or type an IP` : 'Choose a type first, or type an IP';
  } else if (kind === 'mongodb' && inv) {
    const c = inv.mongodb.clusters.find((x) => x.name === cluster);
    const roles = c ? Array.from(new Set(c.servers.map((s) => s.role))) : [];
    const r = roles.includes(role) ? role : '';
    const clusterOpts: DropdownOption[] = [{ value: '', label: 'Choose…' }, ...inv.mongodb.clusters.map((x) => ({ value: x.name, label: x.name, count: x.servers.length }))];
    const roleOpts: DropdownOption[] = [{ value: '', label: 'All roles', count: c?.servers.length }, ...roles.map((x) => ({ value: x, label: x, count: c!.servers.filter((s) => s.role === x).length }))];
    candidates = c ? c.servers.filter((s) => !r || s.role === r).map((s) => ({ ip: s.ip, label: `${c.name}, ${s.role}`, sub: `${c.name} · ${s.role}` })) : [];
    controls = <><Dropdown label="Cluster" value={cluster} options={clusterOpts} onChange={(v) => { setCluster(v); setRole(''); }} />{c && <Dropdown label="Role" value={r} options={roleOpts} onChange={setRole} />}</>;
    placeholder = c ? `Pick a server in ${c.name} below, or type an IP` : 'Choose a cluster first, or type an IP';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {kind && !inv && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Loading the server list…</div>}
      {inv && inv.errors.length > 0 && kind && <div role="alert" style={{ fontSize: 12.5, color: 'var(--warn)' }}>{inv.errors.join(' ')} You can still type servers.</div>}
      {(!engine || controls) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, position: 'relative', zIndex: 3 }}>
          {!engine && <Dropdown label="Database" value={own} options={[{ value: '', label: 'Choose…' }, { value: 'MySQL', label: 'MySQL' }, { value: 'MongoDB', label: 'MongoDB' }, { value: 'Other', label: 'Other' }]} onChange={(v) => { setOwn(v); }} />}
          {controls}
        </div>
      )}
      <IpBox candidates={candidates} chosen={set} onAdd={add} placeholder={placeholder} />
      {chosen.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chosen.map((c) => (
            <span key={c.ip} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '0 6px 0 12px', borderRadius: 999, background: 'var(--okBg)', color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>
              <span className="mono" style={{ fontWeight: 700 }}>{c.ip}</span>{c.label && <span style={{ fontSize: 12, opacity: 0.85 }}>{c.label}</span>}
              <button type="button" aria-label={`Remove ${c.ip}`} onClick={() => onChange(serialize(chosen.filter((x) => x.ip !== c.ip)))} style={{ width: 22, height: 22, border: 0, borderRadius: '50%', background: 'rgba(0,0,0,.08)', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
