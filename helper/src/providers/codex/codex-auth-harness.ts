import { spawn } from 'node:child_process';
import { redactSecrets } from '../../diagnostics/index.js';
import type { AuthSession } from '../../domain/index.js';
import {
  ProviderCommandError,
  type Clock,
  type ProviderCommandInput,
  type ProviderCommandLogger,
  type ProviderCommandRunner
} from '../base/index.js';
import { systemClock } from '../base/types.js';
import { CODEX_PROVIDER_ID } from './codex-provider-adapter.js';

export type CodexDeviceAuthInstructions = {
  verificationUrl: string;
  userCode: string;
};

export type CodexDeviceAuthStatus = 'logged_in' | 'not_logged_in' | 'unknown';

export type CodexLoginStatus = {
  status: CodexDeviceAuthStatus;
  summary: string;
};

export type CodexDeviceAuthProcess = {
  readonly output: string;
  cancel(signal?: NodeJS.Signals): Promise<void> | void;
};

export interface CodexDeviceAuthProcessStarter {
  start(input: ProviderCommandInput): Promise<CodexDeviceAuthProcess>;
}

export type CodexDeviceAuthSession = {
  authSession: AuthSession;
  instructions: CodexDeviceAuthInstructions;
  process: CodexDeviceAuthProcess;
};

export type CodexBrowserAuthSession = {
  authSession: AuthSession;
  process: CodexDeviceAuthProcess;
  safeOutputSummary: string;
};

export type CodexDeviceAuthHarnessOptions = {
  commandRunner: ProviderCommandRunner;
  processStarter: CodexDeviceAuthProcessStarter;
  logger?: ProviderCommandLogger;
  clock?: Clock;
};

export type CodexDeviceAuthStartInput = {
  codexHome: string;
  expectedEmail: string;
  sessionId?: string;
};

const statusTimeoutMs = 5_000;
const redactedDeviceAuthOutputSummary = '[REDACTED_CODEX_DEVICE_AUTH_OUTPUT]';
const deviceAuthStartTimeoutMs = 30_000;
const redactedBrowserLoginOutputSummary = '[REDACTED_CODEX_BROWSER_LOGIN_OUTPUT]';

function safeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(metadata) as Record<string, unknown>;
}

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern, '');
}

function isCodeLike(value: string): boolean {
  if (!/^[A-Z0-9]+(?:[- ][A-Z0-9]+)*$/u.test(value)) return false;
  const compact = value.replace(/[- ]/gu, '');
  if (compact.length < 6 || compact.length > 24) return false;
  if (!/[0-9]/u.test(compact)) return false;
  if (!/[A-Z]/u.test(compact)) return false;
  return !new Set(['THIS', 'CODE', 'ENTER', 'DEVICE', 'AUTH']).has(compact);
}

function cleanCode(value: string): string | null {
  const candidate = value
    .trim()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/giu, '')
    .toUpperCase();
  return isCodeLike(candidate) ? candidate : null;
}

function parseCodeFromLines(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const inline =
      /(?:^|[^\w])(?:user\s+code|one-time\s+code|code)\s*[:=]\s*([A-Z0-9][A-Z0-9- ]{4,})/iu.exec(
        line
      )?.[1] ??
      /(?:^|[^\w])enter\s+(?:the\s+)?code\s+([A-Z0-9][A-Z0-9- ]{4,})/iu.exec(line)?.[1] ??
      null;
    if (inline) {
      const code = cleanCode(inline);
      if (code) return code;
    }

    if (/enter\s+this\s+one-time\s+code|one-time\s+code/iu.test(line)) {
      for (const nextLine of lines.slice(index + 1)) {
        if (!nextLine.trim()) continue;
        const code = cleanCode(nextLine);
        if (code) return code;
        break;
      }
    }
  }
  return null;
}

export function parseCodexDeviceAuthOutput(output: string): CodexDeviceAuthInstructions | null {
  const normalized = stripAnsi(output);
  const verificationUrl = /https?:\/\/[^\s)>'"]+/iu.exec(normalized)?.[0] ?? null;
  const userCode = parseCodeFromLines(normalized.split(/\r?\n/u));

  if (!verificationUrl || !userCode) return null;
  return { verificationUrl, userCode };
}

export function parseCodexLoginStatusOutput(
  output: string,
  exitCode: number | null
): CodexLoginStatus {
  const normalized = output.trim();
  if (/not\s+logged\s+in|not\s+authenticated|login\s+required/iu.test(normalized)) {
    return { status: 'not_logged_in', summary: 'Not logged in' };
  }
  if (/logged\s+in|authenticated|signed\s+in/iu.test(normalized) && exitCode === 0) {
    return { status: 'logged_in', summary: 'Logged in' };
  }
  return { status: 'unknown', summary: normalized ? 'Unknown login status' : 'No status output' };
}

