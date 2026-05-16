// Provenance: docs/test-traceability.md — Providers area
import { describe, expect, it } from 'vitest';
import type {
  AccountValidationResult,
  ConfiguredAccount,
  ProviderQuotaResult
} from '../../src/domain/index.js';
import {
  AuthRequiredError,
  ConfigError,
  OfflineError,
  ProviderError
} from '../../src/domain/index.js';
import type { TokenRef } from '../../src/storage/index.js';
import {
  AbstractProviderAdapter,
  DuplicateProviderError,
  ProviderRegistry,
  UnknownProviderError,
  type AuthInput,
  type AuthResult,
  type Clock,
  type ProviderAdapter
} from '../../src/providers/index.js';

const now = '2026-05-09T12:00:00.000Z';

const fakeClock: Clock = {
  now: () => new Date(now),
  nowIso: () => now
};

const account: ConfiguredAccount = {
  id: 'codex:dev@example.com',
  provider: 'codex',
  email: 'dev@example.com',
  displayOrder: 0,
  createdAt: now,
  updatedAt: now
};

class TestProviderAdapter extends AbstractProviderAdapter {
  readonly providerId = 'codex';
  readonly providerName = 'Codex Test';

  constructor(clock: Clock = fakeClock) {
    super(clock);
  }

  authenticate(input: AuthInput): Promise<AuthResult> {
    return Promise.resolve({
      provider: input.provider,
      email: input.expectedEmail,
      tokenRef: { provider: input.provider, accountId: `${input.provider}:${input.expectedEmail}` },
      authenticatedAt: this.clock.nowIso()
    });
  }

  validateAccount(tokenRef: TokenRef, expectedEmail: string): Promise<AccountValidationResult> {
    return Promise.resolve({
      provider: tokenRef.provider,
      expectedEmail,
      actualEmail: expectedEmail,
      matches: true,
      canReadQuota: true,
      hint: null
    });
  }

  fetchQuota(): Promise<ProviderQuotaResult> {
    return Promise.resolve({
      provider: 'codex',
      accountEmail: 'dev@example.com',
      fetchedAt: this.clock.nowIso(),
      status: 'fresh',
      windows: []
    });
  }

  exposeNormalisePercentage(value: number | null): number | null {
    return this.normalisePercentage(value);
  }

  exposeFormatResetInText(resetAt: string | null): string | null {
    return this.formatResetInText(resetAt);
  }

  exposeMapErrorToStatus(error: unknown): string {
    return this.mapErrorToStatus(error);
  }
}

// Traceability: BR: extensible provider adapter boundary; AC: registry, normalization, reset text, typed errors; TS: TSD §6 provider adapter design.
describe('ProviderRegistry', () => {
  it('registers, lists, checks, and retrieves provider adapters', () => {
    const registry = new ProviderRegistry();
    const adapter = new TestProviderAdapter();

    registry.register(adapter);

    expect(registry.has('codex')).toBe(true);
    expect(registry.get('codex')).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it('rejects duplicate providers and unknown providers with typed errors', () => {
    const registry = new ProviderRegistry();
    const adapter = new TestProviderAdapter();

    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow(DuplicateProviderError);
    expect(() => registry.get('fake')).toThrow(UnknownProviderError);
  });
});

describe('AbstractProviderAdapter', () => {
  it('normalises quota results into display-safe account quota cards', async () => {
    const adapter = new TestProviderAdapter();

    await expect(
      adapter.normaliseQuota(account, {
        provider: 'codex',
        accountEmail: 'dev@example.com',
        fetchedAt: now,
        status: 'fresh',
        windows: [
          {
            id: 'weekly',
            providerWindowName: 'Weekly',
            usedPercentage: 42.4,
            resetAt: '2026-05-09T14:30:00.000Z',
            hint: undefined
          }
        ],
        errorHint: undefined,
        rawMetadata: { ignored: true }
      })
    ).resolves.toEqual({
      provider: 'codex',
      email: 'dev@example.com',
      displayOrder: 0,
      status: 'fresh',
      windows: [
        {
          id: 'weekly',
          providerWindowName: 'Weekly',
          usedPercentage: 42,
          resetAt: '2026-05-09T14:30:00.000Z',
          resetInText: 'resets in 2h 30m',
          status: 'fresh',
          hint: null
        }
      ],
      lastSuccessfulRefreshAt: now,
      lastAttemptedRefreshAt: now,
      stale: false,
      errorHint: null
    });
  });

  it('normalises percentages by rounding, clamping, and mapping NaN to null', () => {
    const adapter = new TestProviderAdapter();

    expect(adapter.exposeNormalisePercentage(null)).toBeNull();
    expect(adapter.exposeNormalisePercentage(Number.NaN)).toBeNull();
    expect(adapter.exposeNormalisePercentage(-1)).toBe(0);
    expect(adapter.exposeNormalisePercentage(42.6)).toBe(43);
    expect(adapter.exposeNormalisePercentage(101)).toBe(100);
  });

  it('formats reset text with a fake clock', () => {
    const adapter = new TestProviderAdapter();

    expect(adapter.exposeFormatResetInText(null)).toBeNull();
    expect(adapter.exposeFormatResetInText('not-a-date')).toBeNull();
    expect(adapter.exposeFormatResetInText('2026-05-09T11:59:00.000Z')).toBe('resets now');
    expect(adapter.exposeFormatResetInText('2026-05-09T12:01:00.000Z')).toBe('resets in 1m');
    expect(adapter.exposeFormatResetInText('2026-05-09T14:30:00.000Z')).toBe('resets in 2h 30m');
    expect(adapter.exposeFormatResetInText('2026-05-11T15:00:00.000Z')).toBe('resets in 2d 3h');
  });

  it('maps typed provider errors to account statuses', () => {
    const adapter = new TestProviderAdapter();

    expect(adapter.exposeMapErrorToStatus(new AuthRequiredError())).toBe('auth_required');
    expect(adapter.exposeMapErrorToStatus(new OfflineError())).toBe('offline');
    expect(adapter.exposeMapErrorToStatus(new ConfigError())).toBe('config_error');
    expect(adapter.exposeMapErrorToStatus(new ProviderError())).toBe('provider_error');
    expect(adapter.exposeMapErrorToStatus(new Error('boom'))).toBe('provider_error');
  });

  it('does not copy raw metadata into normalised quota output', async () => {
    const adapter = new TestProviderAdapter();
    const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

    const output = await adapter.normaliseQuota(account, {
      provider: 'codex',
      accountEmail: 'dev@example.com',
      fetchedAt: now,
      status: 'fresh',
      windows: [],
      rawMetadata: { accessToken: secretSentinel }
    });

    expect(JSON.stringify(output)).not.toContain(secretSentinel);
  });

  it('satisfies the provider adapter interface shape', () => {
    const adapter: ProviderAdapter = new TestProviderAdapter();

    expect(adapter.providerId).toBe('codex');
    expect(adapter.providerName).toBe('Codex Test');
    expect(typeof adapter.authenticate).toBe('function');
    expect(typeof adapter.validateAccount).toBe('function');
    expect(typeof adapter.fetchQuota).toBe('function');
    expect(typeof adapter.normaliseQuota).toBe('function');
  });
});
