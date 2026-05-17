// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppServices, type AppServices } from '../../src/app/index.js';
import { submitCodexSetupAction } from '../../src/tui/index.js';
import type { ConfiguredAccount, ProviderQuotaResult } from '../../src/domain/index.js';

const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

async function makeServices(status: 'logged_in' | 'not_logged_in' = 'logged_in') {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-codex-setup-action-'));
  const services = createAppServices(
    { dataDir: join(root, 'data'), cacheDir: join(root, 'cache') },
    {}
  );
  const codexHome = join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    join(codexHome, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: `${secretSentinel}_ID`,
        access_token: `${secretSentinel}_ACCESS`,
        refresh_token: `${secretSentinel}_REFRESH`,
        account_id: 'account-redacted'
      },
      last_refresh: '2026-05-13T00:00:00.000Z'
    })
  );
  const checkStatus = vi.fn().mockResolvedValue({ status, summary: status });

  return {
    root,
    codexHome,
    services: {
      ...services,
      codexAuthService: { checkStatus }
    } as AppServices,
    checkStatus
  };
}

function quota(account: ConfiguredAccount): ProviderQuotaResult {
  return {
    provider: 'codex',
    accountEmail: account.email,
    fetchedAt: '2026-05-13T00:00:00.000Z',
    status: 'fresh',
    windows: [
      {
        id: 'codex:5h',
        providerWindowName: '5h',
        usedPercentage: 10,
        resetAt: null
      }
    ]
  };
}

function deps(fetchQuota = vi.fn((account: ConfiguredAccount) => Promise.resolve(quota(account)))) {
  return {
    codexAdapter: { fetchQuota },
    fetchQuota
  };
}

// Traceability: BR: Codex setup must verify completed login, import persistent profiles, validate readable quota, reject duplicates, and avoid leaking tokens; AC: TUI action stores only AIQM-owned codexHome paths, leaves incomplete/unreadable accounts unsaved, and redacts token sentinels from result/log output; TS: Codex setup action and provider profile storage boundary.
describe('Codex setup TUI action', () => {
  it('verifies login, imports persistent profile, saves account, tests quota, and does not leak tokens', async () => {
    const { services, codexHome, checkStatus } = await makeServices();
    const dependencies = deps();

    const result = await submitCodexSetupAction(
      {
        email: ' Codex@Example.TEST ',
        displayName: 'Codex Dev',
        codexHome,
        pollAfterAdd: false
      },
      services,
      dependencies
    );

    const persistentCodexHome = services.providerProfileStore.codexHomeDir('codex@example.test');
    expect(checkStatus).toHaveBeenCalledWith(codexHome);
    expect(result.add.account.providerConfig?.codexHome).toBe(persistentCodexHome);
    expect(result.add.account.providerConfig?.displayName).toBe('Codex Dev');
    expect(result.poll).toBeNull();
    expect(await readFile(join(persistentCodexHome, 'auth.json'), 'utf8')).toContain(
      `${secretSentinel}_ACCESS`
    );
    await expect(
      services.configStore.getAccount('codex:codex@example.test')
    ).resolves.toMatchObject({
      providerConfig: { codexHome: persistentCodexHome, displayName: 'Codex Dev' }
    });
    expect(dependencies.fetchQuota).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(secretSentinel);
    await expect(readFile(services.paths.logFile, 'utf8')).resolves.not.toContain(secretSentinel);
  });

  it('rejects incomplete Codex login before importing or saving', async () => {
    const { services, codexHome } = await makeServices('not_logged_in');
    const dependencies = deps();

    await expect(
      submitCodexSetupAction(
        { email: 'codex@example.test', codexHome, pollAfterAdd: false },
        services,
        dependencies
      )
    ).rejects.toThrow('Codex login is not complete: not_logged_in');

    await expect(services.configStore.getAccount('codex:codex@example.test')).resolves.toBeNull();
    expect(dependencies.fetchQuota).not.toHaveBeenCalled();
  });

  it('rejects quota unreadable setup without saving the account', async () => {
    const { services, codexHome } = await makeServices();
    const dependencies = deps(
      vi.fn((account: ConfiguredAccount) =>
        Promise.resolve({ ...quota(account), windows: [], status: 'provider_error' })
      )
    );

    await expect(
      submitCodexSetupAction(
        { email: 'codex@example.test', codexHome, pollAfterAdd: false },
        services,
        dependencies
      )
    ).rejects.toThrow('Codex quota unreadable during setup');

    await expect(services.configStore.getAccount('codex:codex@example.test')).resolves.toBeNull();
  });

  it('rejects duplicate Codex accounts', async () => {
    const { services, codexHome } = await makeServices();
    const dependencies = deps();
    await submitCodexSetupAction(
      { email: 'codex@example.test', codexHome, pollAfterAdd: false },
      services,
      dependencies
    );

    await expect(
      submitCodexSetupAction(
        { email: 'CODEX@example.test', codexHome, pollAfterAdd: false },
        services,
        deps()
      )
    ).rejects.toThrow('Account already configured: codex:codex@example.test');
  });
});
