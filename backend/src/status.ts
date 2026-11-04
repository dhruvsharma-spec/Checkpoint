import { ApprovalStatus, Implementation } from '@prisma/client';

export type Status = 'Awaiting' | 'Cleared' | 'Rejected' | 'Rolled out' | 'Rolled back';

export function statusOf(c: { implementation: Implementation; approvals: { status: ApprovalStatus }[] }): Status {
  if (c.implementation === 'LANDED') return 'Rolled out';
  if (c.implementation === 'ROLLED_BACK') return 'Rolled back';
  if (c.approvals.some((a) => a.status === 'REJECTED')) return 'Rejected';
  if (c.approvals.length > 0 && c.approvals.every((a) => a.status === 'APPROVED')) return 'Cleared';
  return 'Awaiting';
}
