// Provenance: docs/test-traceability.md — Storage area
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveAppPaths, TokenStore, type TokenRef } from '../../src/storage/index.js';
import type { TokenRecordContract } from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

async function tempStore(): Promise<{ store: TokenStore; tokenFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-token-store-'));
  const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
  return { store: new TokenStore(paths), tokenFile: paths.tokenFile };
}

function token(email = 'dev@example.com'): TokenRecordContract {
  return {
    schemaVersion: '1',
    accountId: `codex:${email.toLowerCase()}`,
    provider: 'codex',
    email,
    createdAt: now,
    updatedAt: now,
    tokenType: 'fake',
    tokenPayload: { accessToken: secretSentinel }
  };
}

// Traceability: BR: local token reference storage; AC: 0600 writes, lookup/delete, duplicate rejection, secret-safe errors; TS: TSD §8.4 and §9.3 Token Store.
describe('TokenStore', () => {
  it('loads an empty token file when missing', async () => {
    const { store } = await tempStore();

    await expect(store.load()).resolves.toEqual({ schemaVersion: '1', tokens: [] });
  });

  it('roundtrips tokens and gets/deletes by token ref and provider/email', async () => {
    const { store } = await tempStore();
    const record = token('dev@example.com');
    const ref: TokenRef = { provider: 'codex', accountId: record.accountId };

    await store.setToken(record);
    await expect(store.getTokenByRef(ref)).resolves.toEqual(record);
    await expect(store.getTokenByProviderEmail('codex', ' DEV@example.com ')).resolves.toEqual(
      record
    );

    await expect(store.deleteTokenByProviderEmail('codex', 'dev@example.com')).resolves.toBe(true);
    await expect(store.getTokenByRef(ref)).resolves.toBeNull();
    await expect(store.deleteTokenByRef(ref)).resolves.toBe(false);
  });

  it('overwrites existing token records by account id or provider/email', async () => {
    const { store } = await tempStore();
    const first = token('dev@example.com');
    const second = { ...token('other@example.com'), accountId: first.accountId };

    await store.setToken(first);
    await store.setToken(second);

    const loaded = await store.load();
    expect(loaded.tokens).toEqual([second]);
  });

  it('rejects duplicate token records on save', async () => {
    const { store } = await tempStore();
    const first = token('dev@example.com');

    await expect(
      store.save({
        schemaVersion: '1',
        tokens: [first, { ...token('other@example.com'), accountId: first.accountId }]
      })
    ).rejects.toThrow('Invalid token file');
  });

  it('rejects duplicate account ids across different providers', async () => {
    const { store } = await tempStore();
    const first = token('dev@example.com');

    await expect(
      store.save({
        schemaVersion: '1',
        tokens: [
          first,
          {
            ...token('other@example.com'),
            accountId: first.accountId,
            provider: 'fake',
            email: 'other@example.com'
          }
        ]
      })
    ).rejects.toThrow('Invalid token file');
  });

  it('writes token files with 0600 mode where supported', async () => {
    const { store, tokenFile } = await tempStore();

    await store.setToken(token('dev@example.com'));

    const stats = await stat(tokenFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('throws sanitized validation errors that do not include token payload secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-token-invalid-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      paths.tokenFile,
      JSON.stringify({
        schemaVersion: '1',
        tokens: [
          {
            schemaVersion: '1',
            accountId: 'codex:dev@example.com',
            provider: 'codex',
            email: 'dev@example.com',
            createdAt: 'not-a-date',
            updatedAt: now,
            tokenType: 'fake',
            tokenPayload: { accessToken: secretSentinel }
          }
        ]
      }),
      'utf8'
    );

    await expect(new TokenStore(paths).load()).rejects.toThrow('Invalid token file');
    await new TokenStore(paths).load().catch((error: unknown) => {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(secretSentinel);
    });
  });
});
