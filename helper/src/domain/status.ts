export const ACCOUNT_STATUSES = [
  'fresh',
  'stale',
  'unavailable',
  'auth_required',
  'offline',
  'provider_error',
  'config_error'
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && ACCOUNT_STATUSES.includes(value as AccountStatus);
}

export function isErrorStatus(status: AccountStatus): boolean {
  return ['auth_required', 'offline', 'provider_error', 'config_error'].includes(status);
}
