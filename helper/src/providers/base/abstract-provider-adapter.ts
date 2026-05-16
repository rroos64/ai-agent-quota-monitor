import type {
  AccountQuotaCard,
  AccountStatus,
  AccountValidationResult,
  ConfiguredAccount,
  ProviderId,
  ProviderQuotaResult
} from '../../domain/index.js';
import { statusFromError } from '../../domain/index.js';
import type { TokenRef } from '../../storage/index.js';
import type {
  AuthInput,
  AuthResult,
  Clock,
  ProviderAdapter,
  ProviderDiagnosticResult
} from './types.js';
import { systemClock } from './types.js';

export abstract class AbstractProviderAdapter implements ProviderAdapter {
  abstract readonly providerId: ProviderId;
  abstract readonly providerName: string;

  protected constructor(protected readonly clock: Clock = systemClock) {}

  abstract authenticate(input: AuthInput): Promise<AuthResult>;

  abstract validateAccount(
    tokenRef: TokenRef,
    expectedEmail: string
  ): Promise<AccountValidationResult>;

  abstract fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;

  normaliseQuota(
    account: ConfiguredAccount,
    result: ProviderQuotaResult
  ): Promise<AccountQuotaCard> {
    const nowIso = this.clock.nowIso();
    const windows = result.windows.map((window) => ({
      id: window.id,
      providerWindowName: window.providerWindowName,
      usedPercentage: this.normalisePercentage(window.usedPercentage),
      resetAt: window.resetAt,
      resetInText: this.formatResetInText(window.resetAt),
      status: result.status,
      hint: window.hint ?? null
    }));

    return Promise.resolve({
      provider: account.provider,
      email: account.email,
      displayOrder: account.displayOrder,
      status: result.status,
      windows,
      lastSuccessfulRefreshAt: result.status === 'fresh' ? nowIso : null,
      lastAttemptedRefreshAt: nowIso,
      stale: result.status === 'stale',
      errorHint: result.errorHint ?? null
    });
  }

  protected normalisePercentage(value: number | null): number | null {
    if (value === null || Number.isNaN(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  protected formatResetInText(resetAt: string | null): string | null {
    if (!resetAt) return null;

    const reset = new Date(resetAt);
    const resetTime = reset.getTime();
    if (Number.isNaN(resetTime)) return null;

    const diffMs = resetTime - this.clock.now().getTime();
    if (diffMs <= 0) return 'resets now';

    const totalMinutes = Math.ceil(diffMs / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `resets in ${String(days)}d ${String(hours)}h`;
    if (hours > 0) return `resets in ${String(hours)}h ${String(minutes)}m`;
    return `resets in ${String(minutes)}m`;
  }

  protected mapErrorToStatus(error: unknown): AccountStatus {
    return statusFromError(error);
  }

  diagnose?(_account: ConfiguredAccount): Promise<ProviderDiagnosticResult>;
}
