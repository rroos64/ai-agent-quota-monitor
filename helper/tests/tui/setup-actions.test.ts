// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServices } from '../../src/app/index.js';
import { submitFakeSetupAction } from '../../src/tui/index.js';

async function tempServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-tui-actions-'));
  return createAppServices({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }, {});
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
});
