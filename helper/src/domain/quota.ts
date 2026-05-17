import type { ProviderId } from './provider.js';
import type { AccountStatus } from './status.js';

export type QuotaWindow = {
  id: string;
  providerWindowName: string;
  usedPercentage: number | null;
  resetAt: string | null;
  resetInText: string | null;
  status: AccountStatus;
  hint?: string | null;
};

export type AccountQuotaCard = {
  provider: ProviderId;
  email: string;
  displayOrder: number;
  status: AccountStatus;
  windows: QuotaWindow[];
  lastSuccessfulRefreshAt: string | null;
  lastAttemptedRefreshAt: string | null;
  stale: boolean;
  errorHint?: string | null;
  effectivePollIntervalSeconds?: number;
  nextPollEligibleAt?: string | null;
  selectionRank?: number | null;
};

export type LatestState = {
  schemaVersion: '1';
  generatedAt: string;
  accounts: AccountQuotaCard[];
};

export type ProviderQuotaResult = {
  provider: ProviderId;
  accountEmail: string;
  fetchedAt: string;
  status: AccountStatus;
  windows: ProviderQuotaWindowResult[];
  errorHint?: string | null;
  rawMetadata?: Record<string, unknown>;
};

export type ProviderQuotaWindowResult = {
  id: string;
  providerWindowName: string;
  usedPercentage: number | null;
  resetAt: string | null;
  hint?: string | null;
};

export function isValidUsedPercentage(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
}

export function clampUsedPercentage(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(100, Math.max(0, value));
}
