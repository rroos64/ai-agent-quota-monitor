// Provenance: docs/test-traceability.md — Providers area
import { describe, expect, it } from 'vitest';
import {
  ProviderCommandError,
  ProviderCommandNotFoundError,
  ProviderCommandTimeoutError,
  StubProviderCommandRunner,
  type ProviderCommandInput,
  type ProviderCommandResult
} from '../../src/providers/index.js';
import { ProviderCapabilitiesService } from '../../src/services/index.js';

function commandResult(
  input: ProviderCommandInput,
  overrides: Partial<ProviderCommandResult> = {}
): ProviderCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    exitCode: 0,
    signal: null,
    stdout: `${input.command} 1.2.3\n`,
    stderr: '',
    timedOut: false,
    durationMs: 5,
    ...overrides
  };
}

// Traceability: BR: provider setup capability checks; AC: fake and Codex are usable while Claude is blocked pending spike and Antigravity is blocked/not implemented; TS: AUTH-STORE-001 provider capabilities.
describe('ProviderCapabilitiesService', () => {
  it('marks fake and Codex usable and blocks Claude Code as spike-required', () => {
    const service = new ProviderCapabilitiesService();

    expect(service.get('fake')).toMatchObject({
      implemented: true,
      usable: true,
      status: 'usable'
    });
    expect(service.get('codex')).toMatchObject({
      implemented: true,
      usable: true,
      status: 'usable'
    });
    expect(service.get('claude-code')).toMatchObject({
      implemented: false,
      usable: false,
      status: 'spike_required'
    });
    expect(service.get('antigravity')).toMatchObject({
      implemented: false,
      usable: false,
      status: 'not_implemented'
    });
    expect(service.get('codex').cliAvailability).toMatchObject({
      status: 'not_checked',
      command: 'codex',
      args: ['--version'],
      shell: false
    });
    expect(() => service.assertUsable('codex')).not.toThrow();
  });

  it('checks Codex and Claude CLI availability with safe version probes only', async () => {
    const runner = new StubProviderCommandRunner((input) => Promise.resolve(commandResult(input)));
    const service = new ProviderCapabilitiesService(runner);

    const capabilities = await service.listWithCliAvailability();

    expect(runner.calls).toEqual([
      { command: 'codex', args: ['--version'], timeoutMs: 1_000, shell: false },
      { command: 'claude', args: ['--version'], timeoutMs: 1_000, shell: false }
    ]);
    expect(capabilities.find((capability) => capability.provider === 'codex')).toMatchObject({
      provider: 'codex',
      usable: true,
      status: 'usable',
      cliAvailability: {
        status: 'available',
        command: 'codex',
        version: 'codex 1.2.3'
      }
    });
    expect(capabilities.find((capability) => capability.provider === 'claude-code')).toMatchObject({
      provider: 'claude-code',
      usable: false,
      status: 'spike_required',
      cliAvailability: {
        status: 'available',
        command: 'claude',
        version: 'claude 1.2.3'
      }
    });
  });

  it('classifies missing CLI probes without unblocking future providers', async () => {
    const runner = new StubProviderCommandRunner((input) =>
      Promise.reject(
        new ProviderCommandNotFoundError(commandResult(input, { exitCode: 127, stderr: 'ENOENT' }))
      )
    );
    const service = new ProviderCapabilitiesService(runner);

    await expect(service.getWithCliAvailability('codex')).resolves.toMatchObject({
      provider: 'codex',
      usable: true,
      status: 'usable',
      cliAvailability: {
        status: 'missing',
        command: 'codex',
        errorType: 'ProviderCommandNotFoundError'
      }
    });
  });

  it('classifies CLI probe errors without exposing command output', async () => {
    const runner = new StubProviderCommandRunner((input) =>
      Promise.reject(
        new ProviderCommandError('failed', commandResult(input, { exitCode: 2, stderr: 'bad' }))
      )
    );
    const service = new ProviderCapabilitiesService(runner);

    await expect(service.getWithCliAvailability('claude-code')).resolves.toMatchObject({
      provider: 'claude-code',
      usable: false,
      status: 'spike_required',
      cliAvailability: { status: 'error', command: 'claude', errorType: 'ProviderCommandError' }
    });
  });

  it('classifies CLI probe timeouts without exposing command output', async () => {
    const runner = new StubProviderCommandRunner((input) =>
      Promise.reject(
        new ProviderCommandTimeoutError(commandResult(input, { timedOut: true, exitCode: null }))
      )
    );
    const service = new ProviderCapabilitiesService(runner);

    await expect(service.getWithCliAvailability('codex')).resolves.toMatchObject({
      provider: 'codex',
      usable: true,
      status: 'usable',
      cliAvailability: {
        status: 'timeout',
        command: 'codex',
        errorType: 'ProviderCommandTimeoutError'
      }
    });
  });
});
