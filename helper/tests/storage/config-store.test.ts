// Provenance: docs/test-traceability.md — Storage area
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import { ConfigStore, resolveAppPaths } from '../../src/storage/index.js';

const now = '2026-05-09T12:00:00.000Z';

async function tempStore(): Promise<ConfigStore> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-config-store-'));
  return new ConfigStore(
    resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') })
  );
}

function account(email = 'dev@example.com', displayOrder = 0): ConfiguredAccount {
  return {
    id: accountIdFor('codex', email),
    provider: 'codex',
    email,
    displayOrder,
    createdAt: now,
    updatedAt: now
  };
}

// Traceability: BR: configurable accounts; AC: default/malformed/duplicate/add-update-delete behavior; TS: TSD §9.2 Config Store.
describe('ConfigStore', () => {
  it('loads the default config when the file is missing', async () => {
    const store = await tempStore();

    await expect(store.load()).resolves.toEqual({
      schemaVersion: '1',
      accounts: [],
      settings: {
        refreshIntervalMinutes: 5,
        providerPollIntervalSeconds: { codex: 60, 'claude-code': 600 },
        providerPollMaxIntervalSeconds: { codex: 900, 'claude-code': 900 }
      }
    });
  });

  it('roundtrips config and supports get/add/update/delete account operations', async () => {
    const store = await tempStore();
    const firstAccount = account('dev@example.com');

    await store.addAccount(firstAccount);
    await expect(store.getAccount(firstAccount.id)).resolves.toEqual(firstAccount);
    await expect(store.getAccountByProviderEmail('codex', ' DEV@example.com ')).resolves.toEqual(
      firstAccount
    );

    const updated = await store.updateAccount(firstAccount.id, {
      email: 'other@example.com',
      providerConfig: { profile: 'work' },
      updatedAt: '2026-05-09T13:00:00.000Z'
    });
    expect(updated.accounts[0]?.id).toBe('codex:other@example.com');
    expect(updated.accounts[0]?.providerConfig).toEqual({ profile: 'work' });

    await expect(store.deleteAccount('codex:other@example.com')).resolves.toBe(true);
    await expect(store.getAccounts()).resolves.toEqual([]);
    await expect(store.deleteAccount('codex:missing@example.com')).resolves.toBe(false);
  });

  it('rejects duplicate account ids and duplicate provider-email pairs on save', async () => {
    const store = await tempStore();
    const firstAccount = account('dev@example.com');

    await expect(
      store.save({
        schemaVersion: '1',
        accounts: [firstAccount, { ...account('other@example.com', 1), id: firstAccount.id }],
        settings: { refreshIntervalMinutes: 5 }
      })
    ).rejects.toThrow('Invalid config file');

    await expect(
      store.save({
        schemaVersion: '1',
        accounts: [
          firstAccount,
          { ...firstAccount, id: 'codex:DEV@example.com', email: 'DEV@example.com' }
        ],
        settings: { refreshIntervalMinutes: 5 }
      })
    ).rejects.toThrow('Invalid config file');
  });

  it('throws a validation error for invalid files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-config-invalid-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(paths.configFile, JSON.stringify({ schemaVersion: '1', accounts: [] }), 'utf8');

    await expect(new ConfigStore(paths).load()).rejects.toThrow(
      `Invalid config file: ${paths.configFile}`
    );
  });
});
