import type {
  AccountValidationResult,
  AuthSession,
  ConfiguredAccount,
  ProviderQuotaResult
} from '../../domain/index.js';
import {
  AbstractProviderAdapter,
  ConfigError,
  ProviderSpikeRequiredError,
  type AuthResult,
  type Clock,
  type ProviderAuthSessionCapability,
  type ProviderCommandRunner,
  type ProviderDiagnosticResult
} from '../base/index.js';
import {
  CodexLiveAppServerRateLimitsTransport,
  fetchCodexRateLimitsWithTransport,
  type CodexRateLimitsTransport
} from './rate-limits-transport.js';

export const CODEX_PROVIDER_ID = 'codex';

const spikeMessage = 'Codex account requires providerConfig.codexHome for live quota polling.';

export type CodexProviderAdapterOptions = {
  rateLimitsTransport?: CodexRateLimitsTransport;
  codexHome?: string;
};

export class CodexProviderAdapter extends AbstractProviderAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly providerName = 'Codex';
  readonly authSessions: ProviderAuthSessionCapability;

  constructor(
    _commandRunner?: ProviderCommandRunner,
    clock?: Clock,
    private readonly options: CodexProviderAdapterOptions = {
      rateLimitsTransport: new CodexLiveAppServerRateLimitsTransport()
    }
  ) {
    super(clock);
    this.authSessions = {
      startAuthSession: () => this.rejectAuthSession(),
      getAuthSession: () => this.rejectAuthSession(),
      completeAuthSession: () => this.rejectAuthSession(),
      cancelAuthSession: () => this.rejectAuthSession()
    };
  }

  authenticate(): Promise<AuthResult> {
    return this.reject();
  }

  validateAccount(): Promise<AccountValidationResult> {
    return this.reject();
  }

  async fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult> {
    const codexHome = this.codexHomeFor(account);
    const transport =
      this.options.rateLimitsTransport ?? new CodexLiveAppServerRateLimitsTransport();

    return await fetchCodexRateLimitsWithTransport(transport, {
      codexHome,
      accountEmail: account.email,
      fetchedAt: this.clock.nowIso()
    });
  }

  diagnose(): Promise<ProviderDiagnosticResult> {
    return this.reject();
  }

  private rejectAuthSession(): Promise<AuthSession> {
    return this.reject();
  }

  private codexHomeFor(account: ConfiguredAccount): string {
    const configured = this.options.codexHome ?? account.providerConfig?.codexHome;
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new ConfigError(spikeMessage);
    }
    return configured;
  }

  private reject<T>(): Promise<T> {
    return Promise.reject(
      new ProviderSpikeRequiredError('Codex browser login/setup remains manual.')
    );
  }
}
