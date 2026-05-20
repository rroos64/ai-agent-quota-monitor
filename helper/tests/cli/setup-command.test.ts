// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';
import { resolveAppPaths } from '../../src/storage/index.js';

async function withTempEnv(): Promise<{ dataDir: string; cacheDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-setup-cli-'));
  const dataDir = join(root, 'data');
  const cacheDir = join(root, 'cache');
  process.env.AIQM_DATA_DIR = dataDir;
  process.env.AIQM_CACHE_DIR = cacheDir;
  return { dataDir, cacheDir };
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

async function expectCommandRejects(args: string[], message: string): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await expect(program.parseAsync(['node', 'aiqm', ...args])).rejects.toThrow(message);
}

// Traceability: BR: fast fake-provider MVP setup; AC: setup shell/add/poll/duplicate/no-secret behavior; TS: TSD setup CLI flow with minimal TUI shell.
describe('setup CLI command', () => {
  it('prints a safe setup shell model for setup --json', async () => {
    await withTempEnv();

    const result = await runCommand(['setup', '--json']);

    expect(result).toMatchObject({
      interactive: true,
      implemented: true,
      model: {
        title: 'AI Agent Quota Monitor Setup',
        accountCount: 0,
        accounts: []
      }
    });
    expect(JSON.stringify(result)).toContain('force-refresh the selected account');
    expect(JSON.stringify(result)).toContain('h/refres(h)-all');
    expect(JSON.stringify(result)).toContain('refresh-all');
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
  });

  it('adds a fake provider account through setup --json', async () => {
    await withTempEnv();

    const result = await runCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      ' Dev@Example.COM ',
      '--scenario',
      'multi_window',
      '--display-name',
      'Development',
      '--display-order',
      '3',
      '--json'
    ]);

    expect(result).toMatchObject({
      setup: true,
      add: {
        added: true,
        account: {
          id: 'fake:dev@example.com',
          provider: 'fake',
          email: 'dev@example.com',
          displayOrder: 3,
          providerConfig: { scenario: 'multi_window', displayName: 'Development' }
        },
        tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' }
      },
      poll: null
    });
  });

  it('setup --poll creates latest state and history', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const paths = resolveAppPaths({ dataDir, cacheDir });

    const result = await runCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      'poll@example.com',
      '--poll',
      '--json'
    ]);

    expect(result).toMatchObject({
      setup: true,
      poll: {
        accountsConfigured: 1,
        successes: 1,
        failures: 0,
        historyEntriesWritten: 1
      }
    });
    await expect(readFile(paths.latestStateFile, 'utf8')).resolves.toContain('poll@example.com');
    await expect(readFile(paths.historyLogFile, 'utf8')).resolves.toContain('weekly');
  });

  it('blocks duplicate setup accounts', async () => {
    await withTempEnv();
    await runCommand(['setup', '--provider', 'fake', '--email', 'dev@example.com', '--json']);

    await expectCommandRejects(
      ['setup', '--provider', 'fake', '--email', 'DEV@example.com', '--json'],
      'Account already configured: fake:dev@example.com'
    );
  });

  it('does not expose token payloads or secret sentinels in setup JSON output', async () => {
    await withTempEnv();

    const result = await runCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      'secret@example.com',
      '--poll',
      '--json'
    ]);

    expect(JSON.stringify(result)).not.toContain('tokenPayload');
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(JSON.stringify(result)).not.toContain('rawMetadata');
  });
});
