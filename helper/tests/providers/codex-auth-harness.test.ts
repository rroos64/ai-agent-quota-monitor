// Provenance: docs/test-traceability.md — Providers area
import { describe, expect, it } from 'vitest';
import {
  CodexDeviceAuthHarness,
  parseCodexDeviceAuthOutput,
  parseCodexLoginStatusOutput,
  ProviderCommandError,
  StubProviderCommandRunner,
  type CodexDeviceAuthProcess,
  type ProviderCommandInput,
  type ProviderCommandResult
} from '../../src/providers/index.js';

const codexHome = '/tmp/aiqm-codex-home-test/codex-home-account-a';
const deviceOutput = [
  'To authenticate, open https://auth.openai.example/device',
  'Enter code: ABCD-1234'
].join('\n');

function result(
  input: ProviderCommandInput,
  overrides: Partial<ProviderCommandResult> = {}
): ProviderCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    exitCode: 0,
    signal: null,
    stdout: 'Logged in as codex-user@example.test\n',
    stderr: '',
    timedOut: false,
    durationMs: 1,
    ...overrides
  };
}

class StubCodexDeviceAuthProcess implements CodexDeviceAuthProcess {
  cancelledWith: NodeJS.Signals | undefined;

  constructor(readonly output: string) {}

  cancel(signal?: NodeJS.Signals): void {
    this.cancelledWith = signal;
  }
}

