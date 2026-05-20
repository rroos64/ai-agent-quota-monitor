// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppServices, type AppServices } from '../../src/app/index.js';
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import type { PollSummary } from '../../src/services/index.js';
import {
  forceRefreshAccountAction,
  forceRefreshAllAction,
  reloginClaudeAccountAction,
  reloginCodexAccountAction,
  submitFakeSetupAction
} from '../../src/tui/index.js';
import type { AppConfigContract } from '../../src/validation/index.js';

async function tempServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-tui-actions-'));
  return createAppServices({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }, {});
}

function fakeAccount(email: string, displayOrder: number): ConfiguredAccount {
  return {
    id: accountIdFor('fake', email),
    provider: 'fake',
    email,
    displayOrder,
    providerConfig: { scenario: 'success' },
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z'
  };
}

function configuredAccount(provider: 'codex' | 'claude-code', email: string): ConfiguredAccount {
  return {
    id: accountIdFor(provider, email),
    provider,
    email,
    displayOrder: 0,
    providerConfig: {},
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z'
  };
}

async function saveConfig(
  services: AppServices,
  accounts: ConfiguredAccount[],
  settings: AppConfigContract['settings'] = { refreshIntervalMinutes: 5 }
): Promise<void> {
  await services.configStore.save({ schemaVersion: '1', accounts, settings });
}

function pollSummary(account: ConfiguredAccount, success = true): PollSummary {
  return {
    generatedAt: '2026-05-09T12:00:00.000Z',
    accountsConfigured: 1,
    accountsPolled: success ? 1 : 0,
    successes: success ? 1 : 0,
    failures: success ? 0 : 0,
    skipped: success ? 0 : 1,
    staleMerged: 0,
    historyEntriesWritten: success ? 1 : 0,
    accounts: [
      {
        accountId: account.id,
        provider: account.provider,
        email: account.email,
        status: success ? 'fresh' : 'fresh',
        success,
        skipped: !success,
        staleMerged: false,
        historyEntriesWritten: success ? 1 : 0,
        errorHint: success ? null : 'skipped by backoff'
      }
    ]
  };
}

