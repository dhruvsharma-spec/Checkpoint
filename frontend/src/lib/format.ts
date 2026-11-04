const TZ = 'Asia/Kolkata';

export function ist(d: string | Date) {
  const x = new Date(d);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(x);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dayName: g('weekday'), dn: g('day'), mon: g('month'), time: `${g('hour')}:${g('minute')}`, ymd: ymd(x) };
}
export const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
// Returns '' for an empty or half-typed date or time, instead of throwing while the form re-renders.
export const toWindowIso = (date: string, time: string) => { const d = new Date(`${date}T${time}:00+05:30`); return isNaN(d.getTime()) ? '' : d.toISOString(); };
export const whenText = (d: string | Date) => { const p = ist(d); return `${p.dayName} ${p.dn} ${p.mon} · ${p.time} IST`; };

export const ABBR: Record<string, string> = { 'LK Tech': 'LKT', 'LK Platform': 'PLT', Development: 'LKT', Platform: 'PLT', QA: 'QA', DevOps: 'OPS', DataOps: 'DAT', Security: 'SEC', 'Engineering Head': 'ENG' };
export const abbr = (role: string) => ABBR[role] ?? role.slice(0, 3).toUpperCase();
// A change window is stored as an instant; the forms work in IST wall-clock date and time.
export const fromIso = (iso: string) => { const p = ist(iso); return { date: p.ymd, time: p.time }; };
