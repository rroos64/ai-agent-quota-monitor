import {
  accountIdFor,
  normalizeEmail,
  type ConfiguredAccount,
  type ProviderId
} from '../domain/index.js';
import type { DiagnosticsLogger } from '../diagnostics/index.js';
import type { FakeProviderScenario, ProviderRegistry } from '../providers/index.js';
import type { ConfigStore, ProviderProfileStore, TokenStore } from '../storage/index.js';
import type { TokenRecordContract } from '../validation/index.js';
import type { AuthService } from './auth-service.js';
import type { ProviderCapabilitiesService } from './provider-capabilities-service.js';

export type FakeAccountSetupInput = {
  provider: ProviderId;
  email: string;
  scenario: FakeProviderScenario;
  displayName?: string;
  displayOrder: number;
  authActualEmail?: string;
};

export type FakeAccountSetupResult = {
  added: true;
  account: ConfiguredAccount;
  tokenRef: {
    accountId: string;
    provider: ProviderId;
  };
};

export type FakeSetupFlowPhase =
  | 'home'
  | 'provider'
  | 'email'
  | 'start_auth'
  | 'instructions'
  | 'waiting'
  | 'complete_auth'
  | 'validate'
  | 'test_quota'
  | 'save'
  | 'poll'
  | 'success'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'email_mismatch'
  | 'quota_unreadable';

export type FakeSetupFlowEvent = {
  phase: FakeSetupFlowPhase;
  message: string;
};

export type InteractiveFakeAccountSetupInput = FakeAccountSetupInput & {
  pollAfterAdd: boolean;
  authOutcome?: 'success' | 'failure' | 'expired' | 'cancelled';
};

export type SetupFlowServiceOptions = {
  authService: AuthService;
  configStore: ConfigStore;
  tokenStore: TokenStore;
  logger: DiagnosticsLogger;
  providerRegistry: ProviderRegistry;
  providerProfileStore: ProviderProfileStore;
  providerCapabilitiesService: ProviderCapabilitiesService;
};

export class SetupFlowService {
  constructor(private readonly options: SetupFlowServiceOptions) {}

  async addFakeAccount(input: FakeAccountSetupInput): Promise<FakeAccountSetupResult> {
    const accountRecord = this.buildFakeAccountRecord(input);
    const completed = await this.authenticateFakeAccount(input);
    return this.saveFakeAccount(accountRecord, input, completed.tokenRef);
  }

  async runInteractiveFakeAccountSetup(
    input: InteractiveFakeAccountSetupInput,
    onEvent: (event: FakeSetupFlowEvent) => void = () => undefined
  ): Promise<FakeAccountSetupResult> {
    onEvent({ phase: 'provider', message: 'Provider selected: fake' });
    onEvent({ phase: 'email', message: `Email entered: ${normalizeEmail(input.email)}` });
    onEvent({ phase: 'start_auth', message: 'Starting fake provider login session' });
    onEvent({
      phase: 'instructions',
      message: 'Fake login: press Enter to complete the deterministic local auth session'
    });

    const accountRecord = this.buildFakeAccountRecord(input);
    const completed = await this.authenticateFakeAccount(input, onEvent, input.authOutcome);

    onEvent({ phase: 'validate', message: 'Validating authenticated account identity' });
    if (completed.authenticatedEmail !== accountRecord.email) {
      onEvent({
        phase: 'email_mismatch',
        message: `Authenticated account email does not match expected email: ${completed.authenticatedEmail}`
      });
      throw new Error(
        `Authenticated account email does not match expected email: ${completed.authenticatedEmail}`
      );
    }

    onEvent({ phase: 'test_quota', message: 'Testing quota read before saving account' });
    await this.testQuotaReadable(accountRecord, onEvent);

    onEvent({ phase: 'save', message: 'Saving fake account token reference' });
    const result = await this.saveFakeAccount(accountRecord, input, completed.tokenRef);

    if (input.pollAfterAdd) {
      onEvent({ phase: 'poll', message: 'Polling after setup' });
    }
    onEvent({ phase: 'success', message: `Added fake:${accountRecord.email}` });
    return result;
  }