// Traceability: BR: real-provider auth spikes must be safe and TUI-orchestratable; AC: Codex device-auth harness parses instructions, redacts device codes/URLs, uses isolated CODEX_HOME, parses status, and supports cancellation without invoking real Codex in tests; TS: CODEX-AUTH-SPIKE-HARNESS-001.
describe('Codex device-auth spike harness', () => {
  it('parses device-auth verification URL and user code from CLI prompt output', () => {
    expect(parseCodexDeviceAuthOutput(deviceOutput)).toEqual({
      verificationUrl: 'https://auth.openai.example/device',
      userCode: 'ABCD-1234'
    });
    expect(parseCodexDeviceAuthOutput('No auth prompt here')).toBeNull();
  });

  it('parses representative Codex one-time code output without matching common words', () => {
    const output = [
      'Welcome to Codex [v0.130.0]',
      'Follow these steps to sign in with ChatGPT using device code authorization:',
      '',
      '1. Open this link in your browser and sign in to your account',
      '   https://auth.openai.com/codex/device',
      '',
      '2. Enter this one-time code (expires in 15 minutes)',
      '   ABCD-1234',
      '',
      'Device codes are a common phishing target. Never share this code.'
    ].join('\n');

    expect(parseCodexDeviceAuthOutput(output)).toEqual({
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234'
    });
    expect(parseCodexDeviceAuthOutput(output)?.userCode).not.toBe('this');
  });

  it('strips ANSI sequences before parsing Codex device-auth output', () => {
    const output = [
      '\u001B[90mWelcome to Codex\u001B[0m',
      '1. Open this link in your browser and sign in to your account',
      '   \u001B[94mhttps://auth.openai.com/codex/device\u001B[0m',
      '',
      '2. Enter this one-time code \u001B[90m(expires in 15 minutes)\u001B[0m',
      '   \u001B[94mABCD-1234\u001B[0m'
    ].join('\n');

    expect(parseCodexDeviceAuthOutput(output)).toEqual({
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234'
    });
  });

  it('starts an abstract device-auth process and logs no raw URL or user code', async () => {
    const logged: unknown[] = [];
    const process = new StubCodexDeviceAuthProcess(deviceOutput);
    const harness = new CodexDeviceAuthHarness({
      commandRunner: new StubProviderCommandRunner((input) => Promise.resolve(result(input))),
      processStarter: {
        start: (input) => {
          expect(input).toEqual({
            command: 'codex',
            args: ['login', '--device-auth'],
            env: { CODEX_HOME: codexHome },
            shell: false,
            timeoutMs: 30_000
          });
          return Promise.resolve(process);
        }
      },
      logger: {
        info: (_event, _message, metadata) => {
          logged.push(metadata);
          return Promise.resolve();
        }
      },
      clock: {
        now: () => new Date('2026-05-12T00:00:00.000Z'),
        nowIso: () => '2026-05-12T00:00:00.000Z'
      }
    });

    const started = await harness.startDeviceAuth({
      codexHome,
      expectedEmail: 'codex-user@example.test',
      sessionId: 'codex-session-1'
    });

    expect(started.instructions).toEqual({
      verificationUrl: 'https://auth.openai.example/device',
      userCode: 'ABCD-1234'
    });
    expect(started.authSession).toMatchObject({
      id: 'codex-session-1',
      provider: 'codex',
      expectedEmail: 'codex-user@example.test',
      status: 'waiting',
      tokenRef: null
    });
    expect(JSON.stringify(logged)).not.toContain('ABCD-1234');
    expect(JSON.stringify(logged)).not.toContain('https://auth.openai.example/device');
    expect(JSON.stringify(logged)).toContain('[REDACTED]');
  });

  it('does not expose raw malformed device-auth output in thrown parse errors', async () => {
    const malformedOutput = [
      'Open https://auth.openai.example/device-sensitive',
      'Use device_code=SENSITIVE-DEVICE-CODE',
      'Missing user-code prompt shape'
    ].join('\n');
    const harness = new CodexDeviceAuthHarness({
      commandRunner: new StubProviderCommandRunner((input) => Promise.resolve(result(input))),
      processStarter: {
        start: () => Promise.resolve(new StubCodexDeviceAuthProcess(malformedOutput))
      }
    });

    let thrown: unknown;
    try {
      await harness.startDeviceAuth({
        codexHome,
        expectedEmail: 'codex-user@example.test'
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderCommandError);
    expect(String(thrown)).not.toContain('SENSITIVE-DEVICE-CODE');
    expect(String(thrown)).not.toContain('https://auth.openai.example/device-sensitive');
    expect(JSON.stringify(thrown)).not.toContain('SENSITIVE-DEVICE-CODE');
    expect(JSON.stringify(thrown)).not.toContain('https://auth.openai.example/device-sensitive');
    expect((thrown as ProviderCommandError).result.stdout).toBe(
      '[REDACTED_CODEX_DEVICE_AUTH_OUTPUT]'
    );
  });

  it('starts browser login with plain codex login args and never logs raw process output', async () => {
    const logged: unknown[] = [];
    const process = new StubCodexDeviceAuthProcess(
      'Open browser to https://auth.openai.example/sensitive-login?unrecognized_secret_phrase=DO_NOT_LOG_BROWSER_OUTPUT'
    );
    const harness = new CodexDeviceAuthHarness({
      commandRunner: new StubProviderCommandRunner((input) => Promise.resolve(result(input))),
      processStarter: {
        start: (input) => {
          expect(input).toEqual({
            command: 'codex',
            args: ['login'],
            env: { CODEX_HOME: codexHome },
            shell: false
          });
          return Promise.resolve(process);
        }
      },
      logger: {
        info: (_event, _message, metadata) => {
          logged.push(metadata);
          return Promise.resolve();
        }
      }
    });

    const started = await harness.startBrowserLogin({
      codexHome,
      expectedEmail: 'codex-user@example.test',
      sessionId: 'codex-browser-1'
    });

    expect(started).toMatchObject({
      safeOutputSummary: '[REDACTED_CODEX_BROWSER_LOGIN_OUTPUT]',
      authSession: { id: 'codex-browser-1', provider: 'codex', status: 'waiting' }
    });
    expect(JSON.stringify(logged)).toContain('[REDACTED_CODEX_BROWSER_LOGIN_OUTPUT]');
    expect(JSON.stringify(logged)).not.toContain('https://auth.openai.example/sensitive-login');
    expect(JSON.stringify(logged)).not.toContain('DO_NOT_LOG_BROWSER_OUTPUT');
    expect(JSON.stringify(logged)).not.toContain('unrecognized_secret_phrase');
  });

  it('checks login status with isolated CODEX_HOME and parses logged-in output', async () => {
    const runner = new StubProviderCommandRunner((input) => Promise.resolve(result(input)));
    const harness = new CodexDeviceAuthHarness({
      commandRunner: runner,
      processStarter: { start: () => Promise.resolve(new StubCodexDeviceAuthProcess(deviceOutput)) }
    });

    await expect(harness.checkLoginStatus(codexHome)).resolves.toEqual({
      status: 'logged_in',
      summary: 'Logged in'
    });
    expect(runner.calls).toEqual([
      {
        command: 'codex',
        args: ['login', 'status'],
        env: { CODEX_HOME: codexHome },
        timeoutMs: 5_000,
        shell: false,
        suppressLogging: true
      }
    ]);
  });

  it('parses not-logged-in status from non-zero command result', async () => {
    const runner = new StubProviderCommandRunner((input) =>
      Promise.reject(
        new ProviderCommandError(
          'not logged in',
          result(input, { exitCode: 1, stdout: 'Not logged in\n' })
        )
      )
    );
    const harness = new CodexDeviceAuthHarness({
      commandRunner: runner,
      processStarter: { start: () => Promise.resolve(new StubCodexDeviceAuthProcess(deviceOutput)) }
    });

    await expect(harness.checkLoginStatus(codexHome)).resolves.toEqual({
      status: 'not_logged_in',
      summary: 'Not logged in'
    });
    expect(parseCodexLoginStatusOutput('', 1)).toEqual({
      status: 'unknown',
      summary: 'No status output'
    });
  });

  it('cancels the abstract device-auth process without command runner calls', async () => {
    const process = new StubCodexDeviceAuthProcess(deviceOutput);
    const runner = new StubProviderCommandRunner((input) => Promise.resolve(result(input)));
    const harness = new CodexDeviceAuthHarness({
      commandRunner: runner,
      processStarter: { start: () => Promise.resolve(process) }
    });

    await harness.cancelDeviceAuth(process);

    expect(process.cancelledWith).toBe('SIGTERM');
    expect(runner.calls).toEqual([]);
  });
});
