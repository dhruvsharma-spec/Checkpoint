'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { refreshQueue, useApi, useConfirm, useSession, useToast } from '@/lib/hooks';
import { abbr, fromIso, toWindowIso, ymd } from '@/lib/format';
import { Label, MultiSelect, riskColor, type PickOption } from '@/components/ui';
import { ServerPicker } from '@/components/ServerPicker';
import type { Approvers, Catalog, Field, Inventory, Kind, Owner, Risk, Template } from '@/lib/types';

// One page: pick the kind of change (only when there is a choice), then everything else, then send.
const RISKS: Risk[] = ['Low', 'Medium', 'High'];
// Picked from the lists under Approval matrix. LK Tech is picked per service team, in the "Service belongs to" rows.
const PEOPLE = ['LK Platform', 'Security', 'QA', 'DevOps', 'DataOps'] as const;
type PeopleRole = (typeof PEOPLE)[number];
const PICK_LABEL: Record<PeopleRole, string> = { 'LK Platform': 'Platform Approvers', Security: 'Security sign-off', QA: 'QA sign-off', DevOps: 'DevOps executioners', DataOps: 'DataOps executioners' };
const KINDS: [Kind, string][] = [['Approver', 'Approvers'], ['Sign-off', 'Sign-offs'], ['Executioner', 'Executioners']];
// other: a team that is not on the list. Its name is typed, and it has exactly one approver (their email, in approvers[0]).
type ServiceRow = { team: string; approvers: string[]; other?: boolean };
const OTHER_TEAM = '__other';
const noPeople = (): Record<PeopleRole, string[]> => ({ 'LK Platform': [], Security: [], QA: [], DevOps: [], DataOps: [] });
// A name with no email is shown but cannot be picked: nobody could email them.
const toOptions = (owners: Owner[]): PickOption[] => owners.map((o) => ({ value: o.email || `name:${o.name}`, label: o.name, hint: o.email || 'No email present', disabled: !o.email }));
const applies = (f: Field, data: Record<string, string>) => !f.showIf || f.showIf.in.includes(data[f.showIf.k] ?? '');
const RISK_INFO: Record<Risk, string> = { Low: 'Easy to undo, little impact', Medium: 'Some impact if it goes wrong', High: 'Customer or revenue impact possible' };
const EMAIL = /^\S+@\S+\.\S+$/;
const COMPANY = /^[^\s@]+@(lenskart\.com|lenskart\.in)$/i;

const plusHour = (date: string, time: string) => {
  const t = new Date(toWindowIso(date, time)).getTime();
  return isNaN(t) ? { date, time } : fromIso(new Date(t + 3600_000).toISOString());
};

