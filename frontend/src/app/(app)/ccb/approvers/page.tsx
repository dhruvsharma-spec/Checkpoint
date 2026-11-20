'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi, useConfirm, useSession, useToast } from '@/lib/hooks';
import type { ApproverRole, Approvers, Owner } from '@/lib/types';

// LK Tech (one list per service team) approves; Infrastructure & Platform is its own last section.
// Security and QA sign off; DevOps and DataOps execute. Stored role key for the last section is still "LK Platform".
const GROUPED = 'LK Tech';
const PLATFORM = 'LK Platform';
const KINDS: [ApproverRole['kind'], string][] = [['Approver', 'Approvers'], ['Sign-off', 'Sign-offs'], ['Executioner', 'Executioners']];
const COMPANY = /^[^\s@]+@(lenskart\.com|lenskart\.in)$/i;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const key = (o: Owner) => o.email || `name:${o.name.toLowerCase()}`;
const same = (a: Owner[], b: Owner[]) => a.length === b.length && a.every((o, i) => o.name === b[i].name && o.email === b[i].email);

type Target = { role: string; team: string | null; isNew?: boolean };

const letters = (name: string) => { const w = name.split(/[\s/]+/).filter(Boolean); return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join('') : (w[0] ?? '?')[0]).toUpperCase(); };

