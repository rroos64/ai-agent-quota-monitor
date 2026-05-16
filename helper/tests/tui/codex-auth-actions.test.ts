// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppServices } from '../../src/app/index.js';
import {
  CodexAuthService,
  ProviderCapabilitiesService,
  type CodexAuthStartResult,
  type CodexPostLoginDiscoveryResult
} from '../../src/services/index.js';
import { ProviderProfileStore, resolveAppPaths } from '../../src/storage/index.js';
import {
  cancelCodexAuthAction,
  exportCodexEvidenceAction,
  pollCodexAuthStatusAction,
  runCodexDiscoveryAction,
  startCodexAuthAction
} from '../../src/tui/index.js';
import {
  CodexDeviceAuthHarness,
  ProviderCommandError,
  StubProviderCommandRunner,
  type CodexDeviceAuthProcess,
  type ProviderCommandInput,
  type ProviderCommandResult
} from '../../src/providers/index.js';

const deviceOutput = ['Open https://auth.openai.example/device', 'Enter code: ABCD-1234'].join(
  '\n'
);

function result(
  input: ProviderCommandInput,
  overrides: Partial<ProviderCommandResult> = {}
): ProviderCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    exitCode: 0,
    signal: null,
    stdout: 'Logged in\n',
    stderr: '',
    timedOut: false,
    durationMs: 1,
    ...overrides
  };
}

class StubProcess implements CodexDeviceAuthProcess {
  cancelledWith: NodeJS.Signals | undefined;

  constructor(readonly output: string = deviceOutput) {}

  cancel(signal?: NodeJS.Signals): void {
    this.cancelledWith = signal;
  }
}

