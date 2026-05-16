// Provenance: docs/test-traceability.md — Providers area
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import {
  AuthRequiredError,
  CodexProviderAdapter,
  CodexRateLimitsTransportError,
  ProviderSpikeRequiredError,
  ProviderUnavailableError,
  StubCodexRateLimitsTransport
} from '../../src/providers/index.js';
import { createAppServices } from '../../src/app/index.js';
import { ProviderCapabilitiesService } from '../../src/services/index.js';

const now = '2026-05-13T12:00:00.000Z';
const codexHome = '/tmp/redacted-codex-home';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

const clock = {
  now: () => new Date(now),
  nowIso: () => now
};

const account: ConfiguredAccount = {
  id: 'codex:codex-user@example.test',
  provider: 'codex',
  email: 'codex-user@example.test',
  displayOrder: 7,
  createdAt: now,
  updatedAt: now
};

function fixture(): unknown {
  const path = resolve(
    process.cwd(),
    '../fixtures/providers/codex/quota-success.redacted.example.json'
  );
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// Traceability: CODEX live provider MVP internal transport wiring; auth/setup remain gated while quota polling is enabled for accounts with codexHome.
describe('CodexProviderAdapter optional rate-limit transport wiring', () => {
  it('requires codexHome by default while keeping auth spike-gated', async () => {
    const adapter = new CodexProviderAdapter(undefined, clock);

    await expect(adapter.fetchQuota(account)).rejects.toMatchObject({ status: 'config_error' });
    await expect(
      adapter.authenticate({ provider: 'codex', expectedEmail: account.email, interactive: false })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
  });

  it('fetches quota with an injected stub transport and normalises into AccountQuotaCard', async () => {
    const transport = new StubCodexRateLimitsTransport(() => Promise.resolve(fixture()));
    const adapter = new CodexProviderAdapter(undefined, clock, {
      rateLimitsTransport: transport,
      codexHome
    });

    const quota = await adapter.fetchQuota(account);
    expect(quota).toMatchObject({
      provider: 'codex',
      accountEmail: account.email,
      fetchedAt: now,
      status: 'fresh',
      windows: [
        { id: 'codex:5h', providerWindowName: '5-hour Codex limit', usedPercentage: 42 },
        { id: 'codex:weekly', providerWindowName: 'Weekly Codex limit', usedPercentage: 68 }
      ]
    });
    expect(transport.calls).toEqual([codexHome]);

    const card = await adapter.normaliseQuota(account, quota);
    expect(card).toMatchObject({
      provider: 'codex',
      email: account.email,
      displayOrder: 7,
      status: 'fresh',
      lastSuccessfulRefreshAt: now,
      lastAttemptedRefreshAt: now,
      stale: false,
      windows: [
        {
          id: 'codex:5h',
          providerWindowName: '5-hour Codex limit',
          usedPercentage: 42,
          resetInText: 'resets in 2h 30m',
          status: 'fresh'
        },
        {
          id: 'codex:weekly',
          providerWindowName: 'Weekly Codex limit',
          usedPercentage: 68,
          resetInText: 'resets in 4d 2h',
          status: 'fresh'
        }
      ]
    });
  });

  it('keeps authenticate, validate and diagnose spike-gated even when transport is injected', async () => {
    const adapter = new CodexProviderAdapter(undefined, clock, {
      rateLimitsTransport: new StubCodexRateLimitsTransport(() => Promise.resolve(fixture())),
      codexHome
    });

    await expect(
      adapter.authenticate({ provider: 'codex', expectedEmail: account.email, interactive: false })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    await expect(
      adapter.validateAccount({ provider: 'codex', accountId: account.id }, account.email)
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    await expect(adapter.diagnose(account)).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
  });

  it('propagates auth-required and provider-unavailable errors without token leakage', async () => {
    const authAdapter = new CodexProviderAdapter(undefined, clock, {
      rateLimitsTransport: new StubCodexRateLimitsTransport(() =>
        Promise.resolve({ status: 'auth_required', token: secretSentinel })
      ),
      codexHome
    });
    await expect(authAdapter.fetchQuota(account)).rejects.toBeInstanceOf(AuthRequiredError);

    const unavailableAdapter = new CodexProviderAdapter(undefined, clock, {
      rateLimitsTransport: new StubCodexRateLimitsTransport(() =>
        Promise.reject(new CodexRateLimitsTransportError(secretSentinel))
      ),
      codexHome
    });

    try {
      await unavailableAdapter.fetchQuota(account);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(JSON.stringify(error)).not.toContain(secretSentinel);
    }
  });

  it('registers Codex in app bootstrap and marks capabilities usable', () => {
    const services = createAppServices({}, {});

    expect(services.providerRegistry.has('fake')).toBe(true);
    expect(services.providerRegistry.has('codex')).toBe(true);
    expect(new ProviderCapabilitiesService().get('codex')).toMatchObject({
      implemented: true,
      usable: true,
      status: 'usable'
    });
  });
});
