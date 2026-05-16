// Provenance: docs/test-traceability.md — Providers area
import { execPath } from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  NodeProviderCommandRunner,
  ProviderCommandError,
  ProviderCommandNotFoundError,
  ProviderCommandTimeoutError,
  safeProviderCommandResult
} from '../../src/providers/index.js';

const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

// Traceability: BR: safe provider CLI integration; AC: command runner captures outputs, handles failures/timeouts/not-found, supports env/cwd, and redacts logs; TS: PROVIDER-CLI-001 provider command runner abstraction.
describe('NodeProviderCommandRunner', () => {
  it('runs commands without shell by default and captures stdout/stderr', async () => {
    const runner = new NodeProviderCommandRunner();

    const result = await runner.run({
      command: execPath,
      args: ['-e', "console.log('ok'); console.error('warn')"],
      timeoutMs: 5_000
    });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout.trim()).toBe('ok');
    expect(result.stderr.trim()).toBe('warn');
  });

  it('rejects non-zero exits with captured result', async () => {
    const runner = new NodeProviderCommandRunner();

    await expect(
      runner.run({ command: execPath, args: ['-e', "console.error('bad'); process.exit(7)"] })
    ).rejects.toMatchObject({
      name: 'ProviderCommandError',
      result: { exitCode: 7, stderr: 'bad\n' }
    });
  });

  it('rejects timed out commands', async () => {
    const runner = new NodeProviderCommandRunner();

    await expect(
      runner.run({ command: execPath, args: ['-e', 'setTimeout(() => {}, 5000)'], timeoutMs: 50 })
    ).rejects.toBeInstanceOf(ProviderCommandTimeoutError);
  });

  it('rejects missing commands as command-not-found', async () => {
    const runner = new NodeProviderCommandRunner();

    await expect(
      runner.run({ command: 'aiqm-command-that-does-not-exist-for-test', args: [] })
    ).rejects.toBeInstanceOf(ProviderCommandNotFoundError);
  });

  it('supports env overrides and cwd', async () => {
    const runner = new NodeProviderCommandRunner();

    const result = await runner.run({
      command: execPath,
      args: ['-e', 'console.log(`${process.env.AIQM_RUNNER_TEST}:${process.cwd()}`)'],
      cwd: process.cwd(),
      env: { AIQM_RUNNER_TEST: 'from-env' }
    });

    expect(result.stdout.trim()).toBe(`from-env:${process.cwd()}`);
  });

  it('redacts safe results and logger metadata', async () => {
    const logged: unknown[] = [];
    const logger = {
      info: (_event: string, _message: string, metadata?: Record<string, unknown>) => {
        logged.push(metadata);
        return Promise.resolve();
      },
      warn: (_event: string, _message: string, metadata?: Record<string, unknown>) => {
        logged.push(metadata);
        return Promise.resolve();
      }
    };
    const runner = new NodeProviderCommandRunner(logger);

    const result = await runner.run({
      command: execPath,
      args: [
        '-e',
        `console.log('Authorization: Bearer sk-command-runner-token'); console.error('access_token=acc_command_runner')`
      ]
    });
    const safe = safeProviderCommandResult({
      ...result,
      stderr: `${result.stderr}\nauthorization=Bearer sk-stderr-token\ncookie=session_value`
    });

    expect(JSON.stringify(safe)).not.toContain('sk-command-runner-token');
    expect(JSON.stringify(safe)).not.toContain('acc_command_runner');
    expect(JSON.stringify(safe)).not.toContain('sk-stderr-token');
    expect(JSON.stringify(safe)).not.toContain('session_value');
    expect(JSON.stringify(logged)).not.toContain('sk-command-runner-token');
    expect(JSON.stringify(logged)).not.toContain('acc_command_runner');
    expect(JSON.stringify(logged)).not.toContain(secretSentinel);
  });

  it('suppresses command logging when requested', async () => {
    const logged: unknown[] = [];
    const logger = {
      info: (_event: string, _message: string, metadata?: Record<string, unknown>) => {
        logged.push(metadata);
        return Promise.resolve();
      },
      warn: (_event: string, _message: string, metadata?: Record<string, unknown>) => {
        logged.push(metadata);
        return Promise.resolve();
      }
    };
    const runner = new NodeProviderCommandRunner(logger);

    const result = await runner.run({
      command: execPath,
      args: ['-e', "console.log('account@example.test SECRET_SENTINEL_DO_NOT_LEAK')"],
      suppressLogging: true
    });

    expect(result.stdout).toContain('account@example.test');
    expect(logged).toEqual([]);
  });

  it('exposes typed provider command errors', () => {
    const result = {
      command: 'cmd',
      args: [],
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 1
    };

    expect(new ProviderCommandError('failed', result).result).toBe(result);
  });
});