// Traceability: BR: interactive fake setup shell; AC: action layer validates email, duplicate accounts, success, optional poll, and no token leakage; TS: TSD TUI boundary uses services/shared actions.
describe('setup TUI actions', () => {
  it('rejects invalid email before adding an account', async () => {
    const services = await tempServices();

    await expect(
      submitFakeSetupAction(
        { email: 'not-an-email', scenario: 'success', pollAfterAdd: false },
        services
      )
    ).rejects.toThrow('Invalid email address: not-an-email');
    await expect(services.configStore.getAccounts()).resolves.toEqual([]);
  });

  it('adds a fake account successfully without displaying tokens', async () => {
    const services = await tempServices();

    const result = await submitFakeSetupAction(
      { email: 'Dev@Example.com', scenario: 'multi_window', pollAfterAdd: false },
      services
    );

    expect(result).toMatchObject({
      add: {
        added: true,
        account: { provider: 'fake', email: 'dev@example.com' },
        tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' }
      },
      poll: null
    });
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });

  it('rejects duplicate accounts through shared account action', async () => {
    const services = await tempServices();
    await submitFakeSetupAction(
      { email: 'dev@example.com', scenario: 'success', pollAfterAdd: false },
      services
    );

    await expect(
      submitFakeSetupAction(
        { email: 'DEV@example.com', scenario: 'success', pollAfterAdd: false },
        services
      )
    ).rejects.toThrow('Account already configured: fake:dev@example.com');
  });

  it('optionally polls after adding an account', async () => {
    const services = await tempServices();

    const result = await submitFakeSetupAction(
      { email: 'poll@example.com', scenario: 'success', pollAfterAdd: true },
      services
    );

    expect(result.poll).toMatchObject({ successes: 1, failures: 0, historyEntriesWritten: 1 });
    await expect(services.latestStateStore.load()).resolves.toMatchObject({
      accounts: [{ provider: 'fake', email: 'poll@example.com', status: 'fresh' }]
    });
  });

  it('validates force-refresh account input before polling', async () => {
    const services = await tempServices();

    await expect(
      forceRefreshAccountAction({ provider: 'unknown', email: 'dev@example.com' }, services)
    ).rejects.toThrow('Unsupported provider: unknown');
    await expect(
      forceRefreshAccountAction({ provider: 'fake', email: 'not-an-email' }, services)
    ).rejects.toThrow('Invalid email address: not-an-email');
  });

  it('force refreshes one selected account and preserves other latest cards safely', async () => {
    const services = await tempServices();
    await saveConfig(
      services,
      [fakeAccount('one@example.com', 0), fakeAccount('two@example.com', 1)],
      { refreshIntervalMinutes: 5, providerPollIntervalSeconds: { fake: 600 } }
    );
    await services.pollingService.pollAll();

    const result = await forceRefreshAccountAction(
      { provider: 'fake', email: ' ONE@example.com ' },
      services
    );
    const latest = await services.latestStateStore.load();

    expect(result.poll).toMatchObject({ accountsConfigured: 2, accountsPolled: 1, successes: 1 });
    expect(result.poll.accounts.map((account) => account.email)).toEqual(['one@example.com']);
    expect(latest.accounts.map((account) => account.email)).toEqual([
      'one@example.com',
      'two@example.com'
    ]);
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });

  it('force refreshes all accounts even when they are backed off', async () => {
    const services = await tempServices();
    await saveConfig(
      services,
      [fakeAccount('one@example.com', 0), fakeAccount('two@example.com', 1)],
      { refreshIntervalMinutes: 5, providerPollIntervalSeconds: { fake: 600 } }
    );
    await services.pollingService.pollAll();

    const skipped = await services.pollingService.pollAll();
    const forced = await forceRefreshAllAction(services);

    expect(skipped).toMatchObject({ accountsPolled: 0, skipped: 2 });
    expect(forced.poll).toMatchObject({ accountsPolled: 2, skipped: 0, successes: 2 });
  });

  it('uses targeted force polling to verify Codex re-login', async () => {
    const services = await tempServices();
    const account = configuredAccount('codex', 'codex@example.test');
    await saveConfig(services, [account]);
    const pollAll = vi.fn().mockResolvedValue(pollSummary(account));
    services.pollingService.pollAll = pollAll;
    services.codexAuthService.checkStatus = vi.fn().mockResolvedValue({
      status: 'logged_in',
      summary: 'Logged in'
    });

    const result = await reloginCodexAccountAction(
      { email: ' CODEX@example.test ', codexHome: '/tmp/new-codex-home' },
      services
    );

    expect(pollAll).toHaveBeenCalledWith({
      force: true,
      target: { kind: 'account', provider: 'codex', email: 'codex@example.test' }
    });
    expect(result.poll).toMatchObject({ successes: 1 });
  });

  it('uses targeted force polling to verify Claude re-login', async () => {
    const services = await tempServices();
    const account = configuredAccount('claude-code', 'claude@example.test');
    await saveConfig(services, [account]);
    const pollAll = vi.fn().mockResolvedValue(pollSummary(account));
    services.pollingService.pollAll = pollAll;
    services.claudeAuthService.checkStatus = vi.fn().mockResolvedValue({
      status: 'logged_in',
      summary: 'Logged in',
      authenticatedEmail: 'claude@example.test'
    });

    const result = await reloginClaudeAccountAction(
      { email: ' CLAUDE@example.test ', claudeConfigDir: '/tmp/new-claude-config' },
      services
    );

    expect(pollAll).toHaveBeenCalledWith({
      force: true,
      target: { kind: 'account', provider: 'claude-code', email: 'claude@example.test' }
    });
    expect(result.poll).toMatchObject({ successes: 1 });
  });

  it('fails re-login verification when a targeted poll would otherwise be skipped', async () => {
    const services = await tempServices();
    const account = configuredAccount('codex', 'codex@example.test');
    await saveConfig(services, [account]);
    services.pollingService.pollAll = vi.fn().mockResolvedValue(pollSummary(account, false));
    services.codexAuthService.checkStatus = vi.fn().mockResolvedValue({
      status: 'logged_in',
      summary: 'Logged in'
    });

    await expect(
      reloginCodexAccountAction(
        { email: 'codex@example.test', codexHome: '/tmp/new-codex-home' },
        services
      )
    ).rejects.toThrow('skipped by backoff');
  });
});