function Input({ f, value, onChange, engine, inv }: { f: Field; value: string; onChange: (v: string) => void; engine?: string; inv?: Inventory | null }) {
  const id = 'ff-' + f.k; const t = f.t ?? 'text';
  if (t === 'yesno') return (
    <div style={{ flex: '1 1 100%', minWidth: 0 }}>
      <div id={id} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>{f.l}</div>
      <div role="radiogroup" aria-labelledby={id} style={{ display: 'flex', gap: 6 }}>
        {['Yes', 'No'].map((v) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className="th" style={{ minHeight: 40, minWidth: 80, padding: '0 18px', border: 0, borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', background: value === v ? 'var(--accent)' : 'var(--fill)', color: value === v ? 'var(--accentInk)' : 'var(--ink)' }}>{v}</button>)}
      </div>
    </div>
  );
  if (t === 'servers') return <div style={{ flex: '1 1 100%', minWidth: 0 }}><Label id={id}>{f.l}</Label><ServerPicker engine={engine ?? ''} value={value} onChange={onChange} inv={inv ?? null} /></div>;
  return (
    <div style={{ flex: f.half ? '1 1 240px' : '1 1 100%', minWidth: 0 }}>
      <Label id={id}>{f.l}{f.opt ? <span style={{ fontWeight: 500 }}> (optional)</span> : null}</Label>
      {t === 'area' ? <textarea id={id} className="inp th" rows={f.rows ?? 3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.ph} />
        : t === 'select' ? <select id={id} className="inp th" value={value || f.opts?.[0]} onChange={(e) => onChange(e.target.value)}>{f.opts?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        : <input id={id} className={'inp th' + (t === 'mono' ? ' mono' : '')} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.ph} />}
    </div>
  );
}

const choiceStyle = (on: boolean, col = 'var(--solid)'): React.CSSProperties => ({
  textAlign: 'left', cursor: 'pointer', padding: '14px 16px', border: 0, borderRadius: 16, color: 'var(--ink)', font: 'inherit',
  background: on ? 'var(--card)' : 'var(--fill)', boxShadow: on ? `inset 0 0 0 2px ${col}` : 'none',
});
const Badge = ({ children, color = 'var(--ok)', bg = 'var(--okBg)' }: { children: React.ReactNode; color?: string; bg?: string }) => (
  <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color }}>{children}</span>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <h3 className="h2" style={{ fontSize: 17 }}>{title}</h3>
    {children}
  </div>
);

export default function NewCcb() {
  const router = useRouter(); const toast = useToast(); const confirm = useConfirm(); const { user } = useSession();
  const { data: cat } = useApi<Catalog>('/templates');
  const { data: lists } = useApi<Approvers>('/approvers');

  // Browser Back and a trackpad swipe leave the form, and leaving it asks first when something is entered.
  const dirtyRef = useRef(false); const leavingRef = useRef(false); const guarded = useRef(false);
  const [key, setKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string[]>([]);

  const [title, setTitle] = useState('');
  const [bu, setBu] = useState('');
  const [env, setEnv] = useState('Production');
  const [owner, setOwner] = useState(user?.email ?? '');
  const d0 = ymd(new Date(Date.now() + 7 * 864e5));
  // "Now" in IST, refreshed every 30 seconds, so a form left open cannot submit a window that has started meanwhile.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const today = ymd(new Date(now)); const nowTime = fromIso(new Date(now).toISOString()).time;
  const [sd, setSd] = useState(d0); const [st, setSt] = useState('23:00');
  const [ed, setEd] = useState(d0); const [et, setEt] = useState('00:00');
  const [risk, setRisk] = useState<Risk | null>(null);
  // Which teams the service belongs to, each with the approvers picked from that team.
  const [service, setService] = useState<ServiceRow[]>([{ team: '', approvers: [] }]);
  const [people, setPeople] = useState<Record<PeopleRole, string[]>>(noPeople);

  const tpl: Template | undefined = cat?.templates.find((t) => t.key === key);
  const enabledList = useMemo(() => (cat?.templates ?? []).filter((t) => t.enabled), [cat]);
  // With only one kind of CCB on offer there is nothing to choose, so the form starts on it.
  const single = enabledList.length === 1;
  dirtyRef.current = (!single && !!key) || title.trim() !== '' || bu !== '' || Object.keys(vals).length > 0 || !!risk || service.some((r) => r.team.trim()) || PEOPLE.some((r) => people[r].length > 0);
  // The database server lists are only fetched for a Database CCB.
  const { data: inv } = useApi<Inventory>(tpl && tpl.fields.some((f) => f.t === 'servers') ? '/inventory' : null);
  const set = (k: string, v: string) => setVals((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    if (guarded.current) return; guarded.current = true;
    // One entry below the first screen catches Back from it, so it can be confirmed instead of just leaving.
    window.history.replaceState({ ...(window.history.state ?? {}), cpStep: -1 }, '');
    window.history.pushState({ cpStep: 0 }, '');
    const onPop = async (e: PopStateEvent) => {
      const s = e.state?.cpStep;
      if (typeof s !== 'number') return;
      if (s >= 0) return;
      if (leavingRef.current) return;
      if (!dirtyRef.current) { leavingRef.current = true; window.history.back(); return; }
      const leave = await confirm({ title: 'Leave and discard this CCB?', body: 'Everything you have entered so far will be lost.', confirmLabel: 'Discard and leave', danger: true });
      if (leave) { leavingRef.current = true; window.history.back(); } else window.history.go(1);
    };
    // Clicking a link in the menu while the form has content asks first too.
    const onClick = async (e: MouseEvent) => {
      if (leavingRef.current || !dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank') return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      const leave = await confirm({ title: 'Leave and discard this CCB?', body: 'Everything you have entered so far will be lost.', confirmLabel: 'Discard and leave', danger: true });
      if (leave) { leavingRef.current = true; router.push(url.pathname + url.search); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current && !leavingRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!single || key || !cat) return;
    setKey(enabledList[0].key);
  }, [single, key, cat, enabledList]);

  // The first time the end is set from the start, and again whenever the start moves past it.
  useEffect(() => { const p = plusHour(d0, '23:00'); setEd(p.date); setEt(p.time); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const moveStart = (d: string, t: string) => {
    setSd(d); setSt(t);
    if (!(new Date(toWindowIso(ed, et)) > new Date(toWindowIso(d, t)))) { const p = plusHour(d, t); setEd(p.date); setEt(p.time); }
  };

  // Platform Approvers: Pratiti is always on it and cannot be removed; more people can be added. She is asked only when
  // she has an email in the Approval matrix, and the backend adds her too.
  const pratiti = lists?.roles.find((r) => r.role === 'LK Platform')?.owners.find((o) => /^pratiti\b/i.test(o.name));
  const pratitiEmail = pratiti?.email ?? '';
  useEffect(() => {
    if (pratitiEmail) setPeople((o) => (o['LK Platform'].includes(pratitiEmail) ? o : { ...o, 'LK Platform': [pratitiEmail, ...o['LK Platform']] }));
  }, [pratitiEmail]);

  // ---- the lists people are picked from ----
  // LK Platform has its own section (Platform Approvers), so it is not offered again as a service team.
  const teams = (lists?.roles.find((r) => r.role === 'LK Tech')?.groups ?? []).filter((g) => g.name !== 'LK Platform');
  const ownersOf = (role: PeopleRole) => lists?.roles.find((r) => r.role === role)?.owners ?? [];
  const nameOf = (email: string) => [...teams.flatMap((g) => g.owners), ...PEOPLE.flatMap(ownersOf)].find((o) => o.email === email)?.name ?? email;
  const setRow = (i: number, row: Partial<ServiceRow>) => setService((rs) => rs.map((r, j) => (j === i ? { ...r, ...row } : r)));
  // Everyone who will be asked, as it stands now, in the order they are listed on the CCB.
  const asked = [
    ...service.filter((r) => r.team.trim() && r.approvers.length && (!r.other || COMPANY.test(r.approvers[0]))).map((r) => ({ kind: 'Approver' as Kind, role: 'LK Tech', label: `LK Tech · ${r.team.trim()}`, emails: r.approvers })),
    ...PEOPLE.filter((r) => people[r].length).map((r) => ({ kind: (lists?.roles.find((x) => x.role === r)?.kind ?? 'Approver') as Kind, role: r as string, label: r === 'LK Platform' ? 'Platform Approvers' : (r as string), emails: people[r] })),
  ];
  const askedCount = asked.reduce((n, a) => n + a.emails.length, 0);
  // Not a decision, a nudge: the highest risk among the template's default and the answers given.
  const suggestedRisk: Risk | null = !tpl || tpl.manual ? null : (['High', 'Medium', 'Low'] as Risk[]).find((r) => r === tpl.defaultRisk || tpl.questions.some((q) => q.opts.find((o) => o.v === vals[q.k])?.risk === r)) ?? null;

  // ---- what is still missing ----
  const detailFields = useMemo(() => (tpl && cat ? [...tpl.fields, ...cat.common].filter((f) => applies(f, vals)) : []), [tpl, cat, vals]);
  const needsNote = (k: string) => !!cat && vals[k] === cat.other && !(vals[`${k}_other`] ?? '').trim();
  const unanswered = (tpl?.questions ?? []).filter((q) => !vals[q.k] || needsNote(q.k));
  const scheduleErrors = [
    title.trim().length < 3 && 'Add a short title',
    !bu && 'Choose the business unit',
    !EMAIL.test(owner.trim()) && 'Enter the system owner’s email',
    (!toWindowIso(sd, st) || !toWindowIso(ed, et)) && 'Fill in the start and end date and time',
    !!toWindowIso(sd, st) && !!toWindowIso(ed, et) && !(new Date(toWindowIso(ed, et)) > new Date(toWindowIso(sd, st))) && 'The change window must end after it starts',
    !!toWindowIso(sd, st) && new Date(toWindowIso(sd, st)).getTime() < Math.floor(now / 60_000) * 60_000 && 'The change window cannot start in the past',
    !risk && 'Choose the risk level',
    service.some((r) => !r.team.trim() && !r.other) && 'Choose the team the service belongs to',
    service.some((r) => r.other && r.team.trim().length < 2) && 'Type the team name',
    service.some((r) => r.other && teams.some((g) => g.name.toLowerCase() === r.team.trim().toLowerCase())) && 'That team is already on the list. Pick it from the list',
    service.some((r) => r.other && !COMPANY.test((r.approvers[0] ?? '').trim())) && 'Type the approver’s lenskart.com or lenskart.in email',
    service.some((r) => !r.other && r.team && r.approvers.length === 0) && 'Pick at least one approver for each team',
  ].filter(Boolean) as string[];
  const missing = detailFields.filter((f) => !f.opt && f.t !== 'select' && !(vals[f.k] ?? '').trim());
  const problems = [...unanswered.map((q) => q.l), ...scheduleErrors, ...missing.map((f) => f.l)];

  const pickType = (t: Template) => {
    if (t.key !== key) { setVals({}); setRisk(null); }
    setKey(t.key); setShowErr(false);
  };

  const submit = async () => {
    if (!tpl) return;
    if (problems.length > 0) { setShowErr(true); toast('A few things are still missing.'); return; }
    if (!risk) return;
    const proceed = await confirm({ title: 'File this CCB?', body: <>{askedCount === 1 ? 'This person is' : `These ${askedCount} people are`} asked, all at once: <b>{asked.map((a) => `${a.label}: ${a.emails.map(nameOf).join(', ')}`).join('; ')}</b>. Each answers on their own, and the change is cleared when all have approved.</>, confirmLabel: 'File CCB' });
    if (!proceed) return;
    setBusy(true); setServerErr([]);
    try {
      const c = await api<{ code: string; approvals: { label: string }[]; notified: number }>('/ccbs', { body: {
        template: tpl.key, title: title.trim(), environment: env, risk, people,
        service: service.map((r) => ({ team: r.team.trim(), approvers: r.approvers.map((e) => e.trim().toLowerCase()), ...(r.other ? { other: true } : {}) })),
        businessUnit: bu, systemOwner: owner.trim(), windowAt: toWindowIso(sd, st), windowEndAt: toWindowIso(ed, et), data: vals,
      } });
      leavingRef.current = true;
      toast(`${c.code} filed. ${c.notified} ${c.notified === 1 ? 'person has' : 'people have'} been emailed.`); refreshQueue(); router.push(`/ccb/${c.code}`);
    } catch (e) { setBusy(false); if (e instanceof ApiError) { setServerErr(e.missing ?? [e.message]); toast(e.message); } }
  };

  const shown = useMemo(() => enabledList.filter((t) => `${t.name} ${t.blurb}`.toLowerCase().includes(search.trim().toLowerCase())), [enabledList, search]);
  const topRef = useRef<HTMLElement>(null);
  if (!cat || !user || !lists) return null;

  // ---------------- pieces ----------------
  const problemsBox = showErr && problems.length > 0 && (
    <div role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--bad)', background: 'var(--badBg)', padding: '10px 14px', borderRadius: 12 }}>Still needed: {problems.join(', ')}</div>
  );
  const serverBox = serverErr.length > 0 && <div role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--bad)', background: 'var(--badBg)', padding: '10px 14px', borderRadius: 12 }}>{serverErr.join(', ')}</div>;

  // The side panel: who will be asked, as it stands now. Everyone listed is asked at the same moment.
  const side = tpl && (
    <aside style={{ flex: '2 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 80 }}>
      <section className="card" style={{ padding: 22 }}>
        <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="breathe" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)' }} />Who is asked</div>
        <div style={{ fontSize: 13, color: 'var(--ink2)', margin: '6px 0 14px' }}>Everyone you pick gets an email as soon as you submit, and can reply separately.</div>
        {asked.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>No one picked yet. Start by choosing your team and its approvers.</div>}
        {KINDS.map(([kind, heading]) => { const list = asked.filter((a) => a.kind === kind); return list.length > 0 && (
          <div key={kind} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 6 }}>{heading}</div>
            {list.map((a) => (
              <div key={a.label} style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 10, fontWeight: 800, background: 'var(--warnBg)', color: 'var(--warn)', boxShadow: 'inset 0 0 0 1.5px var(--warn)' }}>{abbr(a.role)}</span>
                <div><div style={{ fontWeight: 700 }}>{a.label}</div><div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{a.emails.map(nameOf).join(', ')}</div></div>
              </div>
            ))}
          </div>
        ); })}
        {(service.some((r) => r.team.trim()) || risk) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {service.some((r) => r.team.trim()) && <Badge color="var(--ink)" bg="var(--fill)">Service · {service.filter((r) => r.team.trim()).map((r) => r.team.trim()).join(', ')}</Badge>}
            {risk && <Badge color={riskColor(risk)} bg="var(--fill)">{risk} risk</Badge>}
          </div>
        )}
      </section>
    </aside>
  );
  // ---------------- steps ----------------
  const typeCard = (t: Template) => (
    <button key={t.key} className="th lift card" onClick={() => pickType(t)} style={{ textAlign: 'left', cursor: 'pointer', padding: '18px 20px', color: 'var(--ink)', font: 'inherit', minHeight: 110, boxShadow: key === t.key ? 'inset 0 0 0 2px var(--solid)' : undefined }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 16.5, letterSpacing: '-0.03em' }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: t.tone === 'high' ? 'var(--bad)' : 'var(--warn)' }} />{t.name}
      </span>
      <span style={{ display: 'block', color: 'var(--ink2)', marginTop: 8, fontSize: 14, lineHeight: 1.45 }}>{t.blurb}</span>
    </button>
  );
  const grid = (list: Template[]) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>{list.map(typeCard)}</div>;

  let body: React.ReactNode = null;

  if (!tpl && !single) {
    body = (
      <section key="s0" className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ maxWidth: 420 }}><label htmlFor="tsearch" style={{ position: 'absolute', left: -9999 }}>Search change types</label><input id="tsearch" className="inp th" placeholder="Search: dns, database, scaling…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {search.trim()
          ? grid(shown)
          : cat.categories.map((c) => { const list = shown.filter((t) => t.category === c); return list.length ? <div key={c}><div className="eyebrow" style={{ margin: '6px 0 10px' }}>{c}</div>{grid(list)}</div> : null; })}
        {shown.length === 0 && (
          <div className="card" style={{ padding: 22, color: 'var(--ink2)' }}>Nothing matches “{search}”. <button className="btnS btnSm" style={{ marginLeft: 8 }} onClick={() => { const g = cat.templates.find((t) => t.key === 'general'); if (g) pickType(g); }}>Use a General CCB</button></div>
        )}
        <div style={{ fontSize: 13, color: 'var(--ink2)' }}>Red dot: changes that usually carry more risk. Can’t find yours? Pick <b>General</b>: nothing is suggested, you fill in everything yourself.</div>
      </section>
    );
  }

  if (tpl) {
    const q_ = tpl.questions;
    body = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="card rise" style={{ flex: '3 1 560px', minWidth: 0, padding: 26, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Badge color="var(--ink)" bg="var(--fill)">{tpl.name}</Badge>
            <span style={{ flex: 1 }} />
            {!single && <button type="button" className="btnS btnSm" onClick={() => setKey(null)}>Change type</button>}
          </div>
          {q_.length > 0 && (
            <Section title="About the change">
              {q_.map((q) => {
                const picked = vals[q.k]; const opt = q.opts.find((o) => o.v === picked);
                return (
                  <div key={q.k}>
                    <div id={`q-${q.k}`} style={{ fontWeight: 700 }}>{q.q}</div>
                    {q.help && <div style={{ color: 'var(--ink2)', fontSize: 13, marginTop: 2 }}>{q.help}</div>}
                    <div role="radiogroup" aria-labelledby={`q-${q.k}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
                      {q.opts.map((o) => (
                        <button key={o.v} type="button" role="radio" aria-checked={picked === o.v} className="th lift" onClick={() => set(q.k, o.v)} style={{ ...choiceStyle(picked === o.v), fontWeight: 700, fontSize: 14.5, minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          {o.v}{o.risk === 'High' && <Badge color="var(--bad)" bg="var(--badBg)">High risk</Badge>}
                        </button>
                      ))}
                    </div>
                    {picked === cat.other && (
                      <div className="rise" style={{ marginTop: 12 }}>
                        <Label id={`q-${q.k}-other`}>Describe it in a few words</Label>
                        <textarea id={`q-${q.k}-other`} className="inp th" rows={2} value={vals[`${q.k}_other`] ?? ''} onChange={(e) => set(`${q.k}_other`, e.target.value)} placeholder="What exactly is it?" />
                      </div>
                    )}
                    {opt?.hint && <div role="note" style={{ marginTop: 12, padding: '12px 16px', borderRadius: 14, background: 'var(--warnBg)', color: 'var(--warn)', fontWeight: 600, fontSize: 14 }}>Heads up: {opt.hint}</div>}
                  </div>
                );
              })}
            </Section>
          )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><Label id="f-title">Title</Label><input id="f-title" className="inp th" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is changing, in one line?" /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 240px' }}><Label id="f-bu">Business unit</Label><select id="f-bu" className="inp th" value={bu} onChange={(e) => setBu(e.target.value)}><option value="">Choose…</option>{cat.businessUnits.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <div style={{ flex: '1 1 240px' }}>
              <Label id="f-owner">Requestor email</Label>
              <input id="f-owner" type="email" className="inp th" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="name@lenskart.com" />
              {owner.trim().toLowerCase() !== user.email && <button type="button" className="btnS btnSm" style={{ marginTop: 6 }} onClick={() => setOwner(user.email)}>Use my email</button>}
            </div>
          </div>
        </div>

        <Section title="When">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 150px' }}><Label id="f-sd">Window starts</Label><input id="f-sd" type="date" min={today} className="inp th" value={sd} onChange={(e) => moveStart(e.target.value, st)} /></div>
            <div style={{ flex: '1 1 110px' }}><Label id="f-st">Time (IST)</Label><input id="f-st" type="time" min={sd === today ? nowTime : undefined} className="inp th" value={st} onChange={(e) => moveStart(sd, e.target.value)} /></div>
            <div style={{ flex: '1 1 150px' }}><Label id="f-ed">Window ends</Label><input id="f-ed" type="date" min={sd} className="inp th" value={ed} onChange={(e) => setEd(e.target.value)} /></div>
            <div style={{ flex: '1 1 110px' }}><Label id="f-et">Time (IST)</Label><input id="f-et" type="time" className="inp th" value={et} onChange={(e) => setEt(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Environment</div><div style={{ display: 'flex', gap: 6 }}>{cat.environments.map((v) => <button key={v} onClick={() => setEnv(v)} aria-pressed={env === v} className="th" style={{ minHeight: 40, padding: '0 16px', border: 0, borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', background: env === v ? 'var(--accent)' : 'var(--fill)', color: env === v ? 'var(--accentInk)' : 'var(--ink)' }}>{v}</button>)}</div></div>
          </div>
        </Section>

        <Section title="Risk level">
          <div role="radiogroup" aria-label="Risk level" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            {RISKS.map((r) => (
              <button key={r} role="radio" aria-checked={risk === r} className="th lift" onClick={() => setRisk(r)} style={choiceStyle(risk === r, riskColor(r))}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: riskColor(r) }}>{r}{suggestedRisk === r && <Badge>Suggested</Badge>}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink2)', marginTop: 4 }}>{RISK_INFO[r]}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Service belongs to">
          {lists.error && <div role="note" style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 600 }}>{lists.error}</div>}
          {service.map((row, i) => {
            const group = teams.find((g) => g.name === row.team);
            return (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <Label id={`f-team-${i}`}>Team</Label>
                  <select id={`f-team-${i}`} className="inp th" value={row.other ? OTHER_TEAM : row.team} onChange={(e) => (e.target.value === OTHER_TEAM ? setRow(i, { team: '', approvers: [], other: true }) : setRow(i, { team: e.target.value, approvers: [], other: false }))}>
                    <option value="">Choose…</option>
                    {teams.map((g) => <option key={g.name} value={g.name} disabled={g.name !== row.team && service.some((r) => !r.other && r.team === g.name)}>{g.name}</option>)}
                    <option value={OTHER_TEAM}>Other (type a team name)</option>
                  </select>
                </div>
                {row.other ? (
                  <>
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <Label id={`f-oteam-${i}`}>Team name</Label>
                      <input id={`f-oteam-${i}`} className="inp th" value={row.team} onChange={(e) => setRow(i, { team: e.target.value })} placeholder="Your team" maxLength={60} />
                    </div>
                    <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                      <Label id={`f-oapp-${i}`}>Approver (one person)</Label>
                      <input id={`f-oapp-${i}`} type="email" className="inp th" value={row.approvers[0] ?? ''} onChange={(e) => setRow(i, { approvers: [e.target.value] })} placeholder="name@lenskart.com" />
                    </div>
                  </>
                ) : (
                  <div style={{ flex: '2 1 280px', minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Approvers</div>
                    <MultiSelect label={`Approvers from ${row.team || 'this team'}`} values={row.approvers} options={toOptions(group?.owners ?? [])} onChange={(v) => setRow(i, { approvers: v })} placeholder={row.team ? 'Choose approvers…' : 'Choose the team first'} empty={row.team ? 'Nobody listed for this team yet' : 'Choose the team first'} />
                  </div>
                )}
                {service.length > 1 && <button type="button" className="btnS" aria-label={`Remove ${row.team || 'this team'}`} title="Remove this team" onClick={() => setService((rs) => rs.filter((_, j) => j !== i))} style={{ minHeight: 39 }}>✕</button>}
              </div>
            );
          })}
          {service.some((r) => r.other) && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>A team that is not on the list has one approver. Type their email.</div>}
          {service.length < 10 && <div><button type="button" className="btnS btnSm" onClick={() => setService((rs) => [...rs, { team: '', approvers: [] }])}>+ Add another team</button></div>}
        </Section>

        {([['Sign-offs', ['Security', 'QA']], ['Executioners', ['DevOps', 'DataOps']]] as [string, PeopleRole[]][]).map(([heading, roles]) => (
          <Section key={heading} title={heading}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {roles.map((r) => (
                <div key={r} style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>{PICK_LABEL[r]}</div>
                  <MultiSelect label={PICK_LABEL[r]} values={people[r]} options={toOptions(ownersOf(r))} onChange={(v) => setPeople((p) => ({ ...p, [r]: v }))} />
                </div>
              ))}
            </div>
          </Section>
        ))}

        <Section title="Platform Approvers">
          <div style={{ maxWidth: 560 }}><MultiSelect label={PICK_LABEL['LK Platform']} values={people['LK Platform']} options={toOptions(ownersOf('LK Platform'))} locked={pratitiEmail ? [pratitiEmail] : []} onChange={(v) => setPeople((p) => ({ ...p, 'LK Platform': v }))} />
            {pratiti && !pratitiEmail && <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600, marginTop: 8 }}>Pratiti Basu is always part of this, but has no email yet, so she cannot be asked. An admin can add it under Approval matrix.</div>}</div>
        </Section>

          <Section title="Details"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{detailFields.map((f) => <Input key={f.k} f={f} value={vals[f.k] ?? ''} onChange={(v) => set(f.k, v)} engine={vals.engine} inv={inv} />)}</div></Section>
          {problemsBox}
          {serverBox}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 18 }}>
            <span style={{ flex: '1 1 200px', fontSize: 13, color: 'var(--ink2)' }}>Everyone you picked gets an email right away and replies separately.</span>
            <button type="button" className="btnP" disabled={busy} onClick={submit}>{busy ? 'Filing…' : 'Request approval →'}</button>
          </div>
        </section>
        {side}
      </div>
    );
  }
  return (
    <>
      <section ref={topRef} className="rise"><div className="eyebrow">CCB</div><h1 className="h1" style={{ marginTop: 8 }}>New CCB.</h1><div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>{!tpl ? 'What is this change about? Pick the closest match.' : 'Fill this in and request approval.'}</div></section>
      {body}
    </>
  );
}
