'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi, useConfirm, useSession, useToast } from '@/lib/hooks';
import { whenText } from '@/lib/format';
import type { Access, Rbac } from '@/lib/types';

const LEVELS: { v: Access; label: string; what: string }[] = [
  { v: 'member', label: 'Member', what: 'can file and manage CCBs, but cannot delete them' },
  { v: 'power', label: 'Power user', what: 'can also delete CCBs' },
  { v: 'admin', label: 'Admin', what: 'can also delete CCBs, edit approvers and change access' },
];
const COMPANY = /^[^\s@]+@(lenskart\.com|lenskart\.in)$/i;

// Everyone can see this page. Only admins can change it, and every change asks first.
// People are added to this list on their own the first time they sign in with Google.
export default function RbacPage() {
  const { user } = useSession(); const toast = useToast(); const confirm = useConfirm();
  const { data, reload } = useApi<Rbac>('/rbac');
  const isAdmin = user?.access === 'admin';
  const [add, setAdd] = useState({ name: '', email: '', access: 'member' as Access });
  if (!data || !user) return null;

  const change = async (u: Rbac['users'][number], next: Access) => {
    if (next === u.access) return;
    const label = LEVELS.find((l) => l.v === next)!;
    const ok = await confirm({
      title: `Change access for ${u.name}?`,
      body: <>{u.email} goes from <b>{LEVELS.find((l) => l.v === u.access)?.label}</b> to <b>{label.label}</b>, who {label.what}. It applies straight away.</>,
      confirmLabel: `Make ${label.label}`, danger: next === 'admin',
    });
    if (!ok) return;
    try { await api(`/rbac/users/${u.id}`, { method: 'PATCH', body: { access: next } }); toast(`${u.email} is now ${label.label.toLowerCase()}.`); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change access'); }
  };

  const addUser = async () => {
    if (add.name.trim().length < 2) { toast('Enter the person’s name.'); return; }
    if (!COMPANY.test(add.email.trim())) { toast('Only lenskart.com and lenskart.in emails can be added.'); return; }
    const label = LEVELS.find((l) => l.v === add.access)!;
    const ok = await confirm({ title: `Add ${add.name.trim()}?`, body: <>{add.email.trim()} is added as <b>{label.label}</b>, who {label.what}. They sign in with Google using that email.</>, confirmLabel: 'Add person', danger: add.access === 'admin' });
    if (!ok) return;
    try { await api('/rbac/users', { body: { name: add.name.trim(), email: add.email.trim(), access: add.access } }); toast(`${add.email.trim()} added.`); setAdd({ name: '', email: '', access: 'member' }); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add the person'); }
  };

  const cols = 'minmax(220px,1.4fr) minmax(160px,1fr) 300px';
  return (
    <>
      <section className="rise">
        <div className="eyebrow">Access Management</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Users and access.</h1>
      </section>

      <section className="card rise" style={{ overflowX: 'auto', animationDelay: '.05s' }}>
        <div style={{ minWidth: 860, padding: '4px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, padding: '14px 22px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: 'var(--ink2)', textTransform: 'uppercase' }}><span>Person</span><span>Approves</span><span>Access</span></div>
          {data.users.map((u) => (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, alignItems: 'center', padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
              <div><div style={{ fontWeight: 700 }}>{u.name}</div><div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{u.email}{u.lastLoginAt ? ` · last seen ${whenText(u.lastLoginAt).split(' · ')[0]}` : ' · has not signed in yet'}</div></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{u.approves.length ? u.approves.map((r) => <span key={r} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: 'var(--fill)' }}>{r}</span>) : <span style={{ fontSize: 13, color: 'var(--ink2)' }}>Not an approver</span>}</div>
              <div role="radiogroup" aria-label={`Access for ${u.name}`} style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: 'var(--fill)' }}>
                {LEVELS.map((l) => {
                  const on = u.access === l.v; const locked = !isAdmin || u.id === user.id;
                  return <button key={l.v} role="radio" aria-checked={on} disabled={locked && !on} title={u.id === user.id ? 'You cannot change your own access' : !isAdmin ? 'Only admins can change access' : undefined} onClick={() => !locked && change(u, l.v)} className="th" style={{ flex: 1, minHeight: 32, border: 0, borderRadius: 999, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', cursor: locked ? 'default' : 'pointer', background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accentInk)' : 'var(--ink2)', opacity: locked && !on ? 0.5 : 1 }}>{l.label}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && (
        <section className="card rise" style={{ padding: 22, animationDelay: '.1s' }}>
          <h2 className="h2" style={{ fontSize: 18, marginBottom: 14 }}>Add a person</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 200px' }}><label htmlFor="a-name" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 5 }}>Name</label><input id="a-name" className="inp th" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></div>
            <div style={{ flex: '1 1 240px' }}><label htmlFor="a-email" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 5 }}>Work email</label><input id="a-email" type="email" className="inp th" placeholder="name@lenskart.com" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></div>
            <div style={{ flex: '0 1 160px' }}><label htmlFor="a-acc" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 5 }}>Access</label><select id="a-acc" className="inp th" value={add.access} onChange={(e) => setAdd({ ...add, access: e.target.value as Access })}>{LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}</select></div>
            <button className="btnP" onClick={addUser}>Add person…</button>
          </div>
        </section>
      )}
    </>
  );
}