function ListCard({ title, owners, canEdit, onEdit }: { title: string; owners: Owner[]; canEdit: boolean; onEdit: () => void }) {
  return (
    <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 12, fontWeight: 700, background: 'var(--fill)', color: 'var(--ink2)' }}>{letters(title)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 1 }}>{owners.length} {owners.length === 1 ? 'person' : 'people'}</div>
        </div>
        {canEdit && <button className="btnS btnSm" onClick={onEdit} aria-label={`Edit ${title}`}>Edit</button>}
      </div>
      {owners.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink2)', paddingTop: 4 }}>No one listed</div>}
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 148, overflowY: 'auto' }}>
        {owners.map((o, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 11.5, color: o.email ? 'var(--ink2)' : 'var(--warn)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.email || 'No email'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Editor({ target, owners, others, onClose, onSave, onDeleteTeam }: { target: Target; owners: Owner[]; others: string[]; onClose: () => void; onSave: (teamName: string, owners: Owner[]) => Promise<boolean>; onDeleteTeam?: () => void }) {
  const toast = useToast(); const confirm = useConfirm();
  const [rows, setRows] = useState<Owner[]>(() => clone(owners));
  const [teamName, setTeamName] = useState(target.team ?? '');
  const [busy, setBusy] = useState(false);
  const isTeam = target.role === GROUPED;
  const title = isTeam ? (target.isNew ? 'New service team' : `Edit ${target.team}`) : target.role === PLATFORM ? 'Edit Infrastructure & Platform' : `Edit ${target.role}`;
  const clean = rows.map((r) => ({ name: r.name.trim(), email: r.email.trim().toLowerCase() }));
  const renamed = isTeam && !target.isNew && teamName.trim() !== target.team;
  const dirty = renamed || !same(clean, owners) || (!!target.isNew && teamName.trim() !== '');

  const ask = async () => { if (!dirty || await confirm({ title: 'Discard your changes?', body: 'Nothing has been saved yet.', confirmLabel: 'Discard', danger: true })) onClose(); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') ask(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<Owner>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const problem = () => {
    if (isTeam) {
      const n = teamName.trim();
      if (n.length < 2) return 'Give the team a name.';
      if (others.some((t) => t.toLowerCase() === n.toLowerCase())) return 'There is already a team with that name.';
    }
    const seen = new Set<string>();
    for (const r of clean) {
      if (!r.name) return 'Every person needs a name. Remove the empty row.';
      if (r.email && !COMPANY.test(r.email)) return `${r.name}: use a lenskart.com or lenskart.in email, or leave it empty.`;
      if (seen.has(key(r))) return `${r.name} is listed twice.`;
      seen.add(key(r));
    }
    return '';
  };

  const save = async () => {
    const p = problem();
    if (p) return toast(p);
    const before = new Set(owners.map(key)), after = new Set(clean.map(key));
    const added = clean.filter((o) => !before.has(key(o))).length, removed = owners.filter((o) => !after.has(key(o))).length;
    const edited = clean.filter((o, i) => owners[i] && !same([o], [owners[i]]) && !(added && !before.has(key(o)))).length;
    const bits = [added && `${added} added`, removed && `${removed} removed`, edited && `${edited} edited`, renamed && `team renamed to ${teamName.trim()}`].filter(Boolean).join(', ') || 'No change to the people';
    const saveName = isTeam ? teamName.trim() : (target.role === PLATFORM ? 'Infrastructure & Platform' : target.role);
    const ok = await confirm({ title: `Save ${saveName}?`, body: <>{bits}. New CCBs and reminders use this list straight away, and anyone removed stops being asked. CCBs already filed keep the people they were filed with.</>, confirmLabel: 'Save changes' });
    if (!ok) return;
    setBusy(true);
    const done = await onSave(teamName.trim(), clean);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) ask(); }} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,16,32,.45)' }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card rise" style={{ width: 'min(520px, 100vw)', height: '100%', borderRadius: 0, padding: 26, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 className="h2" style={{ flex: 1, fontSize: 22 }}>{title}</h2>
          <button className="btnS btnSm" onClick={ask} aria-label="Close">✕</button>
        </div>

        {isTeam && (
          <div>
            <label htmlFor="team-name" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Team name</label>
            <input id="team-name" className="inp th" value={teamName} maxLength={60} autoFocus={!!target.isNew} onChange={(e) => setTeamName(e.target.value)} placeholder="For example, Checkout" />
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)' }}>People</span>
            <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Only people with an email can be asked</span>
          </div>
          {rows.length === 0 && <div style={{ padding: '10px 0', color: 'var(--ink2)', fontSize: 14 }}>No one yet. Add the first person below.</div>}
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
              <input className="inp th" aria-label={`Name, person ${i + 1}`} placeholder="Name" style={{ flex: '1 1 140px', width: 'auto' }} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
              <input className="inp th" type="email" aria-label={`Email, person ${i + 1}`} placeholder="Email (optional)" style={{ flex: '2 1 190px', width: 'auto' }} value={r.email} onChange={(e) => set(i, { email: e.target.value })} />
              <button className="btnD btnSm" aria-label={`Remove ${r.name || `person ${i + 1}`}`} title="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}><button className="btnS btnSm" onClick={() => setRows((rs) => [...rs, { name: '', email: '' }])}>+ Add person</button></div>
        </div>

        <div style={{ flex: 1 }} />
        {isTeam && !target.isNew && onDeleteTeam && <div><button className="btnD btnSm" onClick={onDeleteTeam}>Delete this team…</button></div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <button className="btnS" onClick={ask}>Cancel</button>
          <button className="btnP" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save…'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ApproversPage() {
  const { user } = useSession(); const toast = useToast(); const confirm = useConfirm();
  const { data, reload } = useApi<Approvers>('/approvers');
  const [target, setTarget] = useState<Target | null>(null);
  if (!data || !user) return null;
  if (user.access !== 'admin') return <div className="card rise" style={{ padding: 30 }}><h1 className="h2">Admins only.</h1><div style={{ color: 'var(--ink2)', marginTop: 6 }}>The Approval matrix is managed by admins. Ask one to add or change a name.</div></div>;
  const canEdit = data.writable;
  const teams = data.roles.find((r) => r.role === GROUPED)?.groups ?? [];
  const platform = data.roles.find((r) => r.role === PLATFORM);

  const put = async (change: (roles: ApproverRole[]) => void, ok: string) => {
    const next = clone(data.roles); change(next);
    try {
      await api('/approvers', { method: 'PUT', body: { roles: next.map((r) => (r.role === GROUPED ? { role: r.role, groups: r.groups ?? [] } : { role: r.role, owners: r.owners })) } });
      toast(ok); reload(); return true;
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save'); return false; }
  };
  const save = (t: Target) => (teamName: string, owners: Owner[]) => put((roles) => {
    const r = roles.find((x) => x.role === t.role)!;
    if (t.role === GROUPED) {
      if (t.isNew) r.groups = [...(r.groups ?? []), { name: teamName, owners }];
      else r.groups = (r.groups ?? []).map((g) => (g.name === t.team ? { name: teamName, owners } : g));
    } else r.owners = owners;
  }, 'Saved. New CCBs use this list now.');
  const deleteTeam = (t: Target) => async () => {
    const ok = await confirm({ title: `Delete the team ${t.team}?`, body: <>{t.team} is removed from the list of service teams, so it can’t be picked on new CCBs. CCBs already filed keep it.</>, confirmLabel: 'Delete team', danger: true });
    if (ok && await put((roles) => { const r = roles.find((x) => x.role === GROUPED)!; r.groups = (r.groups ?? []).filter((g) => g.name !== t.team); }, `${t.team} deleted.`)) setTarget(null);
  };

  const editing = target && (target.role === GROUPED ? (target.isNew ? [] : teams.find((g) => g.name === target.team)?.owners) : data.roles.find((r) => r.role === target.role)?.owners);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <section>
        <div className="eyebrow">CCB</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Approval matrix.</h1>
        <div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>Who approves, signs off and executes. Open a list to change it.</div>
      </section>

      {data.error && <div role="alert" className="card" style={{ padding: '14px 18px', background: 'var(--badBg)', color: 'var(--bad)', fontWeight: 600 }}>{data.error}</div>}
      {!data.writable && !data.error && <div className="card" style={{ padding: '12px 18px', color: 'var(--ink2)', fontSize: 14 }}>The approvers file can’t be written from here, so it can only be viewed.</div>}

      {KINDS.map(([kind, heading]) => {
        const roles = data.roles.filter((r) => r.kind === kind && r.role !== PLATFORM);
        if (roles.length === 0) return null;
        return (
          <section key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h2 className="eyebrow" style={{ margin: 0 }}>{heading}</h2>
              {kind === 'Approver' && <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{teams.length} service teams</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, alignItems: 'start' }}>
              {roles.flatMap((r) => r.role === GROUPED
                ? (r.groups ?? []).map((g) => <ListCard key={`t-${g.name}`} title={g.name} owners={g.owners} canEdit={canEdit} onEdit={() => setTarget({ role: GROUPED, team: g.name })} />)
                : [<ListCard key={r.role} title={r.role} owners={r.owners} canEdit={canEdit} onEdit={() => setTarget({ role: r.role, team: null })} />])}
              {kind === 'Approver' && canEdit && (
                <button className="card th" onClick={() => setTarget({ role: GROUPED, team: null, isNew: true })} style={{ minHeight: 96, border: '1.5px dashed var(--line)', background: 'transparent', color: 'var(--ink2)', fontWeight: 600, fontSize: 14, cursor: 'pointer', font: 'inherit' }}>+ Add a service team</button>
              )}
            </div>
          </section>
        );
      })}

      {platform && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="eyebrow" style={{ margin: 0, flex: 1 }}>Infrastructure & Platform</h2>
            {canEdit && <button className="btnS btnSm" onClick={() => setTarget({ role: PLATFORM, team: null })} aria-label="Edit Infrastructure & Platform">Edit</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, alignItems: 'start' }}>
            {platform.owners.length === 0 && (
              <div className="card" style={{ padding: 16, color: 'var(--ink2)', fontSize: 13.5 }}>No one listed</div>
            )}
            {platform.owners.map((o) => (
              <section key={key(o)} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 12, fontWeight: 700, background: 'var(--fill)', color: 'var(--ink2)' }}>{letters(o.name)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em' }}>{o.name}</div>
                    <div style={{ fontSize: 12, color: o.email ? 'var(--ink2)' : 'var(--warn)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.email || 'No email'}</div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      {target && editing && (
        <Editor key={`${target.role}/${target.team ?? ''}/${target.isNew ? 'new' : ''}`} target={target} owners={editing} others={teams.filter((g) => g.name !== target.team).map((g) => g.name)} onClose={() => setTarget(null)} onSave={save(target)} onDeleteTeam={target.team ? deleteTeam(target) : undefined} />
      )}
    </div>
  );
}