  private async authenticateFakeAccount(
    input: FakeAccountSetupInput,
    onEvent: (event: FakeSetupFlowEvent) => void = () => undefined,
    authOutcome: 'success' | 'failure' | 'expired' | 'cancelled' = 'success'
  ) {
    const provider = input.provider;
    this.options.providerCapabilitiesService.assertUsable(provider);
    const email = normalizeEmail(input.email);
    const session = await this.options.authService.startSession({
      provider,
      expectedEmail: email,
      interactive: false
    });
    onEvent({ phase: 'waiting', message: 'Waiting for fake provider login completion' });
    const completed =
      authOutcome === 'cancelled'
        ? await this.options.authService.cancelSession(provider, session.id)
        : await this.options.authService.completeSession(provider, {
            sessionId: session.id,
            actualEmail: input.authActualEmail,
            outcome: authOutcome === 'success' ? undefined : authOutcome
          });
    onEvent({ phase: 'complete_auth', message: `Fake auth status: ${completed.status}` });

    if (completed.status !== 'succeeded' || !completed.tokenRef || !completed.authenticatedEmail) {
      const phase =
        completed.status === 'expired' || completed.status === 'cancelled'
          ? completed.status
          : 'failed';
      onEvent({
        phase,
        message: completed.userMessage ?? `Authentication failed: ${provider}:${email}`
      });
      throw new Error(completed.userMessage ?? `Authentication failed: ${provider}:${email}`);
    }

    if (completed.authenticatedEmail !== email) {
      onEvent({
        phase: 'email_mismatch',
        message: `Authenticated account email does not match expected email: ${completed.authenticatedEmail}`
      });
      throw new Error(
        `Authenticated account email does not match expected email: ${completed.authenticatedEmail}`
      );
    }

    return completed as typeof completed & {
      authenticatedEmail: string;
      tokenRef: { provider: ProviderId; accountId: string };
    };
  }

  private buildFakeAccountRecord(input: FakeAccountSetupInput): ConfiguredAccount {
    const provider = input.provider;
    const email = normalizeEmail(input.email);
    const now = new Date().toISOString();
    return {
      id: accountIdFor(provider, email),
      provider,
      email,
      displayOrder: input.displayOrder,
      providerConfig: {
        scenario: input.scenario,
        ...(input.displayName ? { displayName: input.displayName } : {})
      },
      createdAt: now,
      updatedAt: now
    };
  }

  private async testQuotaReadable(
    accountRecord: ConfiguredAccount,
    onEvent: (event: FakeSetupFlowEvent) => void
  ): Promise<void> {
    const adapter = this.options.providerRegistry.get(accountRecord.provider);
    try {
      const quota = await adapter.fetchQuota(accountRecord);
      if (quota.status !== 'fresh' || quota.accountEmail !== accountRecord.email) {
        const message = quota.errorHint ?? 'Fake provider quota is not readable for this account';
        const phase =
          quota.accountEmail !== accountRecord.email ? 'email_mismatch' : 'quota_unreadable';
        onEvent({ phase, message });
        throw new Error(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ phase: 'quota_unreadable', message });
      throw new Error(`Quota unreadable during setup: ${message}`);
    }
  }

  private async saveFakeAccount(
    accountRecord: ConfiguredAccount,
    input: FakeAccountSetupInput,
    tokenRef: { provider: ProviderId; accountId: string }
  ): Promise<FakeAccountSetupResult> {
    const provider = accountRecord.provider;
    const email = accountRecord.email;
    const now = new Date().toISOString();
    const tokenRecord: TokenRecordContract = {
      schemaVersion: '1',
      accountId: accountRecord.id,
      provider,
      email,
      createdAt: now,
      updatedAt: now,
      tokenType: 'fake-token-ref',
      tokenPayload: {}
    };

    await this.options.configStore.addAccount(accountRecord);
    await this.options.tokenStore.setToken(tokenRecord);
    await this.options.providerProfileStore.saveMetadata({
      schemaVersion: '1',
      provider,
      email,
      createdAt: accountRecord.createdAt,
      updatedAt: accountRecord.updatedAt,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      metadata: { scenario: input.scenario }
    });
    await this.options.logger.info('account.add', 'Account added', {
      accountId: accountRecord.id,
      provider,
      email,
      scenario: input.scenario,
      displayOrder: accountRecord.displayOrder
    });

    return {
      added: true,
      account: accountRecord,
      tokenRef
    };
  }
}
