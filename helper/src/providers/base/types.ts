import type {
  AccountQuotaCard,
  AccountStatus,
  AccountValidationResult,
  AuthSession,
  ConfiguredAccount,
  ProviderId,
  ProviderQuotaResult,
  ProviderQuotaWindowResult
} from '../../domain/index.js';
import type { TokenRef } from '../../storage/index.js';

export type Clock = {
  now(): Date;
  nowIso(): string;
};

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString()
};

export type AuthInput = {
  provider: ProviderId;
  expectedEmail: string;
  interactive: boolean;
};

export type AuthResult = {
  provider: ProviderId;
  email: string;
  tokenRef: TokenRef;
  authenticatedAt: string;
};

export type AuthSessionStartInput = {
  provider: ProviderId;
  expectedEmail: string;
  interactive: boolean;
};

export type AuthSessionCompleteInput = {
  sessionId: string;
  outcome?: 'success' | 'failure' | 'expired';
  actualEmail?: string;
  errorHint?: string;
};

export type ProviderAuthSessionCapability = {
  startAuthSession(input: AuthSessionStartInput): Promise<AuthSession>;
  getAuthSession(sessionId: string): Promise<AuthSession>;
  completeAuthSession(input: AuthSessionCompleteInput): Promise<AuthSession>;
  cancelAuthSession(sessionId: string): Promise<AuthSession>;
};

export type ProviderDiagnosticResult = {
  provider: ProviderId;
  accountId?: string;
  status: AccountStatus;
  checkedAt: string;
  canAuthenticate: boolean;
  canReadQuota: boolean;
  hint?: string | null;
  metadata?: Record<string, unknown>;
};

export type ProviderAdapter = {
  readonly providerId: ProviderId;
  readonly providerName: string;
  authenticate(input: AuthInput): Promise<AuthResult>;
  validateAccount(tokenRef: TokenRef, expectedEmail: string): Promise<AccountValidationResult>;
  fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;
  normaliseQuota(
    account: ConfiguredAccount,
    result: ProviderQuotaResult
  ): Promise<AccountQuotaCard>;
  authSessions?: ProviderAuthSessionCapability;
  diagnose?(account: ConfiguredAccount): Promise<ProviderDiagnosticResult>;
};

export type { ProviderQuotaResult, ProviderQuotaWindowResult };