async function makeServices(process = new StubProcess()) {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-codex-auth-actions-'));
  const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
  const logged: unknown[] = [];
  const runner = new StubProviderCommandRunner((input) => {
    if (
      input.args?.join(' ') === 'login status' &&
      input.env?.CODEX_HOME?.includes('codex-empty-home-')
    ) {
      return Promise.reject(
        new ProviderCommandError(
          'not logged in',
          result(input, { exitCode: 1, stdout: 'Not logged in\n' })
        )
      );
    }
    if (input.args?.includes('--help')) {
      return Promise.resolve(
        result(input, {
          stdout:
            'Codex CLI help commands: exec review login debug features https://auth.openai.example/secret?token=SECRET_SENTINEL_DO_NOT_LEAK\nUsage: codex [OPTIONS]\n'
        })
      );
    }
    if (input.args?.join(' ') === 'login status') {
      return Promise.resolve(
        result(input, {
          stdout: 'Logged in as codex-user@example.test with SECRET_SENTINEL_DO_NOT_LEAK\n'
        })
      );
    }
    return Promise.resolve(result(input));
  });
  const service = new CodexAuthService({
    paths,
    deviceHarness: new CodexDeviceAuthHarness({
      commandRunner: runner,
      processStarter: {
        start: (input) => {
          expect(input).toMatchObject({
            command: 'codex',
            args: ['login', '--device-auth'],
            env: { CODEX_HOME: join(paths.cacheDir, 'codex-login-home') },
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
    }),
    browserHarness: new CodexDeviceAuthHarness({
      commandRunner: runner,
      processStarter: {
        start: (input) => {
          expect(input).toMatchObject({
            command: 'codex',
            args: ['login'],
            env: { CODEX_HOME: join(paths.cacheDir, 'codex-login-home') },
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
    }),
    commandRunner: runner,
    providerCapabilitiesService: new ProviderCapabilitiesService(),
    providerProfileStore: new ProviderProfileStore(paths),
    logger: {
      info: (_event, _message, metadata) => {
        logged.push(metadata);
        return Promise.resolve();
      }
    }
  });

  return {
    services: { codexAuthService: service } as AppServices,
    logged,
    runner,
    process,
    paths
  };
}

// Traceability: BR:  real-provider auth must be spike-gated and safe; AC: TUI action layer starts Codex device-auth/browser auth, displays safe instructions/state, polls status, cancels, does not save accounts or leak URL/code in logs, and leaves Codex blocked; TS: CODEX-AUTH-TUI-001 and CODEX-BROWSER-AUTH-HARNESS-001.
describe('Codex  auth TUI actions', () => {
  it('starts Codex device auth and returns displayable login instructions', async () => {
    const { services, logged, paths } = await makeServices();

    const started = await startCodexAuthAction(' Codex-User@Example.TEST ', services, 'device');

    expect(started).toMatchObject({
      mode: 'codex_login',
      enabled: false,
      label: 'AIQM Codex login completed; save to add the account.',
      codexHome: join(paths.cacheDir, 'codex-login-home'),
      authSession: {
        provider: 'codex',
        expectedEmail: 'codex-user@example.test',
        status: 'waiting',
        tokenRef: null
      },
      instructions: {
        verificationUrl: 'https://auth.openai.example/device',
        userCode: 'ABCD-1234'
      }
    } satisfies Partial<CodexAuthStartResult> & { label: string });
    expect(JSON.stringify(logged)).not.toContain('ABCD-1234');
    expect(JSON.stringify(logged)).not.toContain('https://auth.openai.example/device');
  });

  it('starts Codex browser login and returns safe login state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-codex-browser-action-'));
    const codexHome = join(
      root,
      'data',
      'providers',
      'codex',
      'codex-user@example.test',
      'codex-home'
    );
    const services = {
      codexAuthService: {
        startBrowserLogin: () =>
          Promise.resolve({
            mode: 'codex_login' as const,
            authMode: 'browser' as const,
            enabled: false as const,
            codexHome,
            authSession: {
              id: 'session',
              provider: 'codex' as const,
              expectedEmail: 'codex-user@example.test',
              status: 'succeeded' as const,
              createdAt: '2026-05-13T00:00:00.000Z',
              expiresAt: '2026-05-13T00:15:00.000Z',
              completedAt: '2026-05-13T00:00:01.000Z',
              authenticatedEmail: 'codex-user@example.test',
              tokenRef: null,
              failureReason: null,
              userMessage: null
            },
            instructions: null,
            process: { output: '', cancel: () => undefined },
            safeOutputSummary: '[AIQM_CODEX_BROWSER_LOGIN_COMPLETE]',
            files: []
          })
      }
    } as AppServices;

    const started = await startCodexAuthAction('codex-user@example.test', services, 'browser');

    expect(started).toMatchObject({
      mode: 'codex_login',
      authMode: 'browser',
      enabled: false,
      label: 'AIQM Codex login completed; save to add the account.',
      codexHome,
      instructions: null,
      safeOutputSummary: '[AIQM_CODEX_BROWSER_LOGIN_COMPLETE]',
      authSession: {
        provider: 'codex',
        expectedEmail: 'codex-user@example.test',
        status: 'succeeded',
        tokenRef: null
      }
    } satisfies Partial<CodexAuthStartResult> & { label: string });
  });

  it('polls logged-in and not-logged-in status from AIQM-managed profile data', async () => {
    const { services, paths } = await makeServices();
    const codexHome = join(paths.cacheDir, 'codex-login-home');
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'redacted-access',
          refresh_token: 'redacted-refresh',
          account_id: 'account-redacted'
        }
      })
    );

    await expect(pollCodexAuthStatusAction(codexHome, services)).resolves.toEqual({
      status: 'logged_in',
      summary: 'Logged in with AIQM-managed Codex account'
    });

    await expect(
      pollCodexAuthStatusAction(join(paths.cacheDir, 'missing-codex-home'), services)
    ).resolves.toEqual({ status: 'not_logged_in', summary: 'Not logged in' });
  });

  it('runs post-login passive discovery without raw output storage', async () => {
    const { services, runner, paths } = await makeServices();
    const codexHome = join(paths.cacheDir, 'codex-login-home');

    await mkdir(join(codexHome, 'memories'), { recursive: true });
    await writeFile(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'redacted-access',
          refresh_token: 'redacted-refresh',
          account_id: 'account-redacted'
        }
      })
    );
    await writeFile(join(codexHome, 'config.toml'), 'redacted fixture placeholder');

    const discovery = await runCodexDiscoveryAction(codexHome, services);

    expect(discovery).toMatchObject({
      mode: 'codex_login',
      provider: 'codex',
      codexHome,
      loginStatus: { status: 'logged_in' },
      emptyHomeStatus: { status: 'not_logged_in' }
    });
    expect(discovery.probes.map((probe) => probe.args.join(' '))).toEqual([
      '--help',
      'login --help',
      'login status',
      'status --help',
      'debug --help',
      'features --help'
    ]);
    expect(discovery.discoveredCommands).toEqual(
      expect.arrayContaining(['exec', 'review', 'login', 'debug', 'features'])
    );
    expect(discovery.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'config.toml', type: 'file' }),
        expect.objectContaining({ path: 'memories', type: 'directory' })
      ])
    );
    expect(discovery.probes.every((probe) => probe.summary.length > 0)).toBe(true);
    expect(discovery.probes.map((probe) => probe.classification)).toEqual([
      'passive_only',
      'passive_only',
      'unsupported',
      'passive_only',
      'passive_only',
      'passive_only'
    ]);
    expect(discovery.probes.every((probe) => probe.passive && !probe.opensAgentSession)).toBe(true);
    expect(discovery.probes.every((probe) => probe.unsafeReason === null)).toBe(true);
    expect(
      runner.calls.every(
        (call) => call.command === 'codex' && call.shell === false && call.suppressLogging === true
      )
    ).toBe(true);
    expect(runner.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: ['--help'], env: { CODEX_HOME: codexHome } }),
        expect.objectContaining({ args: ['login', 'status'], env: { CODEX_HOME: codexHome } })
      ])
    );
    expect(JSON.stringify(discovery)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(JSON.stringify(discovery)).not.toContain('codex-user@example.test');
    expect(JSON.stringify(discovery)).not.toContain('https://auth.openai.example/secret');
    expect(
      discovery.probes.find((probe) => probe.args.join(' ') === 'login status')?.summary
    ).toContain('[REDACTED_EMAIL]');
  });

  it('exports redacted passive discovery evidence to a safe JSON file', async () => {
    const { services, paths } = await makeServices();
    const discovery: CodexPostLoginDiscoveryResult = {
      mode: 'codex_login',
      provider: 'codex',
      codexHome: join(paths.cacheDir, 'codex-login-home'),
      loginStatus: { status: 'logged_in', summary: 'Logged in as codex-user@example.test' },
      emptyHomeStatus: { status: 'not_logged_in', summary: 'Not logged in' },
      files: [
        { path: 'auth.json', type: 'file', mode: '0600' },
        {
          path: 'profiles/codex-user@example.test/auth-token-sk-1234567890abcdef.json',
          type: 'file',
          mode: '0600'
        },
        { path: 'session_SECRET_SENTINEL_DO_NOT_LEAK/cache', type: 'directory', mode: '0700' },
        { path: 'memories', type: 'directory', mode: '0700' }
      ],
      probes: [
        {
          command: 'codex',
          args: ['login', 'status'],
          classification: 'unsupported',
          exitCode: 0,
          summary:
            'Logged in as codex-user@example.test https://auth.openai.example/secret SECRET_SENTINEL_DO_NOT_LEAK',
          passive: true,
          opensAgentSession: false,
          quotaDataFound: false,
          unsafeReason: null
        }
      ],
      discoveredCommands: ['login', 'debug', 'features']
    };
    const outputPath = join(paths.dataDir, 'diagnostics', 'custom-codex-evidence.redacted.json');

    const exported = await exportCodexEvidenceAction(discovery, services, outputPath);
    const written = await readFile(outputPath, 'utf8');

    expect(exported.path).toBe(outputPath);
    expect(exported.evidence).toMatchObject({
      schemaVersion: '1',
      provider: 'codex',
      mode: 'codex_login',
      loginStatus: 'logged_in',
      emptyHomeStatus: 'not_logged_in',
      safety: {
        rawStdoutStored: false,
        rawStderrStored: false,
        tokenContentsStored: false,
        urlsRedacted: true,
        emailsRedacted: true
      }
    });
    expect(typeof exported.evidence.cliVersion).toBe('string');
    expect(JSON.parse(written)).toMatchObject(exported.evidence);
    expect(written).toContain('[REDACTED_EMAIL]');
    expect(written).not.toContain('codex-user@example.test');
    expect(written).not.toContain('auth-token-sk-1234567890abcdef');
    expect(written).not.toContain('session_SECRET_SENTINEL_DO_NOT_LEAK');
    expect(written).not.toContain('https://auth.openai.example/secret');
    expect(written).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(written).toContain('[REDACTED_EMAIL]');
    expect(written).toContain('[REDACTED_PATH_SEGMENT]');
    expect(written).not.toContain('codex-login-home');
  });

  it('cancels Codex auth without saving or enabling Codex', async () => {
    const { services, process } = await makeServices();

    await cancelCodexAuthAction(process, services);

    expect(process.cancelledWith).toBe('SIGTERM');
    expect(new ProviderCapabilitiesService().get('codex')).toMatchObject({
      usable: true,
      status: 'usable'
    });
  });
});
