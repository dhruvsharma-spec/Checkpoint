export type Status = 'Awaiting' | 'Cleared' | 'Rejected' | 'Rolled out' | 'Rolled back';
export type Team = 'DevOps' | 'DataOps' | 'Development' | 'Security';
export type Risk = 'Low' | 'Medium' | 'High';
export type Owner = { name: string; email: string };
// Approver (LK Tech, LK Platform), sign-off (Security, QA) or executioner (DevOps, DataOps).
export type Kind = 'Approver' | 'Sign-off' | 'Executioner';
// One person asked about a CCB. owners is that one person (or, on older CCBs, everyone listed for the role).
export type Approval = { id: string; stage: number; label: string; role: string; group: string; kind: Kind; owners: Owner[]; status: 'PENDING' | 'APPROVED' | 'REJECTED'; decidedAt: string | null; decidedBy: string | null; note: string | null };
export type Ccb = {
  code: string; type: string; typeName: string; title: string; environment: string; risk: Risk;
  windowAt: string; windowEndAt: string | null; createdAt: string;
  businessUnit: string; systemOwner: string; ownerTeam: string; devTeam: string;
  requester: { name: string; email: string }; status: Status; pending: string[]; implementation: string;
  data: Record<string, string>; approvals: Approval[];
};
export type Analysis = { team: string; body: string; by: string; at: string };
export type CcbDetail = Ccb & { analyses: Analysis[]; comments: { id: string; who: string; body: string; at: string }[]; audit: { id: string; text: string; who: string | null; at: string }[] };

export type Field = { k: string; l: string; showIf?: { k: string; in: string[] }; t?: 'text' | 'mono' | 'area' | 'select' | 'servers' | 'yesno'; half?: boolean; opt?: boolean; ph?: string; rows?: number; opts?: string[] };
export type Opt = { v: string; risk?: Risk; team?: Team; extra?: Team[]; hint?: string };
export type Question = { k: string; l: string; q: string; help?: string; opts: Opt[] };
export type Template = { key: string; name: string; category: string; enabled: boolean; manual?: boolean; blurb: string; tone: 'med' | 'high'; series: string; defaultRisk: Risk; questions: Question[]; fields: Field[] };
export type Catalog = { templates: Template[]; common: Field[]; legacy: Field[]; environments: string[]; categories: string[]; businessUnits: string[]; other: string };

export type Dashboard = {
  kpis: { awaitingYou: number; inFlight: number; cleared: number; rejected: number };
  queue: Ccb[]; next: Ccb | null; upcoming: Ccb[];
};
export type CalEvent = { kind: 'release' | 'pending'; at: string; code: string; title: string; sub: string };
export type Access = 'member' | 'power' | 'admin';
export type User = { id: string; email: string; name: string; access: Access };
export type ApproverGroup = { name: string; owners: Owner[] };
export type ApproverRole = { role: string; kind: Kind; owners: Owner[]; groups?: ApproverGroup[] };
export type Approvers = { source: string | null; error: string | null; writable: boolean; loadedAt: string | null; roles: ApproverRole[] };
export type Rbac = { users: { id: string; name: string; email: string; access: Access; lastLoginAt: string | null; approves: string[] }[] };

export type MysqlServer = { ip: string; role: string; label: string; dns: string; instance: string; version: string; slaveOf: string };
export type Inventory = {
  mysql: { groups: { name: string; servers: MysqlServer[] }[] };
  mongodb: { clusters: { name: string; type: string; managedBy: string; servers: { ip: string; role: string }[] }[] };
  errors: string[];
};

export type Me = { name: string; email: string; access: Access; approves: string[]; createdAt: string | null; lastLoginAt: string | null; filed: number };
