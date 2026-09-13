import { join } from 'node:path';
import { ROOT } from '../config.ts';
import { JsonStore } from './json-store.ts';
import type { Business } from '../types.ts';

const FALLBACK: Business = {
  tradingName: 'Moteeka', legalName: '', address: '', email: '', phone: '',
  deliveryMinDays: 15, deliveryMaxDays: 25,
  grievanceOfficer: { name: '', designation: 'Grievance Officer', email: '' },
  policyUpdated: '',
};

const store = new JsonStore<Business>(join(ROOT, 'data', 'business.json'), () => FALLBACK);

export function business(): Business {
  return { ...FALLBACK, ...store.read() };
}

/**
 * Fields still carrying a placeholder. A half-filled legal page is worse than
 * an absent one — it looks like a policy and names nobody you can complain to.
 */
export function unfilled(b: Business = business()): string[] {
  const bad = (v: unknown) => typeof v !== 'string' || v.trim() === '' || v.includes('FILL_ME');
  const gaps: string[] = [];
  for (const k of ['legalName', 'address', 'email', 'phone', 'policyUpdated'] as const) {
    if (bad(b[k])) gaps.push(k);
  }
  if (bad(b.grievanceOfficer?.name)) gaps.push('grievanceOfficer.name');
  if (bad(b.grievanceOfficer?.email)) gaps.push('grievanceOfficer.email');
  return gaps;
}
