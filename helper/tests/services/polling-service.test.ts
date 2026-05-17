// Provenance: docs/test-traceability.md — Polling area
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountIdFor,
  ProviderError,
  type AccountValidationResult,
  type ConfiguredAccount,
  type ProviderId,
  type ProviderQuotaResult
} from '../../src/domain/index.js';
import {
  AbstractProviderAdapter,
  FakeProviderAdapter,
  ProviderCommandError,
  ProviderRegistry,
  type AuthInput,
  type AuthResult,
  type Clock,
  type FakeProviderScenario
} from '../../src/providers/index.js';
import { PollingService } from '../../src/services/index.js';
import {
  ConfigStore,
  HistoryWriter,
  LatestStateStore,
  resolveAppPaths
} from '../../src/storage/index.js';
import type { TokenRef } from '../../src/storage/index.js';
import type { AppConfigContract } from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const later = '2026-05-09T12:05:00.000Z';

const clockAtNow: Clock = {
  now: () => new Date(now),
  nowIso: () => now
};

const clockAtLater: Clock = {
  now: () => new Date(later),
  nowIso: () => later
};

type Harness = {
  configStore: ConfigStore;
  latestStateStore: LatestStateStore;
  historyWriter: HistoryWriter;
  providerRegistry: ProviderRegistry;
  historyLogFile: string;
};

async function createHarness(clock: Clock = clockAtNow): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-polling-service-'));
  const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new FakeProviderAdapter(clock));

  return {
    configStore: new ConfigStore(paths),
    latestStateStore: new LatestStateStore({
      latestStateFile: paths.latestStateFile,
      clock: () => clock.now()
    }),
    historyWriter: new HistoryWriter(paths),
    providerRegistry,
    historyLogFile: paths.historyLogFile
  };
}

function account(
  scenario: FakeProviderScenario = 'success',
  email = 'dev@example.com',
  displayOrder = 0
): ConfiguredAccount {
  return {
    id: accountIdFor('fake', email),
    provider: 'fake',
    email,
    displayOrder,
    providerConfig: { scenario },
    createdAt: now,
    updatedAt: now
  };
}

async function saveConfig(
  harness: Harness,
  accounts: ConfiguredAccount[],
  settings: AppConfigContract['settings'] = { refreshIntervalMinutes: 5 }
): Promise<void> {
  const config: AppConfigContract = {
    schemaVersion: '1',
    accounts,
    settings
  };
  await harness.configStore.save(config);
}

function service(harness: Harness, clock: Clock = clockAtNow): PollingService {
  return new PollingService({ ...harness, clock });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SlowStubAdapter extends AbstractProviderAdapter {
  readonly providerName = 'Slow Stub';
  readonly events: string[] = [];

  constructor(
    private readonly delaysByEmail: Record<string, number>,
    private readonly failuresByEmail: Record<string, Error> = {},
    clock: Clock = clockAtNow,
    readonly providerId: ProviderId = 'fake'
  ) {
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

  async fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult> {
    this.events.push(`start:${account.email}`);
    await delay(this.delaysByEmail[account.email] ?? 0);
    this.events.push(`end:${account.email}`);
    if (Object.prototype.hasOwnProperty.call(this.failuresByEmail, account.email)) {
      throw this.failuresByEmail[account.email];
    }

    return {
      provider: this.providerId,
      accountEmail: account.email,
      fetchedAt: this.clock.nowIso(),
      status: 'fresh',
      windows: [
        {
          id: account.email,
          providerWindowName: account.email,
          usedPercentage: 10,
          resetAt: '2026-05-09T14:30:00.000Z',
          hint: null
        }
      ]
    };
  }
}

async function readHistoryLines(historyLogFile: string): Promise<string[]> {
  return readFile(historyLogFile, 'utf8')
    .then((content) => content.trim().split('\n').filter(Boolean))
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    });
}

