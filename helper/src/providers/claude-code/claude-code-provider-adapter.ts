import type {
  AccountValidationResult,
  AuthSession,
  ConfiguredAccount,
  ProviderQuotaResult
} from '../../domain/index.js';
import {
  AbstractProviderAdapter,
  ConfigError,
  NodeProviderCommandRunner,
  ProviderSpikeRequiredError,
  type AuthResult,
  type Clock,
  type ProviderAuthSessionCapability,
  type ProviderCommandRunner,
  type ProviderDiagnosticResult
} from '../base/index.js';
import {
  ClaudeCodeCliAuthStatusTransport,
  ClaudeCodeOAuthUsageTransport,
  fetchClaudeCodeQuotaWithTransport,
  validateClaudeCodeAccountWithTransport,
  type ClaudeCodeAuthStatusTransport,
  type ClaudeCodeQuotaTransport
} from './claude-code-transport.js';

export const CLAUDE_CODE_PROVIDER_ID = 'claude-code';

const spikeMessage =
  'Claude Code setup remains blocked until AIQM-owned login is fully implemented.';

export type ClaudeCodeProviderAdapterOptions = {
  authStatusTransport?: ClaudeCodeAuthStatusTransport;
  quotaTransport?: ClaudeCodeQuotaTransport;
  claudeConfigDir?: string;
};

type ResolvedClaudeCodeProviderAdapterOptions = ClaudeCodeProviderAdapterOptions & {
  authStatusTransport: ClaudeCodeAuthStatusTransport;
  quotaTransport: ClaudeCodeQuotaTransport;
};

export class ClaudeCodeProviderAdapter extends AbstractProviderAdapter {
  readonly providerId = CLAUDE_CODE_PROVIDER_ID;
  readonly providerName = 'Claude Code';
  readonly authSessions: ProviderAuthSessionCapability;
  private readonly options: ResolvedClaudeCodeProviderAdapterOptions;

  constructor(
    commandRunner?: ProviderCommandRunner,
    clock?: Clock,
    options: ClaudeCodeProviderAdapterOptions = {}
  ) {
    super(clock);
    const runner = commandRunner ?? new NodeProviderCommandRunner();
    this.options = {
      authStatusTransport: new ClaudeCodeCliAuthStatusTransport(runner),
      quotaTransport: new ClaudeCodeOAuthUsageTransport(runner),
      ...options
    };
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

  async validateAccount(
    _tokenRef: { provider: 'claude-code'; accountId: string },
    expectedEmail: string
  ): Promise<AccountValidationResult> {
    const claudeConfigDir = this.claudeConfigDirForAccountId(_tokenRef.accountId);
    return validateClaudeCodeAccountWithTransport(this.options.authStatusTransport, {
      claudeConfigDir,
      expectedEmail
    });
  }

  async fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult> {
    const claudeConfigDir = this.claudeConfigDirFor(account);
    return fetchClaudeCodeQuotaWithTransport(this.options.quotaTransport, {
      claudeConfigDir,
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

  private claudeConfigDirFor(account: ConfiguredAccount): string {
    const configured = this.options.claudeConfigDir ?? account.providerConfig?.claudeConfigDir;
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new ConfigError('Claude Code account requires providerConfig.claudeConfigDir');
    }
    return configured;
  }

  private claudeConfigDirForAccountId(accountId: string): string {
    const configured = this.options.claudeConfigDir;
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new ConfigError(
        `Claude Code account requires providerConfig.claudeConfigDir: ${accountId}`
      );
    }
    return configured;
  }

  private reject<T>(): Promise<T> {
    return Promise.reject(new ProviderSpikeRequiredError(spikeMessage));
  }
}