export class NodeCodexDeviceAuthProcessStarter implements CodexDeviceAuthProcessStarter {
  start(input: ProviderCommandInput): Promise<CodexDeviceAuthProcess> {
    return new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      const child = spawn(input.command, input.args ?? [], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: input.shell ?? false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('Codex device-auth instructions were not available before timeout'));
      }, input.timeoutMs ?? deviceAuthStartTimeoutMs);
      const maybeResolve = (): void => {
        if (settled || !parseCodexDeviceAuthOutput(output)) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          output,
          cancel: (signal: NodeJS.Signals = 'SIGTERM') => {
            child.kill(signal);
          }
        });
      };
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        maybeResolve();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        maybeResolve();
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Codex device-auth process exited before instructions were available'));
      });
    });
  }
}

export class NodeCodexBrowserLoginProcessStarter implements CodexDeviceAuthProcessStarter {
  start(input: ProviderCommandInput): Promise<CodexDeviceAuthProcess> {
    let output = '';
    const child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      shell: input.shell ?? false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    return Promise.resolve({
      get output() {
        return output;
      },
      cancel: (signal: NodeJS.Signals = 'SIGTERM') => {
        child.kill(signal);
      }
    });
  }
}

export class CodexDeviceAuthHarness {
  private readonly clock: Clock;

  constructor(private readonly options: CodexDeviceAuthHarnessOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async startDeviceAuth(input: CodexDeviceAuthStartInput): Promise<CodexDeviceAuthSession> {
    const process = await this.options.processStarter.start({
      command: 'codex',
      args: ['login', '--device-auth'],
      env: { CODEX_HOME: input.codexHome },
      shell: false,
      timeoutMs: deviceAuthStartTimeoutMs
    });
    const instructions = parseCodexDeviceAuthOutput(process.output);
    if (!instructions) {
      throw new ProviderCommandError('Codex device-auth instructions were not found', {
        command: 'codex',
        args: ['login', '--device-auth'],
        exitCode: null,
        signal: null,
        stdout: redactedDeviceAuthOutputSummary,
        stderr: '',
        timedOut: false,
        durationMs: 0
      });
    }

    const now = this.clock.now();
    const authSession: AuthSession = {
      id: input.sessionId ?? `codex-device-auth-${String(now.getTime())}`,
      provider: CODEX_PROVIDER_ID,
      expectedEmail: input.expectedEmail,
      status: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      completedAt: null,
      authenticatedEmail: null,
      tokenRef: null,
      failureReason: null,
      userMessage: 'Open the verification URL and enter the user code to complete Codex login.'
    };

    await this.options.logger?.info(
      'codex.device_auth.start',
      'Codex device-auth instructions parsed',
      safeMetadata({
        provider: CODEX_PROVIDER_ID,
        sessionId: authSession.id,
        verificationUrl: instructions.verificationUrl,
        userCode: instructions.userCode
      })
    );

    return { authSession, instructions, process };
  }

  async startBrowserLogin(input: CodexDeviceAuthStartInput): Promise<CodexBrowserAuthSession> {
    const process = await this.options.processStarter.start({
      command: 'codex',
      args: ['login'],
      env: { CODEX_HOME: input.codexHome },
      shell: false
    });
    const now = this.clock.now();
    const authSession: AuthSession = {
      id: input.sessionId ?? `codex-browser-login-${String(now.getTime())}`,
      provider: CODEX_PROVIDER_ID,
      expectedEmail: input.expectedEmail,
      status: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      completedAt: null,
      authenticatedEmail: null,
      tokenRef: null,
      failureReason: null,
      userMessage: 'Complete the Codex browser login, then poll login status.'
    };

    await this.options.logger?.info(
      'codex.browser_login.start',
      'Codex browser login process started',
      safeMetadata({
        provider: CODEX_PROVIDER_ID,
        sessionId: authSession.id,
        output: redactedBrowserLoginOutputSummary
      })
    );

    return {
      authSession,
      process,
      safeOutputSummary: redactedBrowserLoginOutputSummary
    };
  }

  async cancelDeviceAuth(process: CodexDeviceAuthProcess): Promise<void> {
    await process.cancel('SIGTERM');
    await this.options.logger?.info(
      'codex.device_auth.cancel',
      'Codex device-auth process cancellation requested',
      { provider: CODEX_PROVIDER_ID }
    );
  }

  async checkLoginStatus(codexHome: string): Promise<CodexLoginStatus> {
    try {
      const result = await this.options.commandRunner.run({
        command: 'codex',
        args: ['login', 'status'],
        env: { CODEX_HOME: codexHome },
        timeoutMs: statusTimeoutMs,
        shell: false,
        suppressLogging: true
      });
      return parseCodexLoginStatusOutput(`${result.stdout}\n${result.stderr}`, result.exitCode);
    } catch (error) {
      if (error instanceof ProviderCommandError) {
        return parseCodexLoginStatusOutput(
          `${error.result.stdout}\n${error.result.stderr}`,
          error.result.exitCode
        );
      }
      return { status: 'unknown', summary: 'Unable to determine login status' };
    }
  }
}
