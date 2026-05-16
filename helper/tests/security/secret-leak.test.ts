// Provenance: docs/test-traceability.md — Security area
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import { FakeProviderAdapter, type Clock } from '../../src/providers/index.js';
import { LatestStateStore, resolveAppPaths } from '../../src/storage/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

const fakeClock: Clock = {
  now: () => new Date(now),
  nowIso: () => now
};

async function withTempEnv(): Promise<{ dataDir: string; cacheDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-secret-leak-'));
  const dataDir = join(root, 'data');
  const cacheDir = join(root, 'cache');
  process.env.AIQM_DATA_DIR = dataDir;
  process.env.AIQM_CACHE_DIR = cacheDir;
  return { dataDir, cacheDir };
}

async function runCommand(args: string[]): Promise<string> {
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
  return output[0] ?? '';
}

function account(): ConfiguredAccount {
  return {
    id: accountIdFor('fake', 'secret@example.com'),
    provider: 'fake',
    email: 'secret@example.com',
    displayOrder: 0,
    providerConfig: { scenario: 'success', ignoredSecretInput: secretSentinel },
    createdAt: now,
    updatedAt: now
  };
}

// Traceability: BR: no secrets in user-visible output or display-safe state; AC: CLI/latest/history/provider-normalized outputs exclude sentinel; TS: TSD security and diagnostics boundaries.
describe('secret leak regression coverage', () => {
  it('does not leak sentinels through CLI setup/account list/poll/status/diagnose', async () => {
    await withTempEnv();

    const outputs = [
      await runCommand([
        'setup',
        '--provider',
        'fake',
        '--email',
        'secret@example.com',
        '--poll',
        '--json'
      ]),
      await runCommand(['account', 'list', '--json']),
      await runCommand(['poll', '--json']),
      await runCommand(['status', '--json']),
      await runCommand(['diagnose', '--json'])
    ];

    for (const output of outputs) {
      expect(output).not.toContain(secretSentinel);
      expect(output).not.toContain('tokenPayload');
      expect(output).not.toContain('rawMetadata');
    }
  });

  it('CLI operations create safe diagnostics logs', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });

    await runCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      'logs@example.com',
      '--poll',
      '--json'
    ]);
    await runCommand([
      'account',
      'delete',
      '--provider',
      'fake',
      '--email',
      'logs@example.com',
      '--json'
    ]);

    const log = await readFile(paths.logFile, 'utf8');
    expect(log).toContain('account.add');
    expect(log).toContain('setup');
    expect(log).toContain('poll');
    expect(log).toContain('account.delete');
    expect(log).not.toContain(secretSentinel);
    expect(log).not.toContain('tokenPayload');
    expect(log).not.toContain('rawMetadata');
  });

  it('does not leak sentinels through latest/history/provider normalized output', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });
    await runCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      'secret@example.com',
      '--poll',
      '--json'
    ]);

    const latest = await readFile(paths.latestStateFile, 'utf8');
    const history = await readFile(paths.historyLogFile, 'utf8');
    const adapter = new FakeProviderAdapter(fakeClock);
    const quota = await adapter.fetchQuota(account());
    quota.rawMetadata = { token: secretSentinel };
    const card = await adapter.normaliseQuota(account(), quota);
    await new LatestStateStore(paths).save({
      schemaVersion: '1',
      generatedAt: now,
      accounts: [card]
    });

    expect(latest).not.toContain(secretSentinel);
    expect(history).not.toContain(secretSentinel);
    expect(JSON.stringify(card)).not.toContain(secretSentinel);
    expect(JSON.stringify(card)).not.toContain('rawMetadata');
  });

  it('diagnose malformed files do not echo secret contents', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      paths.configFile,
      JSON.stringify({
        token: secretSentinel,
        accessToken: secretSentinel,
        clientSecret: secretSentinel
      }),
      'utf8'
    );
    await writeFile(
      paths.latestStateFile,
      JSON.stringify({
        token: secretSentinel,
        authHeader: secretSentinel,
        passwordHash: secretSentinel
      }),
      'utf8'
    );

    const output = await runCommand(['diagnose', '--json']);

    expect(output).not.toContain(secretSentinel);
    expect(output).not.toContain('tokenPayload');
    expect(output).not.toContain('accessToken');
    expect(output).not.toContain('clientSecret');
    expect(output).not.toContain('authHeader');
    expect(output).not.toContain('passwordHash');
  });
});
