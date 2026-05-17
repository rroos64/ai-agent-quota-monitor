// Provenance: docs/test-traceability.md — Providers area
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppServices } from '../../src/app/index.js';
import { addCodexAccount, migrateCodexProfiles } from '../../src/cli/commands/account-actions.js';
import type { ConfiguredAccount, ProviderQuotaResult } from '../../src/domain/index.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function tempServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-codex-profile-import-'));
  return {
    root,
    services: createAppServices({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }, {})
  };
}

function quotaFor(account: ConfiguredAccount): ProviderQuotaResult {
  return {
    provider: 'codex',
    accountEmail: account.email,
    fetchedAt: '2026-05-13T00:00:00.000Z',
    status: 'fresh',
    windows: [
      {
        id: 'codex:5h',
        providerWindowName: '5h',
        usedPercentage: 25,
        resetAt: null
      }
    ]
  };
}

async function createCodexHome(root: string) {
  const codexHome = join(root, 'source-codex-home');
  await mkdir(join(codexHome, 'nested'), { recursive: true });
  await writeFile(
    join(codexHome, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'SECRET_SENTINEL_DO_NOT_LEAK_ID',
        access_token: 'SECRET_SENTINEL_DO_NOT_LEAK_ACCESS',
        refresh_token: 'SECRET_SENTINEL_DO_NOT_LEAK_REFRESH',
        account_id: 'account-redacted'
      },
      last_refresh: '2026-05-13T00:00:00.000Z'
    })
  );
  await writeFile(join(codexHome, 'nested', 'config.toml'), 'model = "redacted"');
  return codexHome;
}

// Traceability: BR: Codex account setup must isolate imported provider profiles and avoid secret leakage; AC: imported Codex homes are copied into AIQM-owned private storage, symlink sources are rejected, existing temporary homes migrate safely, and returned/logged data excludes source paths and token sentinels; TS: Codex profile import and provider profile storage boundary.
describe('Codex profile import', () => {
  it('copies --codex-home into persistent provider storage and configures the account with that path', async () => {
    const { root, services } = await tempServices();
    const sourceCodexHome = await createCodexHome(root);
    const fetchQuota = vi.fn((account: ConfiguredAccount) => Promise.resolve(quotaFor(account)));
    const codexAdapter = { fetchQuota };

    const result = await addCodexAccount(
      {
        provider: 'codex',
        email: 'Dev@Example.COM',
        codexHome: sourceCodexHome,
        displayName: 'Codex Dev'
      },
      services,
      { codexAdapter }
    );

    const persistentCodexHome = services.providerProfileStore.codexHomeDir('dev@example.com');
    expect(result.account.providerConfig?.codexHome).toBe(persistentCodexHome);
    expect(result.account.providerConfig?.codexHome).not.toBe(sourceCodexHome);
    expect(await readFile(join(persistentCodexHome, 'auth.json'), 'utf8')).toContain(
      'SECRET_SENTINEL_DO_NOT_LEAK_ACCESS'
    );
    expect(await readFile(join(persistentCodexHome, 'nested', 'config.toml'), 'utf8')).toBe(
      'model = "redacted"'
    );

    const account = await services.configStore.getAccount('codex:dev@example.com');
    expect(account?.providerConfig?.codexHome).toBe(persistentCodexHome);
    expect(fetchQuota).toHaveBeenCalledOnce();
    expect(fetchQuota.mock.calls[0]?.[0].providerConfig?.codexHome).toBe(persistentCodexHome);
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(JSON.stringify(result)).not.toContain(sourceCodexHome);
  });

  it('sets private permissions on imported Codex profile dirs and files', async () => {
    const { root, services } = await tempServices();
    const sourceCodexHome = await createCodexHome(root);

    await addCodexAccount(
      { provider: 'codex', email: 'dev@example.com', codexHome: sourceCodexHome },
      services,
      {
        codexAdapter: {
          fetchQuota: vi.fn((account: ConfiguredAccount) => Promise.resolve(quotaFor(account)))
        }
      }
    );

    const persistentCodexHome = services.providerProfileStore.codexHomeDir('dev@example.com');
    expect((await stat(persistentCodexHome)).mode & 0o777).toBe(0o700);
    expect((await stat(join(persistentCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(persistentCodexHome, 'nested'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(persistentCodexHome, 'nested', 'config.toml'))).mode & 0o777).toBe(
      0o600
    );
  });

  it('rejects Codex profile sources containing symlinks without installing a destination', async () => {
    const { root, services } = await tempServices();
    const sourceCodexHome = await createCodexHome(root);
    const outsideSecret = join(root, 'outside-secret');
    await writeFile(outsideSecret, 'SECRET_SENTINEL_DO_NOT_LEAK_OUTSIDE');
    await symlink(outsideSecret, join(sourceCodexHome, 'nested', 'outside-link'));
    const fetchQuota = vi.fn((account: ConfiguredAccount) => Promise.resolve(quotaFor(account)));
    const persistentCodexHome = services.providerProfileStore.codexHomeDir('dev@example.com');

    await expect(
      addCodexAccount(
        { provider: 'codex', email: 'dev@example.com', codexHome: sourceCodexHome },
        services,
        { codexAdapter: { fetchQuota } }
      )
    ).rejects.toThrow('Codex home source must not contain symlinks');

    await expect(services.configStore.getAccount('codex:dev@example.com')).resolves.toBeNull();
    expect(fetchQuota).not.toHaveBeenCalled();
    await expect(pathExists(persistentCodexHome)).resolves.toBe(false);
  });

  it('migrates existing Codex accounts from temporary homes to persistent homes', async () => {
    const { root, services } = await tempServices();
    const sourceCodexHome = await createCodexHome(root);
    const now = '2026-05-13T00:00:00.000Z';

    await services.configStore.addAccount({
      id: 'codex:dev@example.com',
      provider: 'codex',
      email: 'dev@example.com',
      displayOrder: 0,
      providerConfig: { codexHome: sourceCodexHome, displayName: 'Dev' },
      createdAt: now,
      updatedAt: now
    });

    const migrated = await migrateCodexProfiles(services);
    const persistentCodexHome = services.providerProfileStore.codexHomeDir('dev@example.com');
    expect(migrated).toEqual({
      migrated: [
        {
          accountId: 'codex:dev@example.com',
          email: 'dev@example.com',
          codexHome: persistentCodexHome
        }
      ],
      skipped: []
    });
    expect(await readFile(join(persistentCodexHome, 'auth.json'), 'utf8')).toContain(
      'SECRET_SENTINEL_DO_NOT_LEAK_ACCESS'
    );
    await expect(services.configStore.getAccount('codex:dev@example.com')).resolves.toMatchObject({
      providerConfig: { codexHome: persistentCodexHome, displayName: 'Dev' }
    });
  });
});
