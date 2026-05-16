// Provenance: docs/test-traceability.md — Storage area
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LatestStateStore, resolveAppPaths } from '../../src/storage/index.js';
import type { LatestStateContract } from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

async function tempStore(): Promise<{ store: LatestStateStore; latestStateFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-latest-store-'));
  const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
  return {
    store: new LatestStateStore({
      latestStateFile: paths.latestStateFile,
      clock: () => new Date(now)
    }),
    latestStateFile: paths.latestStateFile
  };
}

function latestState(): LatestStateContract {
  return {
    schemaVersion: '1',
    generatedAt: now,
    accounts: [
      {
        provider: 'codex',
        email: 'dev@example.com',
        displayOrder: 0,
        status: 'fresh',
        windows: [
          {
            id: 'weekly',
            providerWindowName: 'Weekly',
            usedPercentage: 42,
            resetAt: now,
            resetInText: 'in 2 days',
            status: 'fresh',
            hint: 'display-only hint'
          }
        ],
        lastSuccessfulRefreshAt: now,
        lastAttemptedRefreshAt: now,
        stale: false,
        errorHint: null
      }
    ]
  };
}

// Traceability: BR: desklet consumes normalized latest state; AC: missing-safe, validated, atomic latest writes; TS: TSD §9.4 Latest State Store.
describe('LatestStateStore', () => {
  it('loads a safe empty default when latest state is missing', async () => {
    const { store } = await tempStore();

    await expect(store.loadResult()).resolves.toEqual({
      exists: false,
      state: { schemaVersion: '1', generatedAt: now, accounts: [] }
    });
  });

  it('roundtrips latest state and writes atomically via parent directory creation', async () => {
    const { store, latestStateFile } = await tempStore();
    const state = latestState();

    await store.save(state);

    await expect(store.loadResult()).resolves.toEqual({ exists: true, state });
    await expect(readFile(latestStateFile, 'utf8')).resolves.toContain('"schemaVersion": "1"');
  });

  it('rejects malformed latest state files', async () => {
    const { store, latestStateFile } = await tempStore();
    await mkdir(join(latestStateFile, '..'), { recursive: true });
    await writeFile(latestStateFile, JSON.stringify({ schemaVersion: '1', accounts: [] }), 'utf8');

    await expect(store.load()).rejects.toThrow(`Invalid latest state file: ${latestStateFile}`);
  });

  it('rejects attempts to save non-contract data and does not leak secret values in errors', async () => {
    const { store } = await tempStore();
    const invalidState = {
      ...latestState(),
      tokenPayload: { accessToken: secretSentinel }
    };

    await expect(store.save(invalidState as LatestStateContract)).rejects.toThrow(
      'Invalid latest state file'
    );
    await store.save(invalidState as LatestStateContract).catch((error: unknown) => {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(secretSentinel);
    });
  });

  it('does not write secret sentinels when given valid display-only data', async () => {
    const { store, latestStateFile } = await tempStore();

    await store.save(latestState());

    await expect(readFile(latestStateFile, 'utf8')).resolves.not.toContain(secretSentinel);
  });
});
