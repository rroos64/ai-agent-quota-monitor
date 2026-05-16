import { spawn, type ChildProcess } from 'node:child_process';
import type { AuthSession } from '../domain/index.js';
import type { ProviderCommandLogger, ProviderCommandRunner } from '../providers/index.js';
import {
  ClaudeCodeCliAuthStatusTransport,
  validateClaudeCodeAccountWithTransport,
  type ClaudeCodeAuthStatusTransport
} from '../providers/index.js';
import type { ProviderProfileStore } from '../storage/index.js';

export type ClaudeLoginStatus = {
  status: 'logged_in' | 'not_logged_in' | 'unknown';
  summary: string;
  authenticatedEmail: string | null;
  subscriptionType: string | null;
};

export type ClaudeAuthProcess = {
  output: string;
  cancel(signal?: NodeJS.Signals): void;
};

export type ClaudeAuthProcessStarter = {
  start(input: {
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
    shell: false;
  }): Promise<ClaudeAuthProcess>;
};

export type ClaudeAuthStartResult = {
  mode: 'claude_login';
  authMode: 'browser';
  enabled: false;
  claudeConfigDir: string;
  authSession: AuthSession;
  process: ClaudeAuthProcess;
  safeOutputSummary: string;
};

export class NodeClaudeAuthProcessStarter implements ClaudeAuthProcessStarter {
  start(input: {
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
    shell: false;
  }): Promise<ClaudeAuthProcess> {
    const child = spawn(input.command, input.args, {
      env: { ...process.env, ...input.env },
      shell: input.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (chunk: string): void => {
      output = `${output}${chunk}`.slice(-4_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    return Promise.resolve({
      get output() {
        return output;
      },
      cancel: (signal: NodeJS.Signals = 'SIGTERM') => terminateChild(child, signal)
    });
  }
}

export class ClaudeAuthService {
  constructor(
    private readonly options: {
      commandRunner: ProviderCommandRunner;
      processStarter: ClaudeAuthProcessStarter;
      providerProfileStore: ProviderProfileStore;
      logger: ProviderCommandLogger;
      authStatusTransport?: ClaudeCodeAuthStatusTransport;
    }
  ) {}

  async startBrowserLogin(input: { expectedEmail: string }): Promise<ClaudeAuthStartResult> {
    const email = input.expectedEmail.trim().toLowerCase();
    const claudeConfigDir = await this.options.providerProfileStore.ensureClaudeConfigDir(email);
    await this.options.providerProfileStore.installClaudeStatusLine(email);
    const now = new Date();
    const process = await this.options.processStarter.start({
      command: resolveClaudeCommand(),
      args: ['auth', 'login', '--claudeai', '--email', email],
      env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      shell: false
    });
    Object.defineProperty(process, 'toJSON', {
      value: () => ({ output: '[redacted]', cancel: '[function]' }),
      enumerable: false
    });

    await this.options.logger.info(
      'claude.auth.browser_start',
      'Started Claude browser login flow',
      {
        provider: 'claude-code',
        mode: 'claude_login',
        authMode: 'browser'
      }
    );

    return {
      mode: 'claude_login',
      authMode: 'browser',
      enabled: false,
      claudeConfigDir,
      authSession: {
        id: `claude-browser-login-${String(now.getTime())}`,
        provider: 'claude-code',
        expectedEmail: email,
        status: 'waiting',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        completedAt: null,
        authenticatedEmail: null,
        tokenRef: null,
        failureReason: null,
        userMessage: 'Complete Claude Code login in the browser opened by AIQM.'
      },
      process,
      safeOutputSummary: '[AIQM_CLAUDE_BROWSER_LOGIN_STARTED]'
    };
  }

  async checkStatus(claudeConfigDir: string, expectedEmail?: string): Promise<ClaudeLoginStatus> {
    try {
      const transport =
        this.options.authStatusTransport ??
        new ClaudeCodeCliAuthStatusTransport(this.options.commandRunner);
      const validation = await validateClaudeCodeAccountWithTransport(transport, {
        claudeConfigDir,
        expectedEmail: expectedEmail ?? 'unknown@example.test'
      });
      return {
        status: validation.matches || validation.actualEmail ? 'logged_in' : 'unknown',
        summary: validation.actualEmail
          ? 'Logged in with AIQM-managed Claude Code account'
          : 'Claude Code login status unknown',
        authenticatedEmail: validation.actualEmail,
        subscriptionType: validation.hint ?? null
      };
    } catch {
      return {
        status: 'not_logged_in',
        summary: 'Not logged in',
        authenticatedEmail: null,
        subscriptionType: null
      };
    }
  }

  cancel(process: ClaudeAuthProcess): Promise<void> {
    process.cancel('SIGTERM');
    return Promise.resolve();
  }
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill(signal);
  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 1_000).unref();
}

function resolveClaudeCommand(): string {
  return process.env.AIQM_CLAUDE_BIN ?? process.env.CLAUDE_BIN ?? 'claude';
}
