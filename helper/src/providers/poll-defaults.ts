import type { ProviderId } from '../domain/index.js';

export type ProviderPollDefaults = {
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  backoffRatio: number;
};

export const PROVIDER_POLL_DEFAULTS: Partial<Record<ProviderId, ProviderPollDefaults>> = {
  codex: { minIntervalSeconds: 60, maxIntervalSeconds: 1800, backoffRatio: 2 },
  'claude-code': { minIntervalSeconds: 1800, maxIntervalSeconds: 7200, backoffRatio: 1.167 },
  // Placeholder — update once Antigravity API rate-limit behaviour is known (BACK-001)
  antigravity: { minIntervalSeconds: 300, maxIntervalSeconds: 3600, backoffRatio: 2 }
};
