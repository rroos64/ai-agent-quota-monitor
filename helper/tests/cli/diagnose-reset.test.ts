// Provenance: docs/test-traceability.md — CLI area
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import {
  ConfigStore,
  HistoryWriter,
  LatestStateStore,
  ProviderProfileStore,
  TokenStore,
  resolveAppPaths
} from '../../src/storage/index.js';
import type {
  AppConfigContract,
  LatestStateContract,
  TokenFileContract
} from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

async function withTempEnv(): Promise<{ root: string; dataDir: string; cacheDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-diagnose-reset-cli-'));
  const dataDir = join(root, 'data');
  const cacheDir = join(root, 'cache');
  process.env.AIQM_DATA_DIR = dataDir;
  process.env.AIQM_CACHE_DIR = cacheDir;
  return { root, dataDir, cacheDir };
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
}

async function runCommand(args: string[]): Promise<unknown> {
  const output: string[] = [];
  const errorOutput: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    output.push(String(message));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
    errorOutput.push(String(message));
  });

  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'aiqm', ...args]);
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  expect(errorOutput).toEqual([]);
  expect(output).toHaveLength(1);
  return JSON.parse(output[0] ?? 'null') as unknown;
}

function account(): ConfiguredAccount {
  return {
    id: accountIdFor('fake', 'dev@example.com'),
    provider: 'fake',
    email: 'dev@example.com',
    displayOrder: 0,
    providerConfig: { scenario: 'success' },
    createdAt: now,
    updatedAt: now
  };
}

async function seedHealthyFiles(dataDir: string, cacheDir: string): Promise<void> {
  const paths = resolveAppPaths({ dataDir, cacheDir });
  const config: AppConfigContract = {
    schemaVersion: '1',
    accounts: [account()],
    settings: { refreshIntervalMinutes: 5 }
  };
  const latest: LatestStateContract = {
    schemaVersion: '1',
    generatedAt: now,
    accounts: []
  };
  const tokenFile: TokenFileContract = {
    schemaVersion: '1',
    tokens: [
      {
        schemaVersion: '1',
        accountId: account().id,
        provider: 'fake',
        email: 'dev@example.com',
        createdAt: now,
        updatedAt: now,
        tokenType: 'fake-token-ref',
        tokenPayload: {}
      }
    ]
  };

  await new ConfigStore(paths).save(config);
  await new LatestStateStore(paths).save(latest);
  await new TokenStore(paths).save(tokenFile);
  await new HistoryWriter(paths).append({
    schemaVersion: '1',
    timestamp: now,
    provider: 'fake',
    email: 'dev@example.com',
    quotaWindow: 'weekly',
    usedPercentage: 42,
    resetAt: now,
    status: 'fresh'
  });
  await mkdir(paths.logDir, { recursive: true });
  await writeFile(paths.logFile, 'log line\n', 'utf8');
  await new ProviderProfileStore(paths).saveMetadata({
    schemaVersion: '1',
    provider: 'fake',
    email: 'dev@example.com',
    createdAt: now,
    updatedAt: now,
    metadata: { scenario: 'success' }
  });
}

// Traceability: BR: local diagnostics and reset safety; AC: safe JSON diagnose/reset under temp AppPaths only; TS: TSD CLI diagnostics/reset commands.
describe('diagnose and reset CLI commands', () => {
  it('diagnose --json reports healthy app paths, files, and fake provider registry', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    await seedHealthyFiles(dataDir, cacheDir);

    const result = await runCommand(['diagnose', '--json']);

    expect(result).toMatchObject({
      ok: true,
      paths: { dataDir, cacheDir },
      checks: {
        config: { exists: true, valid: true },
        latest: { exists: true, valid: true },
        tokenFile: { exists: true, readable: true, writable: true, securePermissions: true },
        providers: { fakeRegistered: true, registered: ['fake', 'codex', 'claude-code'] }
      }
    });
  });

  it('diagnose --json reports malformed config or latest without leaking file contents', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      paths.configFile,
      JSON.stringify({ schemaVersion: '1', tokenPayload: secretSentinel }),
      'utf8'
    );
    await writeFile(
      paths.latestStateFile,
      JSON.stringify({ schemaVersion: '1', tokenPayload: secretSentinel }),
      'utf8'
    );

    const result = await runCommand(['diagnose', '--json']);

    expect(result).toMatchObject({
      ok: false,
      checks: {
        config: { exists: true, valid: false },
        latest: { exists: true, valid: false }
      }
    });
    expect(JSON.stringify(result)).not.toContain(secretSentinel);
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
  });

  it('diagnose --json never includes token file payload secrets', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });
    await seedHealthyFiles(dataDir, cacheDir);
    await writeFile(
      paths.tokenFile,
      JSON.stringify({
        schemaVersion: '1',
        tokens: [
          {
            schemaVersion: '1',
            accountId: account().id,
            provider: 'fake',
            email: 'dev@example.com',
            createdAt: now,
            updatedAt: now,
            tokenType: 'fake-token-ref',
            tokenPayload: { accessToken: secretSentinel }
          }
        ]
      }),
      'utf8'
    );

    const result = await runCommand(['diagnose', '--json']);

    expect(JSON.stringify(result)).not.toContain(secretSentinel);
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('reset --all --json removes configured files and logs but not the temp root directory', async () => {
    const { root, dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });
    const outsideFile = join(root, 'outside.txt');
    await seedHealthyFiles(dataDir, cacheDir);
    await writeFile(outsideFile, 'outside', 'utf8');

    const result = await runCommand(['reset', '--all', '--json']);

    expect(result).toMatchObject({ reset: true, dataDir, cacheDir });
    await expect(exists(paths.configFile)).resolves.toBe(false);
    await expect(exists(paths.tokenFile)).resolves.toBe(false);
    await expect(exists(paths.latestStateFile)).resolves.toBe(false);
    await expect(exists(paths.historyLogFile)).resolves.toBe(false);
    await expect(exists(paths.logFile)).resolves.toBe(false);
    await expect(exists(paths.logDir)).resolves.toBe(false);
    await expect(exists(paths.providerProfilesDir)).resolves.toBe(false);
    await expect(exists(root)).resolves.toBe(true);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside');
  });
});
