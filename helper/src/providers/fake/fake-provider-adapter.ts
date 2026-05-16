import {
  accountIdFor,
  normalizeEmail,
  type AccountValidationResult,
  type AuthSession,
  type ConfiguredAccount,
  type ProviderQuotaResult
} from '../../domain/index.js';
import type { TokenRef } from '../../storage/index.js';
import {
  AbstractProviderAdapter,
  AuthRequiredError,
  ConfigError,
  ProviderError,
  ProviderShapeChangedError,
  ProviderUnavailableError,
  type AuthInput,
  type AuthResult,
  type AuthSessionCompleteInput,
  type AuthSessionStartInput,
  type Clock,
  type ProviderAuthSessionCapability
} from '../base/index.js';

export const FAKE_PROVIDER_ID = 'fake';

export type FakeProviderScenario =
  | 'success'
  | 'multi_window'
  | 'auth_required'
  | 'offline'
  | 'provider_error'
  | 'malformed'
  | 'email_mismatch';

export type FakeProviderConfig = {
  scenario?: FakeProviderScenario;
  actualEmail?: string;
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const fakeProviderScenarios = new Set<string>([
  'success',
  'multi_window',
  'auth_required',
  'offline',
  'provider_error',
  'malformed',
  'email_mismatch'
]);

function readFakeProviderConfig(account: ConfiguredAccount): FakeProviderConfig {
  return account.providerConfig ?? {};
}

function readScenario(account: ConfiguredAccount): FakeProviderScenario {
  const scenario = readFakeProviderConfig(account).scenario ?? 'success';
  if (!fakeProviderScenarios.has(scenario)) {
    throw new ConfigError(`Unknown fake provider scenario: ${scenario}`);
  }
  return scenario;
}

function futureIso(clock: Clock, offsetMs: number): string {
  return new Date(clock.now().getTime() + offsetMs).toISOString();
}

function emailFromTokenRef(tokenRef: TokenRef): string | null {
  const prefix = `${tokenRef.provider}:`;
  if (!tokenRef.accountId.startsWith(prefix)) return null;
  return tokenRef.accountId.slice(prefix.length);
}

export class FakeProviderAdapter extends AbstractProviderAdapter {
  readonly providerId = FAKE_PROVIDER_ID;
  readonly providerName = 'Fake Provider';
  readonly authSessions: ProviderAuthSessionCapability;
  private readonly sessions = new Map<string, AuthSession>();
  private nextSessionId = 1;

  // Explicit public constructor wires fake auth session capability for test/provider callers.
  constructor(clock?: Clock) {
    super(clock);
    this.authSessions = {
      startAuthSession: (input) => this.startAuthSession(input),
      getAuthSession: (sessionId) => this.getAuthSession(sessionId),
      completeAuthSession: (input) => this.completeAuthSession(input),
      cancelAuthSession: (sessionId) => this.cancelAuthSession(sessionId)
    };
  }

  async authenticate(input: AuthInput): Promise<AuthResult> {
    const session = await this.startAuthSession(input);
    const completed = await this.completeAuthSession({ sessionId: session.id });
    if (completed.status !== 'succeeded' || !completed.tokenRef || !completed.authenticatedEmail) {
      throw new ProviderError(completed.userMessage ?? 'Fake authentication did not complete');
    }

    return {
      provider: this.providerId,
      email: completed.authenticatedEmail,
      tokenRef: completed.tokenRef,
      authenticatedAt: completed.completedAt ?? this.clock.nowIso()
    };
  }

  private startAuthSession(input: AuthSessionStartInput): Promise<AuthSession> {
    if (input.provider !== this.providerId) {
      return Promise.reject(
        new ProviderError(`Unsupported provider for fake adapter: ${input.provider}`)
      );
    }

    const now = this.clock.now();
    const createdAt = this.clock.nowIso();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const expectedEmail = normalizeEmail(input.expectedEmail);
    const session: AuthSession = {
      id: `fake-auth-${String(this.nextSessionId)}`,
      provider: this.providerId,
      expectedEmail,
      status: 'waiting',
      createdAt,
      expiresAt,
      completedAt: null,
      authenticatedEmail: null,
      tokenRef: null,
      failureReason: null,
      userMessage: 'Fake auth session is waiting for deterministic completion'
    };
    this.nextSessionId += 1;
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  private getAuthSession(sessionId: string): Promise<AuthSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject(new ConfigError(`Unknown fake auth session: ${sessionId}`));
    }
    if (
      session.status === 'waiting' &&
      new Date(session.expiresAt).getTime() <= this.clock.now().getTime()
    ) {
      const expired = this.updateSession(session, {
        status: 'expired',
        completedAt: this.clock.nowIso(),
        failureReason: 'expired',
        userMessage: 'Fake auth session expired'
      });
      return Promise.resolve(expired);
    }
    return Promise.resolve({ ...session });
  }

  private async completeAuthSession(input: AuthSessionCompleteInput): Promise<AuthSession> {
    const session = await this.getAuthSession(input.sessionId);
    if (session.status !== 'waiting') return session;

    if (input.outcome === 'expired') {
      return this.updateSession(session, {
        status: 'expired',
        completedAt: this.clock.nowIso(),
        failureReason: 'expired',
        userMessage: input.errorHint ?? 'Fake auth session expired'
      });
    }

    if (input.outcome === 'failure') {
      return this.updateSession(session, {
        status: 'failed',
        completedAt: this.clock.nowIso(),
        failureReason: 'provider_error',
        userMessage: input.errorHint ?? 'Fake auth session failed'
      });
    }

    const email = normalizeEmail(input.actualEmail ?? session.expectedEmail);
    return this.updateSession(session, {
      status: 'succeeded',
      completedAt: this.clock.nowIso(),
      authenticatedEmail: email,
      tokenRef: {
        provider: this.providerId,
        accountId: accountIdFor(this.providerId, email)
      },
      failureReason: null,
      userMessage: 'Fake auth session completed'
    });
  }

  private async cancelAuthSession(sessionId: string): Promise<AuthSession> {
    const session = await this.getAuthSession(sessionId);
    if (session.status !== 'waiting') return session;
    return this.updateSession(session, {
      status: 'cancelled',
      completedAt: this.clock.nowIso(),
      failureReason: 'cancelled',
      userMessage: 'Fake auth session cancelled'
    });
  }

  private updateSession(session: AuthSession, patch: Partial<AuthSession>): AuthSession {
    const updated = { ...session, ...patch };
    this.sessions.set(updated.id, updated);
    return { ...updated };
  }

  validateAccount(tokenRef: TokenRef, expectedEmail: string): Promise<AccountValidationResult> {
    const normalizedExpectedEmail = normalizeEmail(expectedEmail);
    const actualEmail = emailFromTokenRef(tokenRef);
    const matches = actualEmail === normalizedExpectedEmail;

    return Promise.resolve({
      provider: this.providerId,
      expectedEmail: normalizedExpectedEmail,
      actualEmail,
      matches,
      canReadQuota: matches,
      hint: matches ? null : 'Authenticated fake account email does not match expected email'
    });
  }

  fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult> {
    let scenario: FakeProviderScenario;
    try {
      scenario = readScenario(account);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new ConfigError(String(error)));
    }
    const config = readFakeProviderConfig(account);

    switch (scenario) {
      case 'success':
        return Promise.resolve(this.successQuota(account));
      case 'multi_window':
        return Promise.resolve(this.multiWindowQuota(account));
      case 'auth_required':
        return Promise.reject(new AuthRequiredError('Fake provider requires authentication'));
      case 'offline':
        return Promise.reject(new ProviderUnavailableError('Fake provider is offline'));
      case 'provider_error':
        return Promise.reject(new ProviderError('Fake provider returned an error'));
      case 'malformed':
        return Promise.reject(
          new ProviderShapeChangedError('Fake provider response shape changed')
        );
      case 'email_mismatch':
        return Promise.resolve({
          ...this.successQuota(account),
          accountEmail: normalizeEmail(config.actualEmail ?? `other-${account.email}`),
          status: 'config_error',
          errorHint: 'Fake provider account email did not match configured account'
        });
    }
  }

  private successQuota(account: ConfiguredAccount): ProviderQuotaResult {
    return {
      provider: this.providerId,
      accountEmail: normalizeEmail(account.email),
      fetchedAt: this.clock.nowIso(),
      status: 'fresh',
      windows: [
        {
          id: 'weekly',
          providerWindowName: 'Weekly fake quota',
          usedPercentage: 42,
          resetAt: futureIso(this.clock, 5 * hourMs),
          hint: 'Deterministic fake provider quota'
        }
      ],
      errorHint: null,
      rawMetadata: this.rawMetadata()
    };
  }

  private multiWindowQuota(account: ConfiguredAccount): ProviderQuotaResult {
    return {
      provider: this.providerId,
      accountEmail: normalizeEmail(account.email),
      fetchedAt: this.clock.nowIso(),
      status: 'fresh',
      windows: [
        {
          id: 'daily',
          providerWindowName: 'Daily fake quota',
          usedPercentage: 10,
          resetAt: futureIso(this.clock, dayMs),
          hint: null
        },
        {
          id: 'weekly',
          providerWindowName: 'Weekly fake quota',
          usedPercentage: 75,
          resetAt: futureIso(this.clock, 7 * dayMs),
          hint: 'Heavy weekly fake usage'
        }
      ],
      errorHint: null,
      rawMetadata: this.rawMetadata()
    };
  }

  private rawMetadata(): Record<string, unknown> {
    return {
      deterministicFixture: true
    };
  }
}
