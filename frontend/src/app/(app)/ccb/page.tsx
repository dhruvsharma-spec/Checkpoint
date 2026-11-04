'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { ist } from '@/lib/format';
import { Dropdown, DropdownOption, Risk, Segs, StatusPill, TypeBadge } from '@/components/ui';
import type { Catalog, Ccb, Status } from '@/lib/types';

const STATUSES: Status[] = ['Awaiting', 'Cleared', 'Rejected', 'Rolled out', 'Rolled back'];
const COLS = '104px minmax(240px,1fr) 130px 150px 90px 80px 110px 118px 22px';

export default function CcbList() {
  const [type, setType] = useState('All');
  const [status, setStatus] = useState('All');
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useApi<Ccb[]>(`/ccbs?${new URLSearchParams(dq ? { q: dq } : {})}`);
  const { data: catalog } = useApi<Catalog>('/templates');
  const all = data ?? [];
  // Counts follow the search box, so each option shows what picking it would leave.
  const inType = (c: Ccb) => type === 'All' || c.type === type;
  const inStatus = (c: Ccb) => status === 'All' || c.status === status;
  const rows = all.filter((c) => inType(c) && inStatus(c));
  const typeOptions: DropdownOption[] = [{ value: 'All', label: 'All types', count: all.filter(inStatus).length }, ...(catalog?.templates ?? []).map((t) => ({ value: t.key, label: t.name, count: all.filter((c) => c.type === t.key && inStatus(c)).length }))];
  const statusOptions: DropdownOption[] = [{ value: 'All', label: 'Any status', count: all.filter(inType).length }, ...STATUSES.map((s) => ({ value: s, label: s, count: all.filter((c) => c.status === s && inType(c)).length }))];
  const filtered = type !== 'All' || status !== 'All';

  return (
    <>
      <section className="rise">
        <div className="eyebrow">CCB</div>
        <h1 className="h1" style={{ marginTop: 8 }}>All CCBs.</h1>
        <div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>Every change, its status and who still needs to clear it.</div>
      </section>
      <div className="rise" style={{ position: 'relative', zIndex: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', animationDelay: '.05s' }}>
        <div style={{ flex: '1 1 260px', maxWidth: 340 }}><label htmlFor="lq" style={{ position: 'absolute', left: -9999 }}>Filter CCBs</label><input id="lq" className="inp th" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ID, title, requester" /></div>
        <Dropdown label="Type" value={type} options={typeOptions} onChange={setType} />
        <Dropdown label="Status" value={status} options={statusOptions} onChange={setStatus} />
        {filtered && <button className="btnS btnSm" onClick={() => { setType('All'); setStatus('All'); }}>Clear filters</button>}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink2)' }}>{rows.length} of {all.length} CCBs</span>
      </div>
      <section className="card rise" style={{ overflowX: 'auto', animationDelay: '.1s' }}>
        <div style={{ minWidth: 1060, padding: '4px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '14px 22px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: 'var(--ink2)', textTransform: 'uppercase' }}><span>CCB</span><span>Change</span><span>Type</span><span>Window</span><span>Env</span><span>Risk</span><span>Approvals</span><span>Status</span><span /></div>
          {rows.map((c) => { const p = ist(c.windowAt); return (
            <Link key={c.code} href={`/ccb/${c.code}`} className="row th" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '14px 22px', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)' }}>
              <span className="mono" style={{ color: 'var(--ink2)' }}>{c.code}</span>
              <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em' }}>{c.title}</span><span style={{ display: 'block', color: 'var(--ink2)', fontSize: 12.5 }}>{c.requester.name} · {c.ownerTeam}</span></span>
              <span><TypeBadge t={c.typeName} /></span>
              <span style={{ fontSize: 13.5 }}><span style={{ fontWeight: 700 }}>{p.dayName} {p.dn} {p.mon}</span><span style={{ display: 'block', color: 'var(--ink2)', fontSize: 12.5 }}>{p.time} IST</span></span>
              <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{c.environment}</span>
              <Risk r={c.risk} />
              <Segs c={c} />
              <span><StatusPill s={c.status} /></span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>); })}
          {data && rows.length === 0 && <div style={{ padding: '28px 22px', color: 'var(--ink2)' }}>No CCBs match these filters.</div>}
        </div>
      </section>
    </>
  );
}
