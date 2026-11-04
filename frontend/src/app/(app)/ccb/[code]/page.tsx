'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { refreshQueue, useApi, useConfirm, useSession, useToast } from '@/lib/hooks';
import { abbr, ist, whenText } from '@/lib/format';
import { Check, Risk, SectionTitle, StatusPill, TypeBadge } from '@/components/ui';
import type { Approval, Approvers, Catalog, CcbDetail, Field } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// DevOps, DataOps and QA add what they found after the CCB is filed. Anyone listed for the team can write or update it.
const ANALYSIS_TEAMS = ['DevOps', 'DataOps', 'QA'];
const KINDS: [Approval['kind'], string][] = [['Approver', 'Approvers'], ['Sign-off', 'Sign-offs'], ['Executioner', 'Executioners']];
const applies = (f: Field, data: Record<string, string>) => !f.showIf || f.showIf.in.includes(data[f.showIf.k] ?? '');

export default function CcbPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);
  const router = useRouter();
  const { data: c, reload, error } = useApi<CcbDetail>(`/ccbs/${code}`);
  const { data: cat } = useApi<Catalog>('/templates');
  const { data: lists } = useApi<Approvers>('/approvers');
  const { user } = useSession(); const toast = useToast(); const confirm = useConfirm();
  // Which of your steps you are writing a rejection reason for. Approving always opens a confirmation box.
  const [rejecting, setRejecting] = useState<string | null>(null); const [note, setNote] = useState('');
  const [intent, setIntent] = useState<{ decision: string; step: string | null } | null>(null);
  const [comment, setComment] = useState('');
  // The team whose analysis is being written, and the text.
  const [writing, setWriting] = useState<string | null>(null); const [draft, setDraft] = useState('');

  // The Approve and Reject buttons in the email open this page with ?decide=approve&step=<approval id> (or reject).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get('decide');
    if (d === 'approve' || d === 'reject') { setIntent({ decision: d, step: q.get('step') }); window.history.replaceState(null, '', window.location.pathname); }
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); reload(); refreshQueue(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Something went wrong'); }
  };
  const isMe = (a: Approval) => !!user && a.owners.some((o) => o.email === user.email);
  const mine = c && user ? c.approvals.filter((a) => a.status === 'PENDING' && isMe(a)) : [];

  // Nothing here changes anything on a single click: each action asks first.
  const decide = (a: Approval, decision: 'approve' | 'reject') => run(() => api(`/ccbs/${code}/decision`, { body: { decision, id: a.id, note } }).then(() => { setRejecting(null); setNote(''); }), `${a.label} ${decision === 'approve' ? 'approved' : 'rejected'}. The requester has been notified.`);
  const approve = async (a: Approval) => {
    if (!c) return;
    const left = c.approvals.filter((x) => x.status === 'PENDING' && x.id !== a.id).length;
    const ok = await confirm({ title: `Approve as ${a.label}?`, body: <>You approve <b>{c.title}</b> for <b>{a.label}</b>. The requester is told{left ? <>, and {left} other{left === 1 ? '' : 's'} still {left === 1 ? 'has' : 'have'} to answer</> : ', and the change becomes fully approved'}. You cannot undo this.</>, confirmLabel: 'Approve' });
    if (ok) await decide(a, 'approve');
  };
  const remind = async (a: Approval) => {
    const who = a.owners.map((o) => o.name).join(', ') || a.label;
    const ok = await confirm({ title: `Send a reminder to ${who}?`, body: <><b>{who}</b> gets a reminder email about <b>{a.label}</b>. You can send one reminder an hour per step.</>, confirmLabel: 'Send reminder' });
    if (ok) await run(() => api(`/ccbs/${code}/remind`, { body: { id: a.id } }), `Reminder sent to ${who}.`);
  };
  const saveAnalysis = async (team: string) => {
    const text = draft.trim();
    if (text.length < 3) { toast('Write a few words first.'); return; }
    const had = c?.analyses.some((x) => x.team === team);
    const ok = await confirm({ title: `${had ? 'Update' : 'Add'} the ${team} analysis?`, body: <>Everyone on this CCB can read it{had ? ', and it replaces the one there now' : ''}. It is recorded in the audit trail.</>, confirmLabel: had ? 'Update analysis' : 'Add analysis' });
    if (ok) await run(() => api(`/ccbs/${code}/analysis`, { method: 'PUT', body: { team, body: text } }).then(() => { setWriting(null); setDraft(''); }), `${team} analysis saved.`);
  };
  const close = async (result: 'landed' | 'rolled_back') => {
    const out = result === 'landed';
    const ok = await confirm({ title: out ? `Mark ${code} as rolled out?` : `Mark ${code} as rolled back?`, body: out ? 'This records that the change was rolled out successfully and closes it.' : 'This records that the change was rolled back and closes it.', confirmLabel: out ? 'Yes, rolled out' : 'Yes, rolled back', danger: !out });
    if (ok) await run(() => api(`/ccbs/${code}/implementation`, { body: { result } }), out ? `${code} marked as rolled out.` : `${code} marked as rolled back.`);
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${code}?`, body: <>This permanently deletes <b>{c?.title}</b> with its approvals and comments. A record that you deleted it is kept in the audit log. You cannot undo this.</>, confirmLabel: 'Delete CCB', danger: true });
    if (!ok) return;
    try { await api(`/ccbs/${code}`, { method: 'DELETE' }); toast(`${code} deleted.`); refreshQueue(); router.push('/ccb'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete'); }
  };

  // An email button names the step it is for. Without one, it works when you own exactly one waiting step.
  useEffect(() => {
    if (!intent || !c || !user) return;
    setIntent(null);
    const pick = intent.step ? mine.find((a) => a.id === intent.step) : mine.length === 1 ? mine[0] : undefined;
    if (pick) { if (intent.decision === 'reject') setRejecting(pick.id); else approve(pick); }
    else if (c.status !== 'Awaiting') toast(`${c.code} is ${c.status.toLowerCase()}, so there is nothing to decide.`);
    else toast(mine.length > 1 ? 'You have more than one step on this change. Use the buttons under Your steps.' : 'You are not listed for a step on this change that is still waiting.');
  }, [intent, c, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error?.status === 404) return <div className="card" style={{ padding: 30 }}>This CCB does not exist. <Link href="/ccb" style={{ color: 'var(--solid)' }}>Back to all CCBs</Link></div>;
  if (!c || !cat || !user) return null;
  const tpl = cat.templates.find((t) => t.key === c.type);
  const w = ist(c.windowAt);
  const we = c.windowEndAt ? ist(c.windowEndAt) : null;
  const canDelete = user.access !== 'member';
  const rejectingStep = mine.find((a) => a.id === rejecting);
  const onTeam = (team: string) => !!lists?.roles.find((r) => r.role === team)?.owners.some((o) => o.email && o.email === user.email);

  const row = (k: string, v: string | null | undefined, mono = false): [string, string, boolean] => [k, v || '—', mono];
  const win = `${w.dayName} ${w.dn} ${w.mon}, ${w.time}${we ? ` → ${we.dayName} ${we.dn} ${we.mon}, ${we.time}` : ''} IST`;
  // Older CCBs were asked other things (reason, impact, ...): those are shown when present, never asked again.
  const details = [
    ...(tpl?.questions ?? []).map((q) => row(q.l, c.data[q.k] === cat.other && c.data[`${q.k}_other`] ? `${cat.other}: ${c.data[`${q.k}_other`]}` : c.data[q.k])),
    ...[...(tpl?.fields ?? []), ...(cat.common ?? [])].filter((f) => applies(f, c.data)).map((f) => row(f.l, c.data[f.k], f.t === 'mono')),
    ...(cat.legacy ?? []).filter((f) => c.data[f.k]).map((f) => row(f.l, c.data[f.k])),
  ];
  const sections = [
    { title: 'Schedule and service', rows: [row('Requested by', `${c.requester.name} (${c.requester.email})`), row('Requestor email', c.systemOwner), row('Business unit', c.businessUnit), row('Service belongs to', c.ownerTeam), row('Environment', c.environment), row('Change window', win), row('Date of request', whenText(c.createdAt).split(' · ')[0])] },
    { title: 'Details', rows: details },
  ].filter((s) => s.rows.length > 0);

  // One card per executioner or approver. Everyone is asked at the same time, and each card says where they are.
  const stepCard = (a: Approval) => {
    const done = a.status === 'APPROVED', rej = a.status === 'REJECTED', waiting = a.status === 'PENDING' && c.status === 'Awaiting';
    const names = a.owners.map((o) => o.name).join(', ');
    return (
      <div key={a.id} className="th" style={{ flex: '1 1 230px', minWidth: 0, padding: '14px 16px', borderRadius: 16, background: done ? 'var(--okBg)' : rej ? 'var(--badBg)' : 'var(--fill)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 10.5, fontWeight: 800, ...(done ? { background: 'var(--accent)', color: 'var(--accentInk)' } : rej ? { background: 'var(--badBg)', color: 'var(--bad)', boxShadow: 'inset 0 0 0 1.5px var(--bad)' } : waiting ? { background: 'var(--warnBg)', color: 'var(--warn)', boxShadow: 'inset 0 0 0 1.5px var(--warn)' } : { background: 'var(--card)', color: 'var(--ink2)' }) }}>{done ? <Check size={16} /> : abbr(a.role)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{a.label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: done ? 'var(--ok)' : rej ? 'var(--bad)' : waiting ? 'var(--warn)' : 'var(--ink2)' }}>{done ? `Approved by ${a.decidedBy ?? '—'}` : rej ? `Rejected by ${a.decidedBy ?? '—'}` : waiting ? 'Pending' : 'Not answered'}</div>
          </div>
        </div>
        {a.note && <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 8 }}>“{a.note}”</div>}
        {a.status === 'PENDING' && (
          <div style={{ fontSize: 12.5, color: a.owners.length ? 'var(--ink2)' : 'var(--bad)', marginTop: 8 }}>{a.owners.length ? <>Waiting on <b style={{ color: 'var(--ink)' }}>{names}</b></> : 'Nobody with an email is listed, so no one can answer. Add an email under Approval matrix.'}</div>
        )}
        {waiting && !isMe(a) && <button className="btnS btnSm" style={{ marginTop: 10 }} onClick={() => remind(a)}>Send reminder…</button>}
      </div>
    );
  };
  const group = (title: string, list: Approval[]) => list.length > 0 && (
    <div key={title}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{list.map(stepCard)}</div>
    </div>
  );
  const pendingNow = c.approvals.filter((a) => a.status === 'PENDING');

  return (
    <>
      <div><Link className="btnS btnSm" href="/ccb" style={{ textDecoration: 'none' }}>← All CCBs</Link></div>
      <section className="card rise" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}><span className="mono" style={{ color: 'var(--ink2)' }}>{c.code}</span><TypeBadge t={c.typeName} /><StatusPill s={c.status} /><Risk r={c.risk} suffix=" risk" /></div>
            <h1 className="h1" style={{ fontSize: 35, marginTop: 12 }}>{c.title}</h1>
            <div style={{ color: 'var(--ink2)', marginTop: 6 }}>Requested by {c.requester.name} on {whenText(c.createdAt).split(' · ')[0]} · {c.environment}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="eyebrow">Change window starts · IST</div>
            <div className="num" style={{ fontSize: 30, marginTop: 6 }}>{w.dayName} {w.dn} {w.mon}</div>
            <div className="num" style={{ fontSize: 30, color: 'var(--ink2)' }}>{w.time}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{canDelete && <button className="btnD btnSm" onClick={remove}>Delete CCB…</button>}<button className="btnS btnSm" onClick={() => { navigator.clipboard?.writeText(location.href).catch(() => {}); toast(`Link to ${c.code} copied.`); }}>Copy link</button></div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--line)', paddingTop: 20 }}>
          {c.status === 'Awaiting' && pendingNow.length > 0 && <div style={{ fontWeight: 600 }}>Waiting on {pendingNow.length} of {c.approvals.length}: <span style={{ color: 'var(--warn)' }}>{pendingNow.map((a) => a.label).join(', ')}</span></div>}
          {KINDS.map(([kind, title]) => group(title, c.approvals.filter((a) => a.kind === kind)))}
        </div>

        {c.status === 'Awaiting' && mine.length > 0 && (
          <div className="th" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px', borderRadius: 18, background: 'var(--fill)' }}>
            <div style={{ fontWeight: 700 }}>Your {mine.length === 1 ? 'step' : 'steps'}</div>
            {mine.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span style={{ flex: '1 1 220px', fontWeight: 600 }}>{a.label}</span>
                {rejecting === a.id ? (
                  <><input className="inp" aria-label="Reason for rejecting" autoFocus style={{ flex: '2 1 240px', width: 'auto' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejecting this change" /><button className="btnD" onClick={() => decide(a, 'reject')}>Confirm reject</button><button className="btnS" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button></>
                ) : (
                  <><button className="btnD" onClick={() => { setRejecting(a.id); setNote(''); }}>Reject…</button><button className="btnP" onClick={() => approve(a)}>Approve…</button></>
                )}
              </div>
            ))}
            {rejectingStep && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Rejecting stops the whole change until it is updated and filed again.</div>}
          </div>
        )}
        {c.status === 'Cleared' && (
          <div className="th" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '14px 18px', borderRadius: 18, background: 'var(--okBg)' }}>
            <span style={{ flex: '1 1 240px', fontWeight: 600 }}>Post-implementation review: was the change implemented successfully?</span>
            <button className="btnD" onClick={() => close('rolled_back')}>No, rolled back…</button><button className="btnP" onClick={() => close('landed')}>Yes, rolled out…</button>
          </div>
        )}
      </section>

      <div style={{ columns: '380px', columnGap: 16 }}>
        {sections.map((s) => (
          <section key={s.title} className="card" style={{ breakInside: 'avoid', marginBottom: 16, padding: '20px 22px', display: 'block' }}>
            <div style={{ marginBottom: 4 }}><SectionTitle title={s.title} /></div>
            {s.rows.map(([k, v, mono]) => (
              <div key={k} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink2)' }}>{k}</div>
                <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', ...(mono ? { fontFamily: "'JetBrains Mono',monospace", fontSize: 13, wordBreak: 'break-word' } : {}) }}>{v}</div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <section className="card" style={{ padding: '20px 22px' }}>
        <div style={{ marginBottom: 4 }}><SectionTitle title="Analysis" /></div>
        <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 6 }}>Added by DevOps, DataOps and QA after the CCB is filed. Anyone listed for the team can write it.</div>
        {ANALYSIS_TEAMS.map((team) => {
          const a = c.analyses.find((x) => x.team === team);
          return (
            <div key={team} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink2)', flex: 1 }}>{team} analysis</span>
                {onTeam(team) && writing !== team && <button className="btnS btnSm" onClick={() => { setWriting(team); setDraft(a?.body ?? ''); }}>{a ? 'Edit' : 'Add analysis'}</button>}
              </div>
              {writing === team ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <label htmlFor={`an-${team}`} style={{ position: 'absolute', left: -9999 }}>{team} analysis</label>
                  <textarea id={`an-${team}`} className="inp th" rows={4} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What you checked, what you found, anything to watch during the change" />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btnS" onClick={() => { setWriting(null); setDraft(''); }}>Cancel</button><button className="btnP" onClick={() => saveAnalysis(team)}>Save…</button></div>
                </div>
              ) : a ? (
                <>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>{a.by} · {whenText(a.at)}</div>
                </>
              ) : <div style={{ marginTop: 4, color: 'var(--ink2)' }}>Not added yet.</div>}
            </div>
          );
        })}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '3 1 440px', minWidth: 0, padding: 22 }}>
          <h2 className="h2" style={{ fontSize: 18, marginBottom: 10 }}>Discussion</h2>
          {c.comments.map((m) => <div key={m.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}><div style={{ fontSize: 12.5, color: 'var(--ink2)' }}><b style={{ color: 'var(--ink)' }}>{m.who}</b> · {whenText(m.at)}</div><div style={{ marginTop: 2 }}>{m.body}</div></div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <label htmlFor="cm" style={{ position: 'absolute', left: -9999 }}>Add a comment</label>
            <input id="cm" className="inp th" style={{ flex: '1 1 220px', width: 'auto' }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment for the approvers" />
            <button className="btnP" onClick={() => comment.trim() && run(() => api(`/ccbs/${code}/comments`, { body: { body: comment } }).then(() => setComment('')), 'Comment posted.')}>Post</button>
          </div>
        </section>
        <section className="card" style={{ flex: '2 1 300px', minWidth: 0, padding: 22 }}>
          <h2 className="h2" style={{ fontSize: 18, marginBottom: 10 }}>Audit trail</h2>
          {c.audit.map((a) => <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13.5 }}><span style={{ flex: 1 }}>{a.text}</span><span style={{ fontSize: 12, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{whenText(a.at)}</span></div>)}
        </section>
      </div>
    </>
  );
}
