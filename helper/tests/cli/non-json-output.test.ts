// Provenance: docs/test-traceability.md — CLI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';

async function withTempEnv(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-non-json-cli-'));
  process.env.AIQM_DATA_DIR = join(root, 'data');
  process.env.AIQM_CACHE_DIR = join(root, 'cache');
}

async function runTextCommand(args: string[]): Promise<string> {
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

// Traceability: BR: human-readable helper CLI; AC: non-JSON setup/account/status/poll/diagnose/reset output is clear and secret-free; TS: TSD CLI command UX.
describe('CLI non-JSON output', () => {
  it('prints useful non-JSON output for setup, status, poll, account, diagnose, and reset', async () => {
    await withTempEnv();

    await expect(runTextCommand(['setup'])).resolves.toContain('AI Agent Quota Monitor Setup');
    await expect(
      runTextCommand(['setup', '--provider', 'fake', '--email', 'dev@example.com', '--poll'])
    ).resolves.toContain('Setup complete for fake:dev@example.com');
    await expect(runTextCommand(['status'])).resolves.toContain('AIQM status:');
    await expect(runTextCommand(['poll'])).resolves.toContain('AIQM poll complete:');
    await expect(runTextCommand(['account', 'list'])).resolves.toContain('AIQM accounts:');
    await expect(runTextCommand(['diagnose'])).resolves.toContain('AIQM diagnostics');
    await expect(runTextCommand(['reset', '--all'])).resolves.toContain('AIQM reset complete:');
  });

  it('does not print token payloads or raw metadata in non-JSON output', async () => {
    await withTempEnv();

    const output = await runTextCommand([
      'setup',
      '--provider',
      'fake',
      '--email',
      'safe@example.com',
      '--poll'
    ]);

    expect(output).not.toContain('tokenPayload');
    expect(output).not.toContain('rawMetadata');
    expect(output).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });

  it('prints forced targeted poll context without unsafe fields', async () => {
    await withTempEnv();
    await runTextCommand(['setup', '--provider', 'fake', '--email', 'safe@example.com', '--poll']);

    const output = await runTextCommand([
      'poll',
      '--force',
      '--provider',
      'fake',
      '--email',
      'safe@example.com'
    ]);

    expect(output).toContain('AIQM poll complete (forced, target fake:safe@example.com):');
    expect(output).not.toContain('tokenPayload');
    expect(output).not.toContain('rawMetadata');
    expect(output).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
