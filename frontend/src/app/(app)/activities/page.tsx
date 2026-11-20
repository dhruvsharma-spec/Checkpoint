'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi, useConfirm, useSession, useToast } from '@/lib/hooks';
import { ymd, whenText } from '@/lib/format';
import type { ActivitiesPage, Activity } from '@/lib/types';

const DEFAULT_TEAMS = ['DevOps', 'DataOps', 'Security', 'Other'];

function ActivityRow({ a, onDelete }: { a: Activity; onDelete?: () => void }) {
  const start = whenText(a.startsAt);
  const end = whenText(a.endsAt);
  const sameDay = start.split(' · ')[0] === end.split(' · ')[0];
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '14px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: '0 0 150px', fontSize: 13 }}>
        <div style={{ fontWeight: 700 }}>{start.split(' · ')[0]}</div>
        <div style={{ color: 'var(--ink2)', fontSize: 12.5 }}>
          {start.split(' · ')[1]} → {sameDay ? end.split(' · ')[1] : end}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>{a.title}</div>
          {a.team && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--fill)', color: 'var(--ink2)' }}>{a.team}</span>}
        </div>
        {a.summary && <div style={{ fontSize: 13.5, color: 'var(--ink2)', marginTop: 2 }}>{a.summary}</div>}
        <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 4 }}>Logged by {a.createdBy.name}</div>
      </div>
      {onDelete && <button className="btnD btnSm" onClick={onDelete} aria-label={`Delete ${a.title}`}>Delete</button>}
    </div>
  );
}

