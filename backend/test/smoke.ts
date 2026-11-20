// End-to-end smoke test against a running backend. It needs the first admin to exist (the seed creates
// dhruv.sharma@lenskart.com), APP_ENV=local so the dev sign-in works, and the test approvers list, where the admin is in
// every list. With ENABLED_CCB_TYPES=all it also files the other kinds of CCB. It deletes what it creates.
//   With the backend running:  npm test
const API = process.env.APP_URL ?? 'http://localhost:4000';
const ADMIN = process.env.TEST_ADMIN ?? 'dhruv.sharma@lenskart.com';
let pass = 0, fail = 0;
const ok = (c: boolean, msg: string) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); };

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown) {
    const r = await fetch(API + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let json: any = null; try { json = await r.json(); } catch { /* no body */ }
    return { status: r.status, json, location: r.headers.get('location') };
  }
  login(email: string) { return this.req('POST', '/auth/dev-login', { email }); }
}

(async () => {
  const anon = new Client();
  ok((await anon.req('GET', '/ccbs')).status === 401, 'anonymous requests are rejected');
  ok((await anon.req('GET', '/health')).status === 200, 'health probe is public');
  const authCfg = await anon.req('GET', '/auth/config');
  ok(authCfg.json?.oidc?.enabled === false, 'the company IdP sign-in is off until OIDC_ISSUER and a client are configured');
  const oidcStart = await anon.req('GET', '/auth/oidc');
  ok(oidcStart.status === 302 && String(oidcStart.location ?? '').includes('error=oidc_not_configured'), 'signing in through the IdP is refused when it is not configured');
  const denied = await anon.req('GET', '/auth/oidc/callback?error=access_denied&error_description=not%20allowed');
  ok(denied.status === 302 && /error=oidc_denied&reason=access_denied/.test(String(denied.location ?? '')), 'an error from the IdP is shown on the login page with its reason');
  const noCode = await anon.req('GET', '/auth/oidc/callback');
  ok(noCode.status === 302 && String(noCode.location ?? '').includes('error=state'), 'a callback without a code is refused');

  const me = new Client(); await me.login(ADMIN);
  const who = await me.req('GET', '/auth/me');
  ok(who.json?.email === ADMIN && who.json?.access === 'admin', 'dev sign-in works and the first user is an admin');

  // ---------- the catalog and the form ----------
  const cat = await me.req('GET', '/templates');
  ok(cat.json?.templates?.length === 21 && cat.json.templates[0].key === 'general', 'twenty-one CCB types are served, General first');
  const general = cat.json.templates[0];
  ok(general.questions.length === 0 && general.manual === true, 'General asks no questions and suggests nothing');
  ok(general.fields.map((f: any) => f.l).join() === 'Description,JIRA or MR link', 'General asks for a Description and the JIRA or MR link');
  ok(cat.json.common.map((f: any) => f.k).join() === 'tested,testedWhy,riskNote,systems,rollback', 'every CCB asks: tested in a lower environment (and why not), the risk associated, systems affected, rollback plan');
  ok(JSON.stringify(cat.json.businessUnits) === JSON.stringify(['Lenskart (India/International)', 'Owndays', 'Ajna Lens']), 'the business units are the three expected');
  ok(JSON.stringify(cat.json.environments) === JSON.stringify(['Production', 'Preprod', 'Staging', 'Alpha']), 'the environments are Production, Preprod, Staging and Alpha');
  const on = cat.json.templates.filter((t: any) => t.enabled).length;
  ok(on === 21 || (on === 1 && general.enabled), `the kinds of CCB that can be filed: ${on} (General only by default)`);

  // ---------- who can be asked ----------
  const ap = await me.req('GET', '/approvers');
  const byRole = (r: string) => ap.json?.roles?.find((x: any) => x.role === r);
  ok(!ap.json?.error && ap.json.roles.map((r: any) => r.role).join() === 'LK Tech,LK Platform,Security,QA,DevOps,DataOps', 'the lists are LK Tech, LK Platform, Security, QA, DevOps and DataOps');
  ok(ap.json.roles.map((r: any) => r.kind).join() === 'Approver,Approver,Sign-off,Sign-off,Executioner,Executioner', 'LK Tech and LK Platform approve; Security and QA sign off; DevOps and DataOps execute');
  const teams = byRole('LK Tech').groups.map((g: any) => g.name);
  ok(['POS', 'Juno', 'CES', 'SCM/NEXS', 'Puno', 'JJ', 'Analytics', 'Cosmos', 'LK Platform', 'QMS'].every((t) => teams.includes(t)), `the service teams are listed: ${teams.join(', ')}`);
  ok(['Pratiti Basu', 'Vikram Gaur'].every((n) => byRole('LK Platform').owners.some((o: any) => o.name === n)), 'LK Platform lists Pratiti Basu and Vikram Gaur');

  // ---------- filing ----------
  const when = (d: number, h = 0) => new Date(Date.now() + d * 864e5 + h * 3600e3).toISOString();
  const body = (extra: any = {}) => ({
    template: 'general', title: 'Smoke test: stop idle VMs', environment: 'Alpha', risk: 'Low', businessUnit: 'Owndays', systemOwner: ADMIN, windowAt: when(2), windowEndAt: when(2, 1),
    service: [{ team: 'POS', approvers: [ADMIN] }], people: { 'LK Platform': [ADMIN], QA: [ADMIN], DevOps: [ADMIN] },
    data: { project: 'Stop the idle VMs one by one', tested: 'Yes', riskNote: 'Some VMs may still be used', systems: 'ap-southeast-1', rollback: 'Start them again' }, ...extra,
  });
  ok((await me.req('POST', '/ccbs', { ...body(), data: {} })).status === 400, 'creating a CCB with missing fields is refused');
  const noWhy = await me.req('POST', '/ccbs', body({ data: { ...body().data, tested: 'No' } }));
  ok(noWhy.status === 400 && noWhy.json?.missing?.some((m: string) => /not tested/.test(m)), 'not tested in a lower environment needs the reason why');
  ok((await me.req('POST', '/ccbs', body({ service: [] }))).status === 400, 'the service owning team and its approvers are required');
  ok((await me.req('POST', '/ccbs', body({ service: [{ team: 'POS', approvers: ['someone.else@lenskart.com'] }] }))).status === 400, 'only people listed for that team can be picked');
  const past = await me.req('POST', '/ccbs', body({ windowAt: when(-1), windowEndAt: when(-1, 1) }));
  ok(past.status === 400 && /past/.test(past.json?.message ?? ''), 'a change window in the past is refused');
  ok((await me.req('POST', '/ccbs', body({ windowAt: when(0, -1), windowEndAt: when(0, 1) }))).status === 400, 'a window that started an hour ago is refused even though it ends later');
  ok((await me.req('POST', '/ccbs', body({ windowAt: 'not a date', windowEndAt: when(2, 1) }))).status === 400, 'an unreadable window date is refused');
  ok((await me.req('POST', '/ccbs', body({ service: [{ team: 'Nowhere', approvers: [ADMIN] }] }))).status === 400, 'only listed teams can be picked');
  ok((await me.req('POST', '/ccbs', body({ businessUnit: 'Lenskart India' }))).status === 400, 'only the listed business units are accepted');

  // a team that is not on the list: typed by hand, one approver
  const oth = (extra: any) => me.req('POST', '/ccbs', body({ service: [{ team: 'Brand New Team', other: true, approvers: [ADMIN], ...extra }] }));
  ok((await oth({ approvers: [ADMIN, 'x@lenskart.com'] })).status === 400, 'a team typed by hand takes exactly one approver');
  ok((await oth({ approvers: ['x@gmail.com'] })).status === 400, 'and that approver must have a company email');
  ok((await oth({ team: 'pos' })).status === 400, 'and the team must not already be on the list');
  const typed = await oth({});
  ok(typed.status === 201 && typed.json.ownerTeam === 'Brand New Team' && typed.json.approvals[0].label === 'LK Tech · Brand New Team approver', 'a CCB can be filed for a team that is not listed');
  await me.req('DELETE', `/ccbs/${typed.json?.code}`);

  const made = await me.req('POST', '/ccbs', body({ data: { ...body().data, tested: 'No', testedWhy: 'No lower environment for these VMs' } }));
  const code = made.json?.code;
  ok(made.status === 201 && /^CCB-\d+$/.test(code), `a CCB is filed with a generated code (${code})`);
  const labels = made.json?.approvals?.map((a: any) => a.label);
  ok(labels?.join() === 'LK Tech · POS approver,Infrastructure & Platform approver,Infrastructure & Platform approver,QA sign-off,DevOps executioner', `each person picked is asked: ${labels?.join(', ')}`);
  ok(made.json.approvals.map((a: any) => a.kind).join() === 'Approver,Approver,Approver,Sign-off,Executioner', 'and each is an approver, a sign-off or an executioner');
  ok(made.json.ownerTeam === 'POS' && made.json.approvals.every((a: any) => a.owners.length === 1), 'the service belongs to POS, and each step names the one person picked');

  const two = await me.req('POST', '/ccbs', body({ service: [{ team: 'POS', approvers: [ADMIN] }, { team: 'Juno', approvers: [ADMIN] }], people: {} }));
  ok(two.status === 201 && two.json.ownerTeam === 'POS, Juno' && two.json.approvals.length === 3, 'a change can belong to more than one team, each with its own approvers (and Pratiti is always added as a Platform approver)');

  // ---------- answering ----------
  const first = made.json.approvals[0].id;
  ok((await me.req('POST', `/ccbs/${code}/decision`, { decision: 'reject', id: first })).status === 400, 'rejecting needs a reason');
  const a1 = await me.req('POST', `/ccbs/${code}/decision`, { decision: 'approve', id: first });
  ok(a1.json?.status === 'Awaiting' && a1.json?.pending?.length === 4, 'approving one step leaves the others pending, and says which');
  const rem = await me.req('POST', `/ccbs/${code}/remind`, { id: made.json.approvals[1].id });
  ok(rem.json?.ok === true, 'a reminder can be sent for a step that is waiting');
  ok((await me.req('POST', `/ccbs/${code}/remind`, { id: made.json.approvals[1].id })).status === 409, 'reminders are limited to one an hour per step');
  const all = await me.req('POST', `/ccbs/${code}/decision`, { decision: 'approve' });
  ok(all.json?.status === 'Awaiting' && all.json.pending.length === 1, 'answering without naming a step answers all of yours; the CCB waits on Pratiti, who is always a Platform approver');

  // ---------- analysis, added after filing ----------
  const an = await me.req('PUT', `/ccbs/${code}/analysis`, { team: 'DevOps', body: 'Checked the VMs: no traffic in 30 days.' });
  ok(an.json?.analyses?.some((x: any) => x.team === 'DevOps' && x.by), 'someone listed for DevOps can add its analysis to the CCB');
  const an2 = await me.req('PUT', `/ccbs/${code}/analysis`, { team: 'DevOps', body: 'Updated: still no traffic.' });
  ok(an2.json?.analyses?.filter((x: any) => x.team === 'DevOps').length === 1 && an2.json.analyses[0].body.startsWith('Updated'), 'and update it, one analysis per team');
  ok((await me.req('PUT', `/ccbs/${code}/analysis`, { team: 'Security', body: 'Not a team that writes analysis' })).status === 400, 'only DevOps, DataOps and QA add analysis');

  const cm = await me.req('POST', `/ccbs/${code}/comments`, { body: 'Please review before Friday.' });
  ok(cm.json?.comments?.length === 1, 'comments are stored and returned');

  // ---------- other kinds of CCB, when they are switched on ----------
  if (on === 21) {
    const inv = await me.req('GET', '/inventory');
    ok(!inv.json?.errors?.length && inv.json.mysql.groups.length >= 10 && inv.json.mongodb.clusters.length >= 15, 'the MySQL and MongoDB inventories are loaded');
    const master = inv.json.mysql.groups.flatMap((g: any) => g.servers).find((x: any) => x.role === 'Master').ip;
    const db = await me.req('POST', '/ccbs', body({ template: 'database', title: 'Smoke test: add an index', data: { engine: 'MySQL / Aurora', action: 'Add or change an index', servers: `${master}\n10.1.2.3`, db: 'orders.items', command: 'ALTER TABLE items ADD INDEX i (a);', tableSize: '1 GB', estTime: '5 min', dba: 'DBA', precaution: 'Watch lag', tested: 'Yes', riskNote: 'Replication lag', systems: 'orders', rollback: 'Drop it' } }));
    ok(db.status === 201 && /^DT-\d+$/.test(db.json?.code) && db.json.data.servers.includes('10.1.2.3'), 'a Database CCB keeps the chosen servers, including one typed in');
    await me.req('DELETE', `/ccbs/${db.json?.code}`);
  }

  // ---------- people and access ----------
  const mine = await me.req('GET', '/me');
  ok(mine.json?.email === ADMIN && mine.json?.approves?.includes('LK Tech · POS'), 'my details list the teams I am on');
  const rbac = await me.req('GET', '/rbac');
  const meRow = rbac.json.users.find((u: any) => u.email === ADMIN);
  ok((await me.req('PATCH', `/rbac/users/${meRow.id}`, { access: 'member' })).status === 403, 'an admin cannot change their own access');
  ok((await me.req('POST', '/rbac/users', { name: 'Outsider', email: 'someone@gmail.com', access: 'member' })).status === 400, 'only company emails can be added');
  ok((await new Client().req('POST', '/auth/register', { name: 'Outsider', email: 'someone@lenskart.com', password: 'a-long-password-1' })).status === 404, 'there is no sign-up');

  const samples = await me.req('GET', '/ccbs');
  const seen = new Set(samples.json.map((c: any) => c.status));
  ok(['Awaiting', 'Cleared', 'Rejected', 'Rolled out', 'Rolled back'].every((x) => seen.has(x)), 'sample CCBs are loaded and cover every status');

  ok((await me.req('DELETE', `/ccbs/${code}`)).json?.ok === true, 'an admin can delete a CCB');
  await me.req('DELETE', `/ccbs/${two.json.code}`);
  ok((await me.req('GET', `/ccbs/${code}`)).status === 404, 'a deleted CCB is gone');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