// Traceability: BR: helper polling owns provider refresh and normalization; AC: success/failure/stale/history/unknown-provider handling; TS: TSD polling and storage integration.
describe('PollingService', () => {
  it('writes an empty latest state when no accounts are configured', async () => {
    const harness = await createHarness();

    const summary = await service(harness).pollAll();

    expect(summary).toMatchObject({
      generatedAt: now,
      accountsConfigured: 0,
      accountsPolled: 0,
      successes: 0,
      failures: 0,
      historyEntriesWritten: 0,
      accounts: []
    });
    await expect(harness.latestStateStore.load()).resolves.toEqual({
      schemaVersion: '1',
      generatedAt: now,
      accounts: []
    });
  });

  it('polls one successful fake account, writes latest, and appends history', async () => {
    const harness = await createHarness();
    await saveConfig(harness, [account('success')]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 1, failures: 0, historyEntriesWritten: 1 });
    expect(latest.accounts).toHaveLength(1);
    expect(latest.accounts[0]).toMatchObject({
      provider: 'fake',
      email: 'dev@example.com',
      status: 'fresh',
      stale: false,
      windows: [{ id: 'weekly', usedPercentage: 42, resetInText: 'resets in 5h 0m' }]
    });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  it('handles mixed success and failure while writing history only for success', async () => {
    const harness = await createHarness();
    await saveConfig(harness, [
      account('success', 'one@example.com', 0),
      account('offline', 'two@example.com', 1)
    ]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 1, failures: 1, historyEntriesWritten: 1 });
    expect(latest.accounts).toHaveLength(2);
    expect(latest.accounts[0]?.status).toBe('fresh');
    expect(latest.accounts[1]).toMatchObject({ status: 'offline', stale: false, windows: [] });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  it('records first-time auth failure without stale merge', async () => {
    const harness = await createHarness();
    await saveConfig(harness, [account('auth_required')]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary.accounts[0]).toMatchObject({
      status: 'auth_required',
      success: false,
      staleMerged: false
    });
    expect(latest.accounts[0]).toMatchObject({
      status: 'auth_required',
      stale: false,
      lastSuccessfulRefreshAt: null,
      windows: []
    });
  });

  it('keeps previous quota visible as stale when a later poll requires auth', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')]);
    await service(harness, clockAtNow).pollAll();

    await saveConfig(harness, [account('auth_required')]);
    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary.accounts[0]).toMatchObject({
      status: 'stale',
      success: false,
      staleMerged: true,
      errorHint: 'Fake provider requires authentication'
    });
    expect(latest.accounts[0]).toMatchObject({
      status: 'stale',
      stale: true,
      lastSuccessfulRefreshAt: now,
      lastAttemptedRefreshAt: later,
      windows: [{ id: 'weekly', status: 'stale', usedPercentage: 42 }],
      errorHint: 'Fake provider requires authentication'
    });
  });

  it('merges previous successful card as stale when a later transient poll fails', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')]);
    await service(harness, clockAtNow).pollAll();

    await saveConfig(harness, [account('offline')]);
    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 0, failures: 1, staleMerged: 1 });
    expect(latest.accounts[0]).toMatchObject({
      status: 'stale',
      stale: true,
      lastSuccessfulRefreshAt: now,
      lastAttemptedRefreshAt: later,
      windows: [{ id: 'weekly', status: 'stale', usedPercentage: 42 }]
    });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  it('keeps previous quota visible as stale when a provider endpoint returns 429', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')]);
    await service(harness, clockAtNow).pollAll();

    const adapter = new SlowStubAdapter(
      { 'dev@example.com': 0 },
      { 'dev@example.com': new ProviderError('Claude OAuth usage request failed: 429') },
      clockAtLater
    );
    const registry = new ProviderRegistry();
    registry.register(adapter);
    harness.providerRegistry = registry;

    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 0, failures: 1, staleMerged: 1 });
    expect(latest.accounts[0]).toMatchObject({
      status: 'stale',
      stale: true,
      windows: [{ id: 'weekly', status: 'stale', usedPercentage: 42 }],
      errorHint: 'Claude OAuth usage request failed: 429'
    });
  });

  it('keeps stale quota visible across repeated provider endpoint failures', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')]);
    await service(harness, clockAtNow).pollAll();

    const adapter = new SlowStubAdapter(
      { 'dev@example.com': 0 },
      { 'dev@example.com': new ProviderError('Claude OAuth usage request failed: 429') },
      clockAtLater
    );
    const registry = new ProviderRegistry();
    registry.register(adapter);
    harness.providerRegistry = registry;

    await service(harness, clockAtLater).pollAll();
    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ staleMerged: 1 });
    expect(latest.accounts[0]).toMatchObject({
      status: 'stale',
      stale: true,
      windows: [{ id: 'weekly', status: 'stale', usedPercentage: 42 }]
    });
  });

  it.each(['Codex rate limit state: primary', 'Codex rate limits response missing rateLimits'])(
    'does not show stale quota when a later poll reports an account quota limit: %s',
    async (message) => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')]);
      await service(harness, clockAtNow).pollAll();

      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        { 'dev@example.com': new ProviderError(message) },
        clockAtLater
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      const summary = await service(harness, clockAtLater).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(summary).toMatchObject({ successes: 0, failures: 1, staleMerged: 0 });
      expect(latest.accounts[0]).toMatchObject({
        status: 'unavailable',
        stale: false,
        windows: [],
        errorHint: message
      });
    }
  );

  it('maps unknown provider config to config_error latest card', async () => {
    const harness = await createHarness();
    const unknownProviderAccount: ConfiguredAccount = {
      ...account('success'),
      id: 'codex:dev@example.com',
      provider: 'codex'
    };
    await saveConfig(harness, [unknownProviderAccount]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary.accounts[0]).toMatchObject({ status: 'config_error', success: false });
    expect(latest.accounts[0]).toMatchObject({ status: 'config_error', windows: [], stale: false });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(0);
  });

  it('does not append history for provider results that are not successful', async () => {
    const harness = await createHarness();
    await saveConfig(harness, [account('email_mismatch')]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 0, failures: 1, historyEntriesWritten: 0 });
    expect(latest.accounts[0]).toMatchObject({ status: 'config_error', stale: false });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(0);
  });

  it('skips accounts that are still inside the configured provider poll interval', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')], {
      refreshIntervalMinutes: 5,
      providerPollIntervalSeconds: { fake: 600 }
    });
    await service(harness, clockAtNow).pollAll();

    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({
      accountsConfigured: 1,
      accountsPolled: 0,
      successes: 0,
      failures: 0,
      skipped: 1,
      historyEntriesWritten: 0
    });
    expect(summary.accounts[0]).toMatchObject({ skipped: true, success: false });
    expect(latest.accounts[0]).toMatchObject({
      status: 'fresh',
      stale: false,
      lastAttemptedRefreshAt: now,
      windows: [{ id: 'weekly', usedPercentage: 42 }]
    });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  it('polls accounts once their configured provider poll interval has elapsed', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')], {
      refreshIntervalMinutes: 5,
      providerPollIntervalSeconds: { fake: 60 }
    });
    await service(harness, clockAtNow).pollAll();

    const summary = await service(harness, clockAtLater).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ accountsPolled: 1, successes: 1, skipped: 0 });
    expect(latest.accounts[0]).toMatchObject({ status: 'fresh', windows: [{ id: 'weekly' }] });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(2);
  });

  it('polls accounts immediately when no previous latest card exists, even with provider interval settings', async () => {
    const harness = await createHarness(clockAtNow);
    await saveConfig(harness, [account('success')], {
      refreshIntervalMinutes: 5,
      providerPollIntervalSeconds: { fake: 600 }
    });

    const summary = await service(harness, clockAtNow).pollAll();

    expect(summary).toMatchObject({ accountsPolled: 1, successes: 1, skipped: 0 });
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  it('polls accounts concurrently while preserving deterministic latest and history order', async () => {
    const harness = await createHarness();
    const adapter = new SlowStubAdapter({ 'slow@example.com': 80, 'fast@example.com': 80 });
    const registry = new ProviderRegistry();
    registry.register(adapter);
    harness.providerRegistry = registry;
    await saveConfig(harness, [
      account('success', 'slow@example.com', 1),
      account('success', 'fast@example.com', 0)
    ]);

    const startedAt = Date.now();
    const summary = await service(harness).pollAll();
    const elapsedMs = Date.now() - startedAt;
    const latest = await harness.latestStateStore.load();
    const history = (await readHistoryLines(harness.historyLogFile)).map(
      (line) => JSON.parse(line) as { email: string }
    );

    expect(elapsedMs).toBeLessThan(150);
    expect(adapter.events.slice(0, 2)).toEqual([
      'start:slow@example.com',
      'start:fast@example.com'
    ]);
    expect(summary).toMatchObject({ successes: 2, failures: 0, historyEntriesWritten: 2 });
    expect(latest.accounts.map((latestAccount) => latestAccount.email)).toEqual([
      'fast@example.com',
      'slow@example.com'
    ]);
    expect(history.map((entry) => entry.email)).toEqual(['slow@example.com', 'fast@example.com']);
  });

  it('isolates one concurrent account failure without blocking successful accounts', async () => {
    const harness = await createHarness();
    const adapter = new SlowStubAdapter(
      { 'ok@example.com': 20, 'fail@example.com': 20 },
      { 'fail@example.com': new ProviderError('planned failure') }
    );
    const registry = new ProviderRegistry();
    registry.register(adapter);
    harness.providerRegistry = registry;
    await saveConfig(harness, [
      account('success', 'ok@example.com', 0),
      account('success', 'fail@example.com', 1)
    ]);

    const summary = await service(harness).pollAll();
    const latest = await harness.latestStateStore.load();

    expect(summary).toMatchObject({ successes: 1, failures: 1, historyEntriesWritten: 1 });
    expect(latest.accounts.map((latestAccount) => latestAccount.status)).toEqual([
      'fresh',
      'provider_error'
    ]);
    expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(1);
  });

  // Traceability: BR-044 progressive back-off; unchanged successful accounts and errors back off.
  describe('progressive back-off', () => {
    const minSeconds = 60;
    const maxSeconds = 900;
    const backOffSettings: AppConfigContract['settings'] = {
      refreshIntervalMinutes: 1,
      providerPollIntervalSeconds: { fake: minSeconds },
      providerPollMaxIntervalSeconds: { fake: maxSeconds }
    };

    it('uses account-specific poll interval overrides independently from provider defaults', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(
        harness,
        [
          {
            ...account('success', 'fast@example.com', 0),
            providerConfig: { scenario: 'success', pollIntervalSeconds: 60 }
          },
          {
            ...account('success', 'slow@example.com', 1),
            providerConfig: { scenario: 'success', pollIntervalSeconds: 600 }
          }
        ],
        {
          refreshIntervalMinutes: 1,
          providerPollIntervalSeconds: { fake: 60 },
          providerPollMaxIntervalSeconds: { fake: 900 }
        }
      );
      await service(harness, clockAtNow).pollAll();

      const t1 = '2026-05-09T12:02:00.000Z';
      const summary = await service(harness, {
        now: () => new Date(t1),
        nowIso: () => t1
      }).pollAll();

      expect(summary.accounts.map((entry) => [entry.email, entry.skipped])).toEqual([
        ['fast@example.com', false],
        ['slow@example.com', true]
      ]);
    });

    it('doubles effectivePollIntervalSeconds when successful quota data is unchanged', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);

      await service(harness, clockAtNow).pollAll();
      const t1 = '2026-05-09T12:02:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(minSeconds * 2);
      expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(2);
    });

    it('backs off when only quota reset time drifts', async () => {
      // First poll establishes a backed-off interval (unchanged data → double).
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();
      // Some providers report rolling reset timestamps. Treating resetAt-only drift as a
      // data change keeps effective intervals pinned at the minimum.
      const adapter = new FakeProviderAdapter(clockAtNow);
      const originalFetch = adapter.fetchQuota.bind(adapter);
      adapter.fetchQuota = async (acc) => {
        const result = await originalFetch(acc);
        return {
          ...result,
          windows: result.windows.map((w) => ({ ...w, resetAt: '2026-05-09T15:30:00.000Z' }))
        };
      };
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      const t1 = '2026-05-09T12:02:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(minSeconds * 2);
      expect(await readHistoryLines(harness.historyLogFile)).toHaveLength(2);
    });

    it('uses the effective interval for fresh unchanged accounts, not only the config min', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();

      const latest = await harness.latestStateStore.load();
      const existing = latest.accounts[0];
      latest.accounts[0] = { ...existing, effectivePollIntervalSeconds: maxSeconds };
      await harness.latestStateStore.save(latest);

      const t1 = '2026-05-09T12:02:00.000Z';
      const summary = await service(harness, {
        now: () => new Date(t1),
        nowIso: () => t1
      }).pollAll();

      expect(summary).toMatchObject({ accountsPolled: 0, skipped: 1, successes: 0 });
    });

    it('rounds fractional provider back-off intervals up to whole seconds', async () => {
      const harness = await createHarness(clockAtNow);
      const claudeAccount: ConfiguredAccount = {
        id: accountIdFor('claude-code', 'claude@example.com'),
        provider: 'claude-code',
        email: 'claude@example.com',
        displayOrder: 0,
        createdAt: now,
        updatedAt: now
      };
      await saveConfig(harness, [claudeAccount], { refreshIntervalMinutes: 1 });

      const registry = new ProviderRegistry();
      registry.register(
        new SlowStubAdapter({ 'claude@example.com': 0 }, {}, clockAtNow, 'claude-code')
      );
      harness.providerRegistry = registry;

      await service(harness, clockAtNow).pollAll();
      const t1 = '2026-05-09T12:31:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(2101);
    });

    it('doubles effectivePollIntervalSeconds on thrown provider error', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();

      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        { 'dev@example.com': new ProviderError('network error') },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      const t1 = '2026-05-09T12:02:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(minSeconds * 2);
    });

    it('uses retry-after seconds from provider command errors for the next poll interval', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], {
        ...backOffSettings,
        providerPollMaxIntervalSeconds: { fake: 3600 }
      });
      await service(harness, clockAtNow).pollAll();

      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        {
          'dev@example.com': new ProviderCommandError('Claude OAuth usage request failed: 429', {
            command: 'https://api.anthropic.com/api/oauth/usage',
            args: [],
            exitCode: 429,
            signal: null,
            stdout: JSON.stringify({ error: { type: 'rate_limit_error' } }),
            stderr: 'retry-after: 1646',
            timedOut: false,
            durationMs: 10
          })
        },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      const t1 = '2026-05-09T12:02:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(1646);
    });

    it('uses not-before timestamp from provider command errors for the next poll interval', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], {
        ...backOffSettings,
        providerPollMaxIntervalSeconds: { fake: 3600 }
      });
      await service(harness, clockAtNow).pollAll();

      const t1 = '2026-05-09T12:02:00.000Z';
      const notBefore = '2026-05-09T12:32:00.000Z'; // 1800s after t1, +2s buffer = 1802
      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        {
          'dev@example.com': new ProviderCommandError('Claude OAuth usage request failed: 429', {
            command: 'https://api.anthropic.com/api/oauth/usage',
            args: [],
            exitCode: 429,
            signal: null,
            stdout: JSON.stringify({ error: { type: 'rate_limit_error' } }),
            stderr: `not-before: ${notBefore}`,
            timedOut: false,
            durationMs: 10
          })
        },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(1802);
    });

    it('honors not-before timestamps even when they exceed the configured max interval', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();

      const t1 = '2026-05-09T12:02:00.000Z';
      const notBefore = '2026-05-09T15:02:00.000Z'; // 10800s after t1, +2s buffer = 10802
      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        {
          'dev@example.com': new ProviderCommandError('Claude OAuth usage request failed: 429', {
            command: 'https://api.anthropic.com/api/oauth/usage',
            args: [],
            exitCode: 429,
            signal: null,
            stdout: JSON.stringify({ error: { type: 'rate_limit_error' } }),
            stderr: `not-before: ${notBefore}`,
            timedOut: false,
            durationMs: 10
          })
        },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(10802);
    });

    it('prefers not-before over retry-after when both are present', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], {
        ...backOffSettings,
        providerPollMaxIntervalSeconds: { fake: 7200 }
      });
      await service(harness, clockAtNow).pollAll();

      const t1 = '2026-05-09T12:02:00.000Z';
      const notBefore = '2026-05-09T13:02:00.000Z'; // 3600s after t1, +2s buffer = 3602
      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        {
          'dev@example.com': new ProviderCommandError('Claude OAuth usage request failed: 429', {
            command: 'https://api.anthropic.com/api/oauth/usage',
            args: [],
            exitCode: 429,
            signal: null,
            stdout: '{}',
            stderr: `not-before: ${notBefore}\nretry-after: 99`,
            timedOut: false,
            durationMs: 10
          })
        },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(3602);
    });

    it('honors retry-after seconds even when they exceed the configured max interval', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();

      const adapter = new SlowStubAdapter(
        { 'dev@example.com': 0 },
        {
          'dev@example.com': new ProviderCommandError('Claude OAuth usage request failed: 429', {
            command: 'https://api.anthropic.com/api/oauth/usage',
            args: [],
            exitCode: 429,
            signal: null,
            stdout: '{}',
            stderr: 'retry-after: 9999',
            timedOut: false,
            durationMs: 10
          })
        },
        clockAtNow
      );
      const registry = new ProviderRegistry();
      registry.register(adapter);
      harness.providerRegistry = registry;

      const t1 = '2026-05-09T12:02:00.000Z';
      await service(harness, { now: () => new Date(t1), nowIso: () => t1 }).pollAll();
      const latest = await harness.latestStateStore.load();

      expect(latest.accounts[0]?.effectivePollIntervalSeconds).toBe(9999);
    });

    it('caps error effectivePollIntervalSeconds at max and uses it for skip decisions', async () => {
      const harness = await createHarness(clockAtNow);
      await saveConfig(harness, [account('success')], backOffSettings);
      await service(harness, clockAtNow).pollAll();

      const latest = await harness.latestStateStore.load();
      const existing = latest.accounts[0];
      latest.accounts[0] = {
        ...existing,
        status: 'provider_error',
        effectivePollIntervalSeconds: maxSeconds
      };
      await harness.latestStateStore.save(latest);

      const t1 = '2026-05-09T12:02:00.000Z';
      const summary = await service(harness, {
        now: () => new Date(t1),
        nowIso: () => t1
      }).pollAll();

      expect(summary.skipped).toBe(1);
      expect(summary.successes).toBe(0);
    });
  });
});
