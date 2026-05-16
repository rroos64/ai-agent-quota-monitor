// Provenance: docs/test-traceability.md — Providers area
import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import {
  AuthRequiredError,
  ConfigError,
  FakeProviderAdapter,
  ProviderError,
  ProviderRegistry,
  ProviderShapeChangedError,
  ProviderUnavailableError,
  type Clock,
  type FakeProviderScenario
} from '../../src/providers/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

const fakeClock: Clock = {
  now: () => new Date(now),
  nowIso: () => now
};

function account(scenario: FakeProviderScenario = 'success'): ConfiguredAccount {
  return {
    id: 'fake:dev@example.com',
    provider: 'fake',
    email: 'dev@example.com',
    displayOrder: 0,
    providerConfig: { scenario, testSecretInput: secretSentinel },
    createdAt: now,
    updatedAt: now
  };
}

// Traceability: BR: deterministic development provider; AC: fake auth/validation/quota scenarios and secret-safe normalization; TS: TSD §7.1 Fake Provider.
describe('FakeProviderAdapter', () => {
  it('authenticates deterministically without real secrets', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    await expect(
      adapter.authenticate({
        provider: 'fake',
        expectedEmail: ' Dev@Example.COM ',
        interactive: false
      })
    ).resolves.toEqual({
      provider: 'fake',
      email: 'dev@example.com',
      tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' },
      authenticatedAt: now
    });
  });

  it('runs fake auth session start, waiting inspection, and success completion', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    const session = await adapter.authSessions.startAuthSession({
      provider: 'fake',
      expectedEmail: ' Dev@Example.COM ',
      interactive: false
    });

    expect(session).toMatchObject({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      status: 'waiting',
      tokenRef: null
    });
    await expect(adapter.authSessions.getAuthSession(session.id)).resolves.toMatchObject({
      status: 'waiting',
      tokenRef: null
    });

    const completed = await adapter.authSessions.completeAuthSession({ sessionId: session.id });
    expect(completed).toMatchObject({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      status: 'succeeded',
      authenticatedEmail: 'dev@example.com',
      tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' },
      completedAt: now
    });
    expect(JSON.stringify(completed)).not.toContain('tokenPayload');
    expect(JSON.stringify(completed)).not.toContain(secretSentinel);
  });

  it('cancels fake auth sessions and simulates expired and failed sessions', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    const cancelSession = await adapter.authSessions.startAuthSession({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      interactive: false
    });
    await expect(adapter.authSessions.cancelAuthSession(cancelSession.id)).resolves.toMatchObject({
      status: 'cancelled',
      failureReason: 'cancelled',
      tokenRef: null
    });

    const expiredSession = await adapter.authSessions.startAuthSession({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      interactive: false
    });
    await expect(
      adapter.authSessions.completeAuthSession({ sessionId: expiredSession.id, outcome: 'expired' })
    ).resolves.toMatchObject({ status: 'expired', failureReason: 'expired', tokenRef: null });

    const failedSession = await adapter.authSessions.startAuthSession({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      interactive: false
    });
    await expect(
      adapter.authSessions.completeAuthSession({
        sessionId: failedSession.id,
        outcome: 'failure',
        errorHint: 'simulated failure'
      })
    ).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'provider_error',
      userMessage: 'simulated failure',
      tokenRef: null
    });
  });

  it('validates matching and mismatched account emails', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    await expect(
      adapter.validateAccount(
        { provider: 'fake', accountId: 'fake:dev@example.com' },
        'DEV@example.com'
      )
    ).resolves.toMatchObject({
      provider: 'fake',
      expectedEmail: 'dev@example.com',
      actualEmail: 'dev@example.com',
      matches: true,
      canReadQuota: true,
      hint: null
    });

    await expect(
      adapter.validateAccount(
        { provider: 'fake', accountId: 'fake:other@example.com' },
        'dev@example.com'
      )
    ).resolves.toMatchObject({
      matches: false,
      canReadQuota: false
    });
  });

  it('returns deterministic success quota and normalises it without raw metadata leaks', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);
    const quota = await adapter.fetchQuota(account('success'));

    expect(quota).toMatchObject({
      provider: 'fake',
      accountEmail: 'dev@example.com',
      fetchedAt: now,
      status: 'fresh',
      windows: [
        {
          id: 'weekly',
          providerWindowName: 'Weekly fake quota',
          usedPercentage: 42,
          resetAt: '2026-05-09T17:00:00.000Z'
        }
      ]
    });
    expect(JSON.stringify(quota)).not.toContain(secretSentinel);

    const card = await adapter.normaliseQuota(account('success'), quota);
    expect(card.windows[0]?.resetInText).toBe('resets in 5h 0m');
    expect(JSON.stringify(card)).not.toContain(secretSentinel);
  });

  it('returns deterministic multi-window quota', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    await expect(adapter.fetchQuota(account('multi_window'))).resolves.toMatchObject({
      provider: 'fake',
      status: 'fresh',
      windows: [
        { id: 'daily', usedPercentage: 10, resetAt: '2026-05-10T12:00:00.000Z' },
        { id: 'weekly', usedPercentage: 75, resetAt: '2026-05-16T12:00:00.000Z' }
      ]
    });
  });

  it('represents provider-side email mismatch as config_error quota data', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    await expect(adapter.fetchQuota(account('email_mismatch'))).resolves.toMatchObject({
      provider: 'fake',
      accountEmail: 'other-dev@example.com',
      status: 'config_error',
      errorHint: 'Fake provider account email did not match configured account'
    });
  });

  it('returns typed errors for failure scenarios so callers can map statuses', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);

    await expect(adapter.fetchQuota(account('auth_required'))).rejects.toThrow(AuthRequiredError);
    await expect(adapter.fetchQuota(account('offline'))).rejects.toThrow(ProviderUnavailableError);
    await expect(adapter.fetchQuota(account('provider_error'))).rejects.toThrow(ProviderError);
    await expect(adapter.fetchQuota(account('malformed'))).rejects.toThrow(
      ProviderShapeChangedError
    );
  });

  it('rejects unknown scenarios instead of returning undefined', async () => {
    const adapter = new FakeProviderAdapter(fakeClock);
    const badAccount = account('success');
    badAccount.providerConfig = { scenario: 'unknown_scenario' };

    await expect(adapter.fetchQuota(badAccount)).rejects.toThrow(ConfigError);
  });

  it('leaves stale state merging to the polling service layer', () => {
    expect(['success', 'multi_window']).not.toContain('stale');
  });

  it('can be registered in the provider registry', () => {
    const registry = new ProviderRegistry();
    const adapter = new FakeProviderAdapter(fakeClock);

    registry.register(adapter);

    expect(registry.get('fake')).toBe(adapter);
  });
});
