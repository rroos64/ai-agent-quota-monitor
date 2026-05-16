import type { ProviderId } from './provider.js';

export type ConfiguredAccount = {
  id: string;
  provider: ProviderId;
  email: string;
  displayOrder: number;
  // Provider-specific local configuration. Codex may store codexHome,
  // which points to a credential-bearing profile dir and must be treated as sensitive.
  providerConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AccountValidationResult = {
  provider: ProviderId;
  expectedEmail: string;
  actualEmail: string | null;
  matches: boolean;
  canReadQuota: boolean;
  hint?: string | null;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function accountIdFor(provider: ProviderId, email: string): string {
  return `${provider}:${normalizeEmail(email)}`;
}
