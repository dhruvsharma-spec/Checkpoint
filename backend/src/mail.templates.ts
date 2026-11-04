import { cfg } from './config';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' });
// "Wed, 05 Aug 2026, 14:12 IST", built from parts so it does not depend on the locale's punctuation.
const when = (d: Date) => {
  const p = Object.fromEntries(FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} IST`;
};

// One person asked about the change (who is empty on older CCBs, where a whole role was asked).
export type MailStage = { id: string; stage: number; role: string; label: string; who: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' };
export type CcbMail = {
  code: string; title: string; typeName: string; risk: string; environment: string;
  businessUnit: string; ownerTeam: string; devTeam: string;
  requester: { name: string; email: string }; systemOwner: string;
  windowAt: Date; windowEndAt: Date | null;
  data: Record<string, string>;
  // The template-specific answers, already labelled and in form order.
  details: { l: string; v: string }[];
  stages: MailStage[];
};
const link = (code: string) => `${cfg.webUrl}/ccb/${encodeURIComponent(code)}`;

// Text sections shown above and below the template details, in this order.
// The first group is only found on older CCBs.
const BEFORE: [string, string][] = [['reason', 'Reason for change'], ['desc', 'Description'], ['impact', 'Impact'], ['qaPlan', 'Testing / QA plan'], ['analysis', 'DevOps/DataOps analysis']];
const AFTER: [string, string][] = [['tested', 'Tested in a lower environment'], ['testedWhy', 'Why it was not tested in a lower environment'], ['riskNote', 'Risk associated with the change'], ['systems', 'Systems affected'], ['rollback', 'Rollback plan']];

const C = { ink: '#0F1626', mute: '#5B6475', line: '#E4E6EC', bg: '#F4F3EE', head: '#0E1726', blue: '#2F6BE0' };
const RISK: Record<string, [string, string]> = { High: ['#FDE8E8', '#B42318'], Medium: ['#FEF1D6', '#9A5B00'], Low: ['#E3F6E8', '#1E6B34'] };
const LABEL = `font-size:11px;font-weight:700;letter-spacing:.12em;color:${C.mute};text-transform:uppercase`;

const pill = (text: string, bg: string, fg: string) => `<span style="display:inline-block;margin:0 0 6px 0;padding:6px 12px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;line-height:1.2">${esc(text)}</span>`;

// Everyone listed is asked at the same time, so these are side by side, not in a sequence. "you" marks the step this
// email is for.
function stepper(stages: MailStage[], focus?: number) {
  return stages.map((s) => {
    const done = s.status === 'APPROVED', rej = s.status === 'REJECTED', me = s.stage === focus && !done && !rej;
    const [bg, fg, suffix] = done ? ['#E3F6E8', '#1E6B34', ' — approved'] : rej ? ['#FDE8E8', '#B42318', ' — rejected'] : me ? [C.blue, '#FFFFFF', ' — you'] : ['#F1F2F5', C.mute, ' — pending'];
    return pill(`${s.label}${s.who ? ` · ${s.who}` : ''}${suffix}`, bg, fg).replace('margin:0 0 6px 0', 'margin:0 8px 6px 0');
  }).join('');
}

const kv = (rows: [string, string, boolean?][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.filter(([, v]) => v).map(([k, v, isMail]) =>
    `<tr><td valign="top" style="padding:7px 16px 7px 0;width:170px;${LABEL}">${esc(k)}</td><td valign="top" style="padding:7px 0;font-size:15px;color:${C.ink};word-break:break-word;white-space:pre-wrap">${isMail ? `<a href="mailto:${esc(v)}" style="color:${C.blue}">${esc(v)}</a>` : esc(v)}</td></tr>`).join('')}</table>`;

const block = (label: string, value: string) =>
  `<div style="border-top:1px solid ${C.line};padding:14px 0"><div style="${LABEL}">${esc(label)}</div><div style="margin-top:5px;font-size:15px;line-height:1.5;color:${C.ink};white-space:pre-wrap;word-break:break-word">${esc(value)}</div></div>`;

const button = (href: string, text: string, bg: string) =>
  `<a href="${href}" style="display:inline-block;margin:0 10px 8px 0;background:${bg};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:999px">${esc(text)}</a>`;

type Card = { eyebrow: string; title: string; intro?: string; c: CcbMail; focus?: number; step?: string; actions: 'decide' | 'open'; openLabel?: string; foot?: string; omitBody?: boolean };

function card(o: Card) {
  const { c } = o;
  const [rbg, rfg] = RISK[c.risk] ?? RISK.Medium;
  const window = c.windowEndAt ? `${when(c.windowAt)} → ${when(c.windowEndAt)}` : when(c.windowAt);
  const body = o.omitBody ? '' : [
    ...BEFORE.map(([k, l]) => (c.data[k] ? block(l, c.data[k]) : '')),
    c.details.length ? `<div style="border-top:1px solid ${C.line};padding:14px 0"><div style="${LABEL};margin-bottom:6px">Details</div>${kv(c.details.map((d) => [d.l, d.v]))}</div>` : '',
    ...AFTER.map(([k, l]) => (c.data[k] ? block(l, c.data[k]) : '')),
  ].join('');
  const actions = o.actions === 'decide'
    ? button(`${link(c.code)}?decide=approve${o.step ? `&step=${encodeURIComponent(o.step)}` : ''}`, 'Approve', '#2E7D3E') + button(`${link(c.code)}?decide=reject${o.step ? `&step=${encodeURIComponent(o.step)}` : ''}`, 'Reject', '#C0392B')
    : button(link(c.code), o.openLabel ?? 'Open in Checkpoint', C.head);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${C.bg};font-family:'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:700px;background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid ${C.line}">
<tr><td style="background:${C.head};padding:20px 30px;color:#FFFFFF;font-weight:800;font-size:18px;letter-spacing:-.02em">CCB via Checkpoint</td></tr>
<tr><td style="padding:28px 30px 8px">
<div style="font-size:12px;font-weight:800;letter-spacing:.14em;color:${C.blue};text-transform:uppercase">${esc(o.eyebrow)}</div>
<h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;letter-spacing:-.03em">${esc(o.title)}</h1>
<div style="margin-top:12px"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${rbg};color:${rfg};font-size:12.5px;font-weight:700">${esc(c.risk)} Risk</span>
<span style="display:inline-block;margin-left:8px;font-size:13px;color:${C.mute}">${esc(c.code)} · ${esc(c.typeName)} · ${esc(c.environment)}</span></div>
${o.intro ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:${C.mute}">${esc(o.intro)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 30px 6px">${stepper(c.stages, o.focus)}</td></tr>
<tr><td style="padding:10px 30px 4px">${kv([['Business unit', c.businessUnit], ['Service belongs to', c.ownerTeam], ['Requested by', c.requester.email, true], ...(c.systemOwner && c.systemOwner !== c.requester.email ? [['Requestor email', c.systemOwner, true] as [string, string, boolean]] : []), ['Change window', window]])}</td></tr>
<tr><td style="padding:0 30px">${body}</td></tr>
<tr><td style="padding:12px 30px 8px">${actions}</td></tr>
<tr><td style="padding:6px 30px 28px;font-size:12.5px;line-height:1.5;color:${C.mute}">${esc(o.foot ?? '')}</td></tr>
</table></td></tr></table></body></html>`;
}

const plain = (c: CcbMail, lines: string[]) => [
  ...lines, '',
  `${c.code} · ${c.typeName} · ${c.risk} risk · ${c.environment}`,
  `Business unit: ${c.businessUnit}`, `Requested by: ${c.requester.email}`, ...(c.systemOwner && c.systemOwner !== c.requester.email ? [`Requestor email: ${c.systemOwner}`] : []),
  `Change window: ${when(c.windowAt)}${c.windowEndAt ? ` -> ${when(c.windowEndAt)}` : ''}`,
  ...[...BEFORE, ...AFTER].filter(([k]) => c.data[k]).map(([k, l]) => `\n${l}:\n${c.data[k]}`),
].join('\n');

const stepOf = (c: CcbMail, id: string) => c.stages.find((s) => s.id === id);

// Sent to each person asked, for their own step. The two buttons open the change in Checkpoint, where the decision is
// confirmed. A button never decides on its own, because mail scanners open links.
export const approvalRequest = (c: CcbMail, id: string) => {
  const st = stepOf(c, id);
  const label = st?.label ?? 'Your sign-off';
  return {
    subject: `[${c.code}] ${label} needed: ${c.title} (${c.risk} risk)`,
    text: plain(c, [`${label} needed for ${c.code}: ${c.title}`, `Approve: ${link(c.code)}?decide=approve&step=${id}`, `Reject:  ${link(c.code)}?decide=reject&step=${id}`]),
    html: card({ eyebrow: `${label} needed`, title: c.title, c, focus: st?.stage, step: id, actions: 'decide', foot: 'Approve and Reject open this change in Checkpoint, signed in with your Google account. Nothing is decided until you confirm there.' }),
  };
};

export const reminder = (c: CcbMail, id: string, from: string) => {
  const st = stepOf(c, id);
  const label = st?.label ?? 'Your sign-off';
  return {
    subject: `[${c.code}] Reminder: ${label} is still needed`,
    text: plain(c, [`${from} sent a reminder: ${label} is still needed for ${c.code}: ${c.title}`, `${link(c.code)}`]),
    html: card({ eyebrow: `Reminder · ${label} needed`, title: c.title, intro: `${from} is waiting on this.`, c, focus: st?.stage, step: id, actions: 'decide', foot: 'Approve and Reject open this change in Checkpoint. Nothing is decided until you confirm there.' }),
  };
};

// Goes to the requester after each decision.
export const decisionNotice = (c: CcbMail, by: string, approved: boolean, allDone: boolean, note?: string | null) => {
  const head = approved ? (allDone ? 'Everyone has approved' : `${by} approved`) : `${by} rejected`;
  const waiting = c.stages.filter((s) => s.status === 'PENDING').map((s) => (s.who ? `${s.label} (${s.who})` : s.label));
  return {
    subject: `[${c.code}] ${head}: ${c.title}`,
    text: plain(c, [`${c.code} — ${head}.`, ...(note ? [`Note: ${note}`] : []), ...(approved && !allDone && waiting.length ? [`Still waiting on: ${waiting.join(', ')}`] : []), link(c.code)]),
    html: card({
      eyebrow: head, title: c.title, c, actions: 'open', openLabel: 'Open the change', omitBody: true,
      intro: note ? `Note: ${note}` : approved && allDone ? 'The change is cleared.' : approved ? `Still waiting on: ${waiting.join(', ')}.` : 'The change was rejected. Update it and file a new CCB.',
    }),
  };
};
