// Provenance: docs/test-traceability.md — Storage area
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderProfileStore, resolveAppPaths } from '../../src/storage/index.js';

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
}

// Traceability: BR: provider auth profile isolation; AC: deterministic safe profile paths, private dirs, metadata-only save/load, and delete support; TS: AUTH-STORE-001 provider profile storage.
describe('ProviderProfileStore', () => {
  it('uses deterministic per-provider normalized-email directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);

    expect(store.profileDir('fake', ' Dev+Test@Example.COM ')).toBe(
      join(paths.providerProfilesDir, 'fake', 'dev_test@example.com')
    );
  });

  it('creates profile dirs private where supported and stores metadata without token payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);

    await store.saveMetadata({
      schemaVersion: '1',
      provider: 'fake',
      email: 'dev@example.com',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      metadata: { scenario: 'success' }
    });

    const profileStat = await stat(store.profileDir('fake', 'dev@example.com'));
    if (process.platform !== 'win32') {
      expect(profileStat.mode & 0o777).toBe(0o700);
    }
    const metadata = await store.loadMetadata('fake', 'dev@example.com');
    expect(metadata).toMatchObject({ provider: 'fake', email: 'dev@example.com' });
    expect(JSON.stringify(metadata)).not.toContain('tokenPayload');
    expect(JSON.stringify(metadata)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });

  it('rejects sensitive keys and sentinel values before writing metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);
    const base = {
      schemaVersion: '1' as const,
      provider: 'fake' as const,
      email: 'dev@example.com',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z'
    };

    const unsafeProfiles = [
      { ...base, metadata: { accessToken: 'abc' } },
      { ...base, metadata: { refreshToken: 'abc' } },
      { ...base, tokenPayload: { accessToken: 'abc' } },
      { ...base, metadata: { cookie: 'session=abc' } },
      { ...base, metadata: { authorization: 'Bearer abc' } },
      { ...base, metadata: { note: 'SECRET_SENTINEL_DO_NOT_LEAK' } }
    ];

    for (const profile of unsafeProfiles) {
      await expect(store.saveMetadata(profile)).rejects.toThrow(
        'Provider profile metadata contains sensitive'
      );
    }

    await expect(store.loadMetadata('fake', 'dev@example.com')).resolves.toBeNull();
    await expect(exists(store.metadataFile('fake', 'dev@example.com'))).resolves.toBe(false);
  });

  it('does not write sensitive metadata when rejecting unsafe profiles after a safe profile exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);
    const safe = {
      schemaVersion: '1' as const,
      provider: 'fake' as const,
      email: 'dev@example.com',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      metadata: { scenario: 'success' }
    };

    await store.saveMetadata(safe);
    await expect(
      store.saveMetadata({
        ...safe,
        metadata: { scenario: 'success', cookie: 'SECRET_SENTINEL_DO_NOT_LEAK' }
      })
    ).rejects.toThrow('Provider profile metadata contains sensitive');

    const written = await readFile(store.metadataFile('fake', 'dev@example.com'), 'utf8');
    expect(written).not.toContain('cookie');
    expect(written).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(written).not.toContain('tokenPayload');
  });

  it('imports Claude config dirs into private AIQM-owned provider profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);
    const source = join(root, 'source-claude');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, '.claude.json'), '{}', 'utf8');

    const target = await store.importClaudeConfigDir('dev@example.com', source);

    expect(target).toBe(store.claudeConfigDir('dev@example.com'));
    await expect(readFile(join(target, '.claude.json'), 'utf8')).resolves.toBe('{}');
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o700);
      expect((await stat(join(target, '.claude.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects Claude config imports containing symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);
    const source = join(root, 'source-claude');
    await mkdir(source, { recursive: true });
    await symlink(join(root, 'outside'), join(source, 'outside-link'));

    await expect(store.importClaudeConfigDir('dev@example.com', source)).rejects.toThrow(
      'Claude config dir source must not contain symlinks'
    );
    await expect(exists(store.claudeConfigDir('dev@example.com'))).resolves.toBe(false);
  });

  it('deletes individual profiles and all provider profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-provider-profile-'));
    const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
    const store = new ProviderProfileStore(paths);
    const metadata = {
      schemaVersion: '1' as const,
      provider: 'fake' as const,
      email: 'dev@example.com',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z'
    };

    await store.saveMetadata(metadata);
    await store.deleteProfile('fake', 'dev@example.com');
    await expect(exists(store.profileDir('fake', 'dev@example.com'))).resolves.toBe(false);

    await store.saveMetadata(metadata);
    await store.deleteAll();
    await expect(exists(paths.providerProfilesDir)).resolves.toBe(false);
  });
});
