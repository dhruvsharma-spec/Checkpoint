// The CCB catalog: one entry per kind of change. A new kind is a new entry here, then a re-seed.
//
// How a template is used:
//   questions  asked one at a time when the requester starts a CCB. Each answer can nudge the
//              suggested risk, the owning team and the extra teams to involve. Every question ends with
//              "Something else", added automatically, which asks the requester to describe it.
//   fields     the "template details" part of the form, specific to that kind of change.
// Every template also gets COMMON_FIELDS (tested in a lower environment, systems affected, rollback plan).

export const TEAMS = ['DevOps', 'DataOps', 'Development', 'Security'] as const;
export type Team = (typeof TEAMS)[number];
export type Risk = 'Low' | 'Medium' | 'High';
export const OTHER = 'Something else';

export type Field = {
  k: string;
  l: string;
  // 'servers' is a list of database servers, picked from the MySQL or MongoDB inventory or typed.
  // 'yesno' is a Yes / No choice with no default.
  t?: 'text' | 'mono' | 'area' | 'select' | 'servers' | 'yesno';
  half?: boolean;
  opt?: boolean;
  ph?: string;
  rows?: number;
  opts?: string[];
  // Only asked, and only required, when the answer to question k is one of these.
  showIf?: { k: string; in: string[] };
};
// Whether a field is asked, given the answers so far.
export const applies = (f: Field, data: Record<string, string>) => !f.showIf || f.showIf.in.includes(data[f.showIf.k] ?? '');
export type Opt = { v: string; risk?: Risk; team?: Team; extra?: Team[]; hint?: string };
export type Question = { k: string; l: string; q: string; help?: string; opts: Opt[] };
export type Spec = { questions: Question[]; fields: Field[] };
export type TemplateDef = {
  key: string;
  name: string;
  category: string;
  blurb: string;
  tone: 'med' | 'high';
  series: 'ccb' | 'dt';
  defaultTeam: Team;
  defaultRisk: Risk;
  skipQa?: boolean;
  // A manual template suggests nothing: the person fills in every choice, including the owning team, the risk and who is asked.
  manual?: boolean;
  spec: Spec;
};

export const CATEGORIES = ['General', 'Applications', 'Network & edge', 'Data & messaging', 'Infrastructure', 'Security & access', 'Operations'];
export const BUSINESS_UNITS = ['Lenskart (India/International)', 'Owndays', 'Ajna Lens'] as const;
export const ENVIRONMENTS = ['Production', 'Preprod', 'Staging', 'Alpha'] as const;

// Asked on every CCB, after the template-specific part. (Risk level is picked separately.) The analysis by DevOps, DataOps and QA is not asked here:
// those teams add it on the CCB page after it is filed.
export const COMMON_FIELDS: Field[] = [
  { k: 'tested', l: 'Tested in a lower environment?', t: 'yesno' },
  { k: 'testedWhy', l: 'Why was it not tested in a lower environment?', t: 'area', showIf: { k: 'tested', in: ['No'] } },
  { k: 'riskNote', l: 'Risk associated with the change', t: 'area', ph: 'What could go wrong, and who or what it would affect' },
  { k: 'systems', l: 'Systems affected', t: 'area', ph: 'Services, hosts, clusters, zones' },
  { k: 'rollback', l: 'Rollback plan', t: 'area', ph: 'How to undo this, how long it takes, and who does it' },
];
// Asked on older CCBs. Shown on those CCBs and in their emails, never asked again.
export const LEGACY_FIELDS: Field[] = [
  { k: 'reason', l: 'Reason for change' }, { k: 'desc', l: 'Description' }, { k: 'impact', l: 'Impact' },
  { k: 'qaPlan', l: 'Testing / QA plan' }, { k: 'analysis', l: 'DevOps/DataOps analysis' },
];

// A question always offers "Something else" last.
const q = (k: string, l: string, question: string, opts: Opt[], help?: string): Question => ({ k, l, q: question, opts: [...opts, { v: OTHER }], help });
const jira = (l = 'JIRA or MR link'): Field => ({ k: 'jira', l, t: 'mono', opt: true });

