// Provenance: docs/test-traceability.md — CLI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';
import { resolveAppPaths, TokenStore } from '../../src/storage/index.js';

async function withTempEnv(): Promise<{ dataDir: string; cacheDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-account-cli-'));
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

// Traceability: BR: fake-provider MVP account setup; AC: add/list/delete/duplicate/non-fake/no-secret CLI behavior; TS: TSD setup/account CLI flow.
describe('account CLI commands', () => {
  it('adds, lists, and deletes a fake provider account as JSON', async () => {
    await withTempEnv();

    const added = await runCommand([
      'account',
      'add',
      '--provider',
      'fake',
      '--email',
      ' Dev@Example.COM ',
      '--scenario',
      'multi_window',
      '--display-name',
      'Development',
      '--display-order',
      '2',
      '--json'
    ]);

    expect(added).toMatchObject({
      added: true,
      account: {
        id: 'fake:dev@example.com',
        provider: 'fake',
        email: 'dev@example.com',
        displayOrder: 2,
        providerConfig: { scenario: 'multi_window', displayName: 'Development' }
      },
      tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' }
    });
    expect(JSON.stringify(added)).not.toContain('tokenPayload');

    const listed = await runCommand(['account', 'list', '--json']);
    expect(listed).toMatchObject({
      accounts: [
        {
          provider: 'fake',
          email: 'dev@example.com',
          providerConfig: { scenario: 'multi_window', displayName: 'Development' }
        }
      ]
    });

    const deleted = await runCommand([
      'account',
      'delete',
      '--provider',
      'fake',
      '--email',
      'dev@example.com',
      '--json'
    ]);
    expect(deleted).toEqual({
      deleted: true,
      deletedToken: true,
      provider: 'fake',
      email: 'dev@example.com'
    });
    await expect(runCommand(['account', 'list', '--json'])).resolves.toEqual({ accounts: [] });
  });

  it('blocks duplicate accounts', async () => {
    await withTempEnv();
    await runCommand([
      'account',
      'add',
      '--provider',
      'fake',
      '--email',
      'dev@example.com',
      '--json'
    ]);

    await expectCommandRejects(
      ['account', 'add', '--provider', 'fake', '--email', 'DEV@example.com', '--json'],
      'Account already configured: fake:dev@example.com'
    );
  });

  it('rejects non-integer display order values strictly', async () => {
    await withTempEnv();

    await expectCommandRejects(
      [
        'account',
        'add',
        '--provider',
        'fake',
        '--email',
        'dev@example.com',
        '--display-order',
        '2abc',
        '--json'
      ],
      'Display order must be a non-negative integer: 2abc'
    );
  });

  it('requires provider-owned profile paths for real provider add commands', async () => {
    await withTempEnv();

    await expectCommandRejects(
      ['account', 'add', '--provider', 'codex', '--email', 'dev@example.com', '--json'],
      '--codex-home is required for Codex accounts'
    );
    await expectCommandRejects(
      ['account', 'add', '--provider', 'claude-code', '--email', 'dev@example.com', '--json'],
      '--claude-config-dir is required for Claude Code accounts'
    );
  });

  it('does not expose token payloads or fake secrets in account command output', async () => {
    const { dataDir, cacheDir } = await withTempEnv();
    const added = await runCommand([
      'account',
      'add',
      '--provider',
      'fake',
      '--email',
      'secret@example.com',
      '--json'
    ]);
    const listed = await runCommand(['account', 'list', '--json']);
    const tokenFile = await new TokenStore(resolveAppPaths({ dataDir, cacheDir })).load();

    expect(JSON.stringify(added)).not.toContain('tokenPayload');
    expect(JSON.stringify(listed)).not.toContain('tokenPayload');
    expect(JSON.stringify(tokenFile)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