export default function ActivitiesPage() {
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<ActivitiesPage>('/activities');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => ymd(new Date()), []);
  const nowTime = useMemo(() => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    return `${g('hour')}:${g('minute')}`;
  }, []);
  const [form, setForm] = useState({
    title: '', summary: '',
    startDate: today, startTime: '10:00',
    endDate: today, endTime: '11:00',
    teamChoice: 'DevOps', teamOther: '',
  });

  if (!user) return null;
  const insight = data?.insight;
  const teams = (data?.teams?.length ? data.teams : DEFAULT_TEAMS).filter((t) => t !== 'QA' && t !== 'Platform');
  const canDelete = user.access === 'power' || user.access === 'admin';

  const del = async (a: Activity) => {
    const ok = await confirm({ title: `Delete “${a.title}”?`, body: 'It disappears from Activities and the calendar. You cannot undo this.', confirmLabel: 'Delete activity', danger: true });
    if (!ok) return;
    try { await api(`/activities/${a.id}`, { method: 'DELETE' }); toast('Activity deleted'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete'); }
  };

  const submit = async () => {
    if (form.title.trim().length < 3) return toast('Give the activity a short title.');
    if (form.summary.trim().length < 3) return toast('Add the details.');
    const team = form.teamChoice === 'Other' ? form.teamOther.trim() : form.teamChoice;
    if (form.teamChoice === 'Other' && team.length < 2) return toast('Type the team name.');
    if (!form.startDate || !form.startTime || !form.endDate || !form.endTime) return toast('Pick start and end date and time.');
    if (form.startDate < today || (form.startDate === today && form.startTime < nowTime)) return toast('Start must be now or in the future.');
    if (form.endDate < form.startDate) return toast('End date cannot be before the start date.');
    if (form.endDate === form.startDate && form.endTime <= form.startTime) return toast('End time must be after the start.');
    const startsAt = new Date(`${form.startDate}T${form.startTime}:00+05:30`).toISOString();
    const endsAt = new Date(`${form.endDate}T${form.endTime}:00+05:30`).toISOString();
    setBusy(true);
    try {
      await api('/activities', { method: 'POST', body: { title: form.title.trim(), summary: form.summary.trim(), team, startsAt, endsAt } });
      toast('Activity logged');
      setOpen(false);
      setForm({ title: '', summary: '', startDate: today, startTime: '10:00', endDate: today, endTime: '11:00', teamChoice: 'DevOps', teamOther: '' });
      reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div className="eyebrow">Activities</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Organisation level Activities.</h1>
        </div>
        <button className="btnP" onClick={() => setOpen(true)}>Log activity</button>
      </section>

      <div className="rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, animationDelay: '.04s' }}>
        {[
          { label: 'Upcoming', value: insight?.upcomingCount ?? '—' },
          { label: 'Recent (14 days)', value: insight?.recentCount ?? '—' },
          { label: 'Next up', value: insight?.next?.title ?? 'None scheduled' },
        ].map((k) => (
          <div key={k.label} className="card" style={{ padding: '16px 18px' }}>
            <div className="eyebrow">{k.label}</div>
            <div style={{ marginTop: 8, fontWeight: 700, fontSize: typeof k.value === 'number' ? 28 : 15, letterSpacing: '-0.03em', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <section className="card rise" style={{ padding: '8px 22px 18px', animationDelay: '.08s' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 0 4px' }}>
            <h2 className="h2" style={{ fontSize: 18, flex: 1 }}>Coming up</h2>
            <Link href="/ccb/calendar" className="btnS btnSm" style={{ textDecoration: 'none' }}>Calendar</Link>
          </div>
          {(data?.upcoming ?? []).length === 0 && <div style={{ padding: '16px 0', color: 'var(--ink2)' }}>Nothing upcoming.</div>}
          {(data?.upcoming ?? []).map((a) => <ActivityRow key={a.id} a={a} onDelete={canDelete ? () => del(a) : undefined} />)}
        </section>
        <section className="card rise" style={{ padding: '8px 22px 18px', animationDelay: '.12s' }}>
          <h2 className="h2" style={{ fontSize: 18, padding: '14px 0 4px' }}>Recent past</h2>
          {(data?.recent ?? []).length === 0 && <div style={{ padding: '16px 0', color: 'var(--ink2)' }}>No activities in the last two weeks.</div>}
          {(data?.recent ?? []).map((a) => <ActivityRow key={a.id} a={a} onDelete={canDelete ? () => del(a) : undefined} />)}
        </section>
      </div>

      {open && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(15,16,32,.45)' }}>
          <div role="dialog" aria-modal="true" aria-label="Log activity" className="card rise" style={{ width: 'min(560px, 100%)', padding: 26, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 className="h2" style={{ flex: 1, fontSize: 22 }}>Log activity</h2>
              <button className="btnS btnSm" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            <div>
              <label htmlFor="act-title" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Title</label>
              <input id="act-title" className="inp th" value={form.title} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. DR drill for payments" autoFocus />
            </div>

            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Team</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {teams.map((t) => (
                  <button key={t} type="button" className="th" onClick={() => setForm((f) => ({ ...f, teamChoice: t }))}
                    style={{ minHeight: 34, padding: '0 12px', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: form.teamChoice === t ? 'var(--accent)' : 'var(--fill)', color: form.teamChoice === t ? 'var(--accentInk)' : 'var(--ink)' }}>{t}</button>
                ))}
              </div>
              {form.teamChoice === 'Other' && (
                <input className="inp th" style={{ marginTop: 10 }} value={form.teamOther} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, teamOther: e.target.value }))} placeholder="Type the team name" />
              )}
            </div>

            <div>
              <label htmlFor="act-sum" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Details</label>
              <textarea id="act-sum" className="inp th" rows={3} value={form.summary} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} placeholder="What is happening, who is involved, and why" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 12, background: 'var(--fill)' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Start</div>
                <label htmlFor="act-sdate" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>Date (IST)</label>
                <input id="act-sdate" type="date" className="inp th" min={today} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} />
                <label htmlFor="act-stime" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', margin: '10px 0 4px' }}>Time</label>
                <input id="act-stime" type="time" className="inp th" min={form.startDate === today ? nowTime : undefined} value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div style={{ padding: 14, borderRadius: 12, background: 'var(--fill)' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>End</div>
                <label htmlFor="act-edate" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>Date (IST)</label>
                <input id="act-edate" type="date" className="inp th" min={form.startDate || today} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                <label htmlFor="act-etime" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', margin: '10px 0 4px' }}>Time</label>
                <input id="act-etime" type="time" className="inp th" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <button className="btnS" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btnP" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Log activity'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