export const TEMPLATES: TemplateDef[] = [
  // ---------------------------------------------------------------- General
  {
    key: 'general', name: 'General', category: 'General', blurb: "Use this when your change doesn't fit one of the specific categories.",
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium', manual: true,
    // Nothing is asked or suggested here. The person fills in every choice themselves.
    spec: {
      questions: [],
      fields: [{ k: 'project', l: 'Description', t: 'area', rows: 4, ph: 'What is being changed, and how' }, jira()],
    },
  },

  // ---------------------------------------------------------------- Applications
  {
    key: 'release', name: 'Application Release', category: 'Applications', blurb: 'Deploying a new version of an application or service to an environment.',
    tone: 'med', series: 'ccb', defaultTeam: 'Development', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('kind', 'Kind', 'What kind of release is it?', [
          { v: 'New feature release' },
          { v: 'Bug fix' },
          { v: 'Hotfix outside the normal cycle', hint: 'Say why it cannot wait for the next release.' },
          { v: 'Rollback to a previous version' },
          { v: 'Release with a database migration', extra: ['DataOps'], hint: 'Say whether the migration can be reversed.' },
          { v: 'Dependency or library upgrade' },
          { v: 'Mobile app release' },
        ]),
        q('strategy', 'Rollout', 'How will it be rolled out?', [
          { v: 'Rolling update' }, { v: 'Blue / green' }, { v: 'Canary or gradual %' }, { v: 'All at once', hint: 'There is no gradual exposure, so a bad release hits everyone.' },
        ]),
      ],
      fields: [
        { k: 'service', l: 'Service / repository', half: true },
        { k: 'version', l: 'Version (from → to)', half: true, ph: 'v1.4.2 → v1.5.0' },
        { k: 'flags', l: 'Feature flags involved', half: true, opt: true },
        { k: 'depends', l: 'Depends on other releases', half: true, opt: true },
        jira(),
      ],
    },
  },
  {
    key: 'config', name: 'Configuration & Feature Flag', category: 'Applications', blurb: 'Changing application configuration, environment variables, secrets in config, rate limits, or feature flags.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('what', 'What changes', 'What are you changing?', [
          { v: 'Application config or environment variable' }, { v: 'Feature flag', risk: 'Low' }, { v: 'Timeouts, retries or rate limits', risk: 'Medium' },
          { v: 'Config map or secret in the cluster', risk: 'Medium' }, { v: 'Third-party endpoint or API key', risk: 'Medium', extra: ['Security'] }, { v: 'Scheduled job or cron timing', risk: 'Medium' },
        ]),
        q('scope', 'Scope', 'How far does it reach?', [
          { v: 'One service', risk: 'Low' }, { v: 'Several services', risk: 'Medium' }, { v: 'Platform-wide, every service', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'service', l: 'Service(s)', half: true },
        { k: 'environment', l: 'Environment / cluster', t: 'mono', half: true },
        { k: 'key', l: 'Setting name', t: 'mono', half: true },
        { k: 'values', l: 'Old value → new value', t: 'mono', half: true, ph: 'Do not paste secrets' },
        jira(),
      ],
    },
  },
  {
    key: 'scaling', name: 'Application Scaling', category: 'Applications', blurb: 'Scaling an application up or down: replica/pod count, vCPU/RAM allocation, or autoscaling policy.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('direction', 'Direction', 'Are you scaling up or down?', [
          { v: 'Scale up', risk: 'Low' }, { v: 'Scale down', risk: 'Medium', hint: 'Scaling down can drop capacity under load.' }, { v: 'Change autoscaling policy', risk: 'Medium' }, { v: 'Pre-scale for an event or sale', risk: 'Low' },
        ]),
        q('what', 'What changes', 'What is changing?', [{ v: 'Replica / pod count' }, { v: 'vCPU / RAM allocation' }, { v: 'Autoscaling (HPA) limits' }, { v: 'Node count for the workload' }]),
        q('duration', 'Duration', 'Is this permanent?', [{ v: 'Permanent' }, { v: 'Temporary, for an event or peak', hint: 'Add the revert time in the description.' }]),
      ],
      fields: [
        { k: 'application', l: 'Application / service', half: true },
        { k: 'cluster', l: 'Cluster / namespace', t: 'mono', half: true },
        { k: 'current', l: 'Current size', half: true, ph: 'e.g. 4 pods, 2 vCPU, 4 GB' },
        { k: 'target', l: 'Target size', half: true, ph: 'e.g. 8 pods, 2 vCPU, 4 GB' },
        jira(),
      ],
    },
  },
  {
    key: 'kubernetes', name: 'Kubernetes', category: 'Applications', blurb: 'Cluster upgrades, node groups, workloads, Helm charts, namespaces, network policies and cluster access.',
    tone: 'high', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('action', 'Action', 'What are you doing on the cluster?', [
          { v: 'Upgrade the cluster version', risk: 'High' },
          { v: 'Add, remove or resize a node group', risk: 'Medium' },
          { v: 'Deploy or change a workload or Helm chart', risk: 'Medium' },
          { v: 'Change resource requests or limits', risk: 'Medium' },
          { v: 'Namespace, RBAC or network policy', risk: 'High', extra: ['Security'] },
          { v: 'Restart or drain nodes', risk: 'Medium' },
          { v: 'Install or upgrade an add-on (ingress, CNI, operator)', risk: 'High' },
          { v: 'Delete a workload or namespace', risk: 'High', hint: 'Confirm nothing still uses it and that its data is backed up.' },
        ]),
      ],
      fields: [
        { k: 'cluster', l: 'Cluster', t: 'mono', half: true },
        { k: 'namespace', l: 'Namespace(s)', t: 'mono', half: true },
        { k: 'objects', l: 'Objects or charts changed', t: 'mono', ph: 'deployment/checkout, helm chart ingress-nginx 4.10 → 4.11' },
        jira(),
      ],
    },
  },

  // ---------------------------------------------------------------- Network & edge
  {
    key: 'cloudflare', name: 'Cloudflare', category: 'Network & edge', blurb: 'Any change on Cloudflare: firewall/WAF, DNS, page rules, IP access, caching, SSL/TLS, load balancing, Workers, and zone settings.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('action', 'Action', 'What are you changing on Cloudflare?', [
          { v: 'Add DNS record', risk: 'Low' },
          { v: 'Edit DNS record', risk: 'Medium' },
          { v: 'Delete DNS record', risk: 'High', hint: 'Deleting a live record can take a site down.' },
          { v: 'Firewall / WAF rule', risk: 'Medium', extra: ['Security'] },
          { v: 'Rate limiting rule', risk: 'Medium', extra: ['Security'] },
          { v: 'IP access rule', risk: 'Medium', extra: ['Security'] },
          { v: 'Bot or challenge settings', risk: 'Medium', extra: ['Security'] },
          { v: 'Page or cache rule', risk: 'Medium' },
          { v: 'Cache purge', risk: 'Low' },
          { v: 'SSL / TLS setting', risk: 'High', extra: ['Security'] },
          { v: 'Load balancer or origin pool', risk: 'High' },
          { v: 'Worker', risk: 'Medium', team: 'Development' },
          { v: 'Tunnel or Access policy', risk: 'High', extra: ['Security'] },
          { v: 'Other zone setting', risk: 'Medium' },
        ]),
      ],
      fields: [
        { k: 'zone', l: 'Zone / domain', ph: 'e.g. lenskart.com' },
        { k: 'record', l: 'Rule / record details (rule expression, or DNS record type + name + value)', t: 'mono', ph: 'A  shop.lenskart.com  203.0.113.10  proxied' },
        jira(),
      ],
    },
  },
  {
    key: 'network', name: 'Network & Load Balancer', category: 'Network & edge', blurb: 'Load balancers, target groups, security groups, VPC and routing, VPN or peering, DNS outside Cloudflare, IP allow-lists.',
    tone: 'high', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('action', 'Action', 'What are you changing?', [
          { v: 'Create or change a load balancer', risk: 'Medium' },
          { v: 'Target group or health check', risk: 'Medium' },
          { v: 'Security group or firewall rule', risk: 'High', extra: ['Security'] },
          { v: 'VPC, subnet or route table', risk: 'High' },
          { v: 'VPN, peering or transit gateway', risk: 'High', extra: ['Security'] },
          { v: 'DNS record (Route 53 or other)', risk: 'Medium' },
          { v: 'IP allow-list change', risk: 'Medium', extra: ['Security'] },
          { v: 'Store or office network', risk: 'Medium' },
        ]),
      ],
      fields: [
        { k: 'provider', l: 'Cloud / region / account', t: 'mono', half: true },
        { k: 'resource', l: 'Resource IDs or names', t: 'mono', half: true },
        { k: 'detail', l: 'Exact change', t: 'mono', ph: 'Rule, CIDR, port range, record' },
        jira(),
      ],
    },
  },
  {
    key: 'nginx', name: 'Nginx', category: 'Network & edge', blurb: 'Changes to nginx config: upstreams, routing, headers, TLS, rate limits.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('area', 'Area', 'Which part of the nginx config?', [
          { v: 'Upstreams' }, { v: 'Routing / locations' }, { v: 'Headers' }, { v: 'TLS / certificates', risk: 'High', extra: ['Security'] }, { v: 'Rate limits', risk: 'Medium' },
          { v: 'Redirects or rewrites', risk: 'Medium' }, { v: 'Caching or compression', risk: 'Low' }, { v: 'Add or remove a server / vhost', risk: 'Medium' },
        ]),
        q('apply', 'Apply with', 'How will it be applied?', [{ v: 'Reload (no downtime)', risk: 'Low' }, { v: 'Restart', risk: 'High' }]),
      ],
      fields: [
        { k: 'hosts', l: 'Nginx hosts / server names', t: 'mono' },
        { k: 'diff', l: 'Config change (diff or snippet)', t: 'mono', rows: 6 },
        { k: 'test', l: 'Validation (e.g. nginx -t, curl checks)', t: 'area', opt: true },
        jira(),
      ],
    },
  },

  // ---------------------------------------------------------------- Data & messaging
  {
    key: 'database', name: 'Database', category: 'Data & messaging', blurb: 'Table/index changes, upgrades, tuning, restarts, drops, archivals, disk: any DB engine.',
    tone: 'high', series: 'dt', defaultTeam: 'DataOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('engine', 'Engine', 'Which database engine?', [{ v: 'MySQL / Aurora' }, { v: 'PostgreSQL' }, { v: 'MongoDB' }, { v: 'SQL Server' }, { v: 'Elasticsearch / OpenSearch' }, { v: 'Other engine' }]),
        q('action', 'Action', 'What are you doing?', [
          { v: 'Add or change an index', risk: 'Medium' },
          { v: 'Alter a table', risk: 'High', hint: 'Big alters can lock or lag replicas. Name the tool you will use.' },
          { v: 'Version upgrade', risk: 'High' },
          { v: 'Parameter tuning', risk: 'Medium' },
          { v: 'Restart', risk: 'Medium' },
          { v: 'Failover or switchover', risk: 'High' },
          { v: 'Archive or drop data', risk: 'High', hint: 'Take a backup first and say where it is.' },
          { v: 'Data fix or bulk update', risk: 'High', hint: 'Say how many rows, and how you will check the result.' },
          { v: 'Create user or grant privileges', risk: 'Medium', extra: ['Security'] },
          { v: 'Replica or cluster change', risk: 'High' },
          { v: 'Disk resize', risk: 'Medium' },
          { v: 'Backup or restore', risk: 'Low' },
        ]),
      ],
      fields: [
        { k: 'servers', l: 'Database servers', t: 'servers' },
        { k: 'db', l: 'Database / table', t: 'mono' },
        { k: 'command', l: 'Command or query', t: 'mono', ph: 'ALTER TABLE ...' },
        { k: 'tableSize', l: 'Table / data size', half: true },
        { k: 'estTime', l: 'Estimated time', half: true },
        { k: 'mode', l: 'Mode of execution', t: 'select', half: true, opts: ['Direct', 'PT-OSC / online', 'Backup', 'Drop'] },
        { k: 'dba', l: 'DBA executing', half: true },
        { k: 'precaution', l: 'Precautions', t: 'area', ph: 'Replication lag checks, backup taken, stop conditions' },
        jira('JIRA'),
      ],
    },
  },
  {
    key: 'cache', name: 'Cache (Redis / Memcached)', category: 'Data & messaging', blurb: 'Redis, ElastiCache or Memcached: resizing, upgrades, flushes, eviction and TTL settings, failover.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('engine', 'Engine', 'Which cache?', [{ v: 'Redis (self-managed)' }, { v: 'ElastiCache' }, { v: 'Memcached' }]),
        q('action', 'Action', 'What are you doing?', [
          { v: 'Resize or change node type', risk: 'Medium' },
          { v: 'Version upgrade', risk: 'High' },
          { v: 'Flush keys or the whole cache', risk: 'High', hint: 'A cold cache sends all traffic to the database at once.' },
          { v: 'Change eviction, TTL or memory settings', risk: 'Medium' },
          { v: 'Failover test', risk: 'Medium' },
          { v: 'Add or remove a replica or shard', risk: 'Medium' },
          { v: 'Stop or decommission', risk: 'High', hint: 'Confirm no client is still connected.' },
        ]),
      ],
      fields: [
        { k: 'cluster', l: 'Cluster / endpoint', t: 'mono', half: true },
        { k: 'keys', l: 'Keys or patterns affected', t: 'mono', half: true, opt: true },
        { k: 'clients', l: 'Services that use it', t: 'area' },
        jira(),
      ],
    },
  },
  {
    key: 'kafka', name: 'Kafka Topic', category: 'Data & messaging', blurb: 'Creating, deleting, or increasing partitions on a Kafka topic; other queues too.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('engine', 'System', 'Which messaging system?', [{ v: 'Kafka' }, { v: 'RabbitMQ' }, { v: 'Amazon SQS / SNS' }, { v: 'Other queue' }]),
        q('action', 'Action', 'What are you doing?', [
          { v: 'Create topic or queue', risk: 'Low' },
          { v: 'Increase partitions', risk: 'Medium', hint: 'Partitions can never be reduced, and key ordering changes.' },
          { v: 'Change retention or config', risk: 'Medium' },
          { v: 'Change ACLs or credentials', risk: 'Medium', extra: ['Security'] },
          { v: 'Reassign partitions or rebalance', risk: 'High' },
          { v: 'Delete topic or queue', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'cluster', l: 'Cluster / broker', t: 'mono', half: true },
        { k: 'topic', l: 'Topic or queue name', t: 'mono', half: true },
        { k: 'partitions', l: 'Partitions (current → new)', half: true, opt: true },
        { k: 'retention', l: 'Retention / replication', half: true, opt: true },
        { k: 'consumers', l: 'Producers and consumer groups affected', t: 'area' },
        jira(),
      ],
    },
  },
  {
    key: 'pipeline', name: 'Data Pipeline', category: 'Data & messaging', blurb: 'ETL and batch jobs: new or changed pipelines, schedules, schemas, backfills.',
    tone: 'med', series: 'ccb', defaultTeam: 'DataOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('tool', 'Tool', 'Which tool runs it?', [{ v: 'Airflow' }, { v: 'Spark' }, { v: 'dbt' }, { v: 'AWS Glue' }, { v: 'Scheduled script or cron' }]),
        q('action', 'Action', 'What are you doing?', [
          { v: 'New pipeline or job', risk: 'Low' },
          { v: 'Change the schedule', risk: 'Low' },
          { v: 'Change schema or mapping', risk: 'High' },
          { v: 'Backfill or reprocess data', risk: 'High', hint: 'Say the date range and how duplicates are avoided.' },
          { v: 'Pause or disable', risk: 'Medium' },
          { v: 'Delete a pipeline or its output', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'pipeline', l: 'Pipeline / DAG / job name', t: 'mono', half: true },
        { k: 'sources', l: 'Source and destination', half: true },
        { k: 'downstream', l: 'Reports or services that depend on it', t: 'area' },
        jira(),
      ],
    },
  },
  {
    key: 'storage', name: 'Storage & Backup', category: 'Data & messaging', blurb: 'Buckets, volumes, file systems, snapshots, backup policies, restores and data migrations.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('resource', 'Resource', 'What kind of storage?', [{ v: 'S3 or object storage', extra: ['Security'] }, { v: 'Block volume (EBS)' }, { v: 'File system (EFS / NFS)' }, { v: 'Backup vault or snapshots' }]),
        q('action', 'Action', 'What are you doing?', [
          { v: 'Bucket policy or access change', risk: 'High', extra: ['Security'] },
          { v: 'Lifecycle or retention rule', risk: 'Medium', hint: 'A retention rule can delete data. Check it twice.' },
          { v: 'Resize or extend a volume', risk: 'Medium' },
          { v: 'Change backup or snapshot schedule', risk: 'Medium' },
          { v: 'Restore from a backup', risk: 'High' },
          { v: 'Migrate or copy data', risk: 'High', team: 'DataOps' },
          { v: 'Delete data', risk: 'High', hint: 'Say who confirmed the data is no longer needed.' },
        ]),
      ],
      fields: [
        { k: 'name', l: 'Bucket / volume / vault', t: 'mono', half: true },
        { k: 'size', l: 'Size or object count', half: true, opt: true },
        { k: 'detail', l: 'Exact change', t: 'mono' },
        jira(),
      ],
    },
  },

  // ---------------------------------------------------------------- Infrastructure
  {
    key: 'infrastructure', name: 'Infrastructure', category: 'Infrastructure', blurb: 'Provisioning, scaling, patching, or reconfiguring infrastructure (servers, clusters, networking).',
    tone: 'high', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('action', 'Action', 'What are you doing to the infrastructure?', [
          { v: 'Provision new', risk: 'Low' }, { v: 'Scale or resize', risk: 'Medium' }, { v: 'Reconfigure', risk: 'Medium' }, { v: 'Patch or OS upgrade', risk: 'Medium' },
          { v: 'Upgrade version', risk: 'High' }, { v: 'Move to another region or zone', risk: 'High' }, { v: 'Decommission', risk: 'High', hint: 'Confirm nothing still uses it.' },
        ]),
        q('resource', 'Resource', 'Which kind of resource?', [
          { v: 'VM / server' }, { v: 'Kubernetes cluster' }, { v: 'Network / VPC', extra: ['Security'] }, { v: 'Load balancer' }, { v: 'Auto scaling group' }, { v: 'Serverless function' }, { v: 'Storage' },
        ]),
      ],
      fields: [
        { k: 'scope', l: 'Cloud / region / account', t: 'mono', ph: 'e.g. aws prod ap-southeast-1' },
        { k: 'resources', l: 'Resources (IDs, names, IPs)', t: 'mono' },
        jira(),
      ],
    },
  },
  {
    key: 'resize', name: 'Instance Resize', category: 'Infrastructure', blurb: 'Resizing a server/instance (EC2, VM, etc.) up or down.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('provider', 'Platform', 'Where does it run?', [{ v: 'AWS EC2' }, { v: 'AWS RDS or managed database', extra: ['DataOps'] }, { v: 'Google Cloud' }, { v: 'Azure' }, { v: 'On-premises VM' }]),
        q('direction', 'Direction', 'Up or down?', [{ v: 'Resize up', risk: 'Low' }, { v: 'Resize down', risk: 'Medium', hint: 'Check CPU and memory peaks first.' }]),
        q('downtime', 'Downtime', 'Will the instance be stopped?', [
          { v: 'No downtime' }, { v: 'Under 5 minutes', risk: 'Medium' }, { v: '5 to 30 minutes', risk: 'High' }, { v: 'More than 30 minutes', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'servers', l: 'Database servers', t: 'servers', showIf: { k: 'provider', in: ['AWS RDS or managed database'] } },
        { k: 'instances', l: 'Instance IDs / hostnames', t: 'mono', showIf: { k: 'provider', in: ['AWS EC2', 'Google Cloud', 'Azure', 'On-premises VM', 'Something else'] } },
        { k: 'currentType', l: 'Current type', half: true, ph: 'e.g. m5.xlarge' },
        { k: 'targetType', l: 'Target type', half: true, ph: 'e.g. m5.2xlarge' },
        jira(),
      ],
    },
  },
  {
    key: 'downtime', name: 'Planned Downtime', category: 'Infrastructure', blurb: 'A scheduled maintenance window with expected downtime, spanning any category: infra, database, security, or application.',
    tone: 'high', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'High',
    spec: {
      questions: [
        q('category', 'Category', 'What is going down?', [
          { v: 'Infrastructure', team: 'DevOps' }, { v: 'Database', team: 'DataOps' }, { v: 'Security systems', team: 'Security' }, { v: 'Application', team: 'Development' },
          { v: 'Network', team: 'DevOps' }, { v: 'A third-party dependency', team: 'Development' }, { v: 'Store or office systems', team: 'DevOps' },
        ]),
        q('length', 'Expected downtime', 'How long will it be down?', [
          { v: 'Under 15 minutes', risk: 'Medium' }, { v: '15 to 60 minutes', risk: 'High' }, { v: '1 to 4 hours', risk: 'High' }, { v: 'More than 4 hours', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'servers', l: 'Database servers', t: 'servers', showIf: { k: 'category', in: ['Database'] } },
        { k: 'services', l: 'Services that will be down', t: 'area' },
        { k: 'customer', l: 'Customer / store impact', t: 'area' },
        { k: 'comms', l: 'Communication plan', t: 'area', ph: 'Who is told, where, and when' },
        jira(),
      ],
    },
  },

  // ---------------------------------------------------------------- Security & access
  {
    key: 'security', name: 'Security', category: 'Security & access', blurb: 'IAM/permission changes, certificate rotation, security group or firewall rules, secrets rotation.',
    tone: 'high', series: 'ccb', defaultTeam: 'Security', defaultRisk: 'High',
    spec: {
      questions: [
        q('area', 'Area', 'What kind of security change?', [
          { v: 'IAM / permission change', risk: 'High' },
          { v: 'Certificate rotation', risk: 'Medium', team: 'DevOps' },
          { v: 'Security group / firewall rule', risk: 'High' },
          { v: 'Secrets rotation', risk: 'Medium', team: 'DevOps' },
          { v: 'Encryption key (KMS) change', risk: 'High' },
          { v: 'WAF or bot rules', risk: 'Medium' },
          { v: 'Security patch for a vulnerability', risk: 'Medium', team: 'DevOps' },
          { v: 'Audit logging or scanner change', risk: 'Low' },
        ]),
      ],
      fields: [
        { k: 'target', l: 'Account / resource', t: 'mono', half: true },
        { k: 'principal', l: 'Who or what gets the change', half: true, ph: 'User, role, service or rule' },
        { k: 'detail', l: 'Exact change', t: 'mono', ph: 'Policy diff, port range, certificate name, secret path' },
        { k: 'expiry', l: 'Expires / review date', half: true, opt: true },
        jira('JIRA or ticket'),
      ],
    },
  },
  {
    key: 'access', name: 'Access Request', category: 'Security & access', blurb: 'Granting, changing or removing access to production systems, including temporary elevated access.',
    tone: 'high', series: 'ccb', defaultTeam: 'Security', defaultRisk: 'Medium', skipQa: true,
    spec: {
      questions: [
        q('action', 'Action', 'What is the access change?', [
          { v: 'Grant access', risk: 'Medium' },
          { v: 'Remove access', risk: 'Low' },
          { v: 'Temporary elevated access', risk: 'High', hint: 'Give the end date. Access must be removed when it passes.' },
          { v: 'Service account or API key', risk: 'High' },
          { v: 'SSH, VPN or bastion access', risk: 'Medium' },
          { v: 'Offboarding clean-up', risk: 'Low' },
        ]),
        q('level', 'Level', 'What level of access?', [{ v: 'Read-only', risk: 'Low' }, { v: 'Read and write', risk: 'Medium' }, { v: 'Administrator', risk: 'High' }]),
      ],
      fields: [
        { k: 'who', l: 'Who gets or loses access', half: true },
        { k: 'system', l: 'System or account', t: 'mono', half: true },
        { k: 'until', l: 'Until (if temporary)', half: true, opt: true },
        { k: 'ticket', l: 'Approval ticket', t: 'mono', half: true, opt: true },
      ],
    },
  },

  // ---------------------------------------------------------------- Operations
  {
    key: 'cicd', name: 'CI/CD Pipeline', category: 'Operations', blurb: 'Build and deploy pipelines, runners, artifact registries, branch protection and release process.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Medium', skipQa: true,
    spec: {
      questions: [
        q('action', 'Action', 'What are you changing?', [
          { v: 'Pipeline stages or approval gates', risk: 'Medium' },
          { v: 'Runners or build agents', risk: 'Low' },
          { v: 'Artifact registry or repository settings', risk: 'Medium' },
          { v: 'Branch protection or release process', risk: 'Medium' },
          { v: 'Credentials used by pipelines', risk: 'High', extra: ['Security'] },
          { v: 'Move to a different tool', risk: 'High' },
        ]),
      ],
      fields: [
        { k: 'tool', l: 'Tool', half: true, ph: 'GitLab, Jenkins, GitHub Actions' },
        { k: 'projects', l: 'Projects or repositories affected', half: true },
        { k: 'detail', l: 'Exact change', t: 'area' },
        jira(),
      ],
    },
  },
  {
    key: 'monitoring', name: 'Monitoring & Alerting', category: 'Operations', blurb: 'Alert rules, dashboards, log retention, agents and exporters, on-call routing.',
    tone: 'med', series: 'ccb', defaultTeam: 'DevOps', defaultRisk: 'Low', skipQa: true,
    spec: {
      questions: [
        q('action', 'Action', 'What are you changing?', [
          { v: 'Create or change an alert rule', risk: 'Low' },
          { v: 'Silence or mute an alert', risk: 'Medium', hint: 'Give an end time so it does not stay muted.' },
          { v: 'Dashboard', risk: 'Low' },
          { v: 'Log retention or sampling', risk: 'Medium' },
          { v: 'Roll out an agent or exporter', risk: 'Medium' },
          { v: 'On-call routing or escalation', risk: 'Medium' },
        ]),
      ],
      fields: [
        { k: 'tool', l: 'Tool', half: true, ph: 'Grafana, Datadog, PagerDuty' },
        { k: 'scope', l: 'Services or hosts covered', half: true },
        { k: 'detail', l: 'Exact change', t: 'area' },
        jira(),
      ],
    },
  },
  {
    key: 'vendor', name: 'Third-party Integration', category: 'Operations', blurb: 'Connecting, changing or cutting over a vendor, payment, logistics or SaaS integration.',
    tone: 'med', series: 'ccb', defaultTeam: 'Development', defaultRisk: 'Medium',
    spec: {
      questions: [
        q('action', 'Action', 'What are you doing?', [
          { v: 'New integration', risk: 'Medium' },
          { v: 'Change endpoint or credentials', risk: 'Medium', extra: ['Security'] },
          { v: 'Cut over to a new vendor', risk: 'High' },
          { v: 'Webhook or callback change', risk: 'Medium' },
          { v: 'Decommission an integration', risk: 'Medium' },
        ]),
        q('kind', 'Kind', 'What does the vendor do?', [{ v: 'Payments' }, { v: 'Logistics or delivery' }, { v: 'Marketing or messaging' }, { v: 'Analytics' }, { v: 'Internal SaaS tool' }]),
      ],
      fields: [
        { k: 'vendor', l: 'Vendor', half: true },
        { k: 'env', l: 'Environment / account', half: true },
        { k: 'contract', l: 'Contract or data-sharing review done?', half: true, opt: true },
        jira(),
      ],
    },
  },
];
