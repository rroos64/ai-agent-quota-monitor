// Provenance: docs/test-traceability.md — CLI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import { buildProgram } from '../../src/cli/index.js';
import { ConfigStore, resolveAppPaths } from '../../src/storage/index.js';
import type { AppConfigContract } from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';

async function withTempEnv(): Promise<{ dataDir: string; cacheDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-cli-'));
  const dataDir = join(root, 'data');
  const cacheDir = join(root, 'cache');
  process.env.AIQM_DATA_DIR = dataDir;
  process.env.AIQM_CACHE_DIR = cacheDir;
  return { dataDir, cacheDir };
}

function fakeAccount(): ConfiguredAccount {
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

async function seedConfig(dataDir: string, cacheDir: string): Promise<void> {
  const paths = resolveAppPaths({ dataDir, cacheDir });
  const config: AppConfigContract = {
    schemaVersion: '1',
    accounts: [fakeAccount()],
    settings: { refreshIntervalMinutes: 5 }
  };
  await new ConfigStore(paths).save(config);
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

// Traceability: BR: scriptable helper CLI; AC: status reads latest only, poll writes latest, JSON output is safe; TS: TSD CLI commands.
describe('CLI JSON commands', () => {
  it('status --json reads missing latest as safe empty state without polling', async () => {
    await withTempEnv();

    const parsed = await runCommand(['status', '--json']);

    expect(parsed).toMatchObject({
      schemaVersion: '1',
      accounts: []
    });
    expect(JSON.stringify(parsed)).not.toContain('tokenPayload');
  });

  it('poll --json polls fake provider and prints safe summary', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    await seedConfig(dataDir, cacheDir);

    const parsed = await runCommand(['poll', '--json']);

    expect(parsed).toMatchObject({
      summary: {
        accountsConfigured: 1,
        accountsPolled: 1,
        successes: 1,
        failures: 0,
        historyEntriesWritten: 1
      }
    });
    expect(JSON.stringify(parsed)).not.toContain('rawMetadata');
    expect(JSON.stringify(parsed)).not.toContain('tokenPayload');
  });

  it('status --json reads latest written by poll --json without polling again', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    await seedConfig(dataDir, cacheDir);
    await runCommand(['poll', '--json']);

    const parsed = await runCommand(['status', '--json']);

    expect(parsed).toMatchObject({
      schemaVersion: '1',
      accounts: [
        {
          provider: 'fake',
          email: 'dev@example.com',
          status: 'fresh',
          windows: [{ id: 'weekly', usedPercentage: 42 }]
        }
      ]
    });
  });
});
