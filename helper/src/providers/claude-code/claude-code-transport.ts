import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountValidationResult, ProviderQuotaResult } from '../../domain/index.js';
import {
  ProviderCommandError,
  ProviderUnavailableError,
  type ProviderCommandRunner
} from '../base/index.js';
import {
  parseClaudeCodeAuthStatusResponse,
  parseClaudeCodeQuotaResponse
} from './claude-code-parser.js';
import { readClaudeStatusLineSnapshot } from './claude-statusline-snapshot.js';

export type ClaudeCodeAuthStatusTransport = {
  readAuthStatus(claudeConfigDir: string): Promise<unknown>;
};

export type ClaudeCodeQuotaTransport = {
  readQuota(claudeConfigDir: string): Promise<unknown>;
};

export class ClaudeCodeCliAuthStatusTransport implements ClaudeCodeAuthStatusTransport {
  constructor(private readonly commandRunner: ProviderCommandRunner) {}

  async readAuthStatus(claudeConfigDir: string): Promise<unknown> {
    const result = await this.commandRunner.run({
      command: resolveClaudeCommand(),
      args: ['auth', 'status'],
      env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      timeoutMs: 5_000,
      shell: false,
      suppressLogging: true
    });
    return JSON.parse(result.stdout) as unknown;
  }
}

type ClaudeCredentialsFile = {
  claudeAiOauth?: {
    accessToken?: unknown;
  };
};

export class ClaudeCodeOAuthUsageTransport implements ClaudeCodeQuotaTransport {
  constructor(private readonly commandRunner?: ProviderCommandRunner) {}

  async readQuota(claudeConfigDir: string): Promise<unknown> {
    const token = await this.readAccessToken(claudeConfigDir);
    const first = await this.fetchUsage(token);
    if (first.status !== 401) return first.body;

    if (this.commandRunner) {
      await this.commandRunner.run({
        command: resolveClaudeCommand(),
        args: ['auth', 'status'],
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
        timeoutMs: 10_000,
        shell: false,
        suppressLogging: true
      });
      return (await this.fetchUsage(await this.readAccessToken(claudeConfigDir))).body;
    }

    throw new ProviderUnavailableError('Claude OAuth usage endpoint rejected the access token');
  }

  private async readAccessToken(claudeConfigDir: string): Promise<string> {
    let credentials: ClaudeCredentialsFile;
    try {
      credentials = JSON.parse(
        await readFile(join(claudeConfigDir, '.credentials.json'), 'utf8')
      ) as ClaudeCredentialsFile;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProviderUnavailableError('Claude OAuth credentials are unavailable');
      }
      throw error;
    }
    const token = credentials.claudeAiOauth?.accessToken;
    if (typeof token !== 'string' || token.trim() === '') {
      throw new ProviderUnavailableError('Claude OAuth access token is unavailable');
    }
    return token;
  }

  private async fetchUsage(accessToken: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { status: response.status, body: text.slice(0, 256) };
    }

    if (!response.ok) {
      if (response.status === 401) return { status: response.status, body };
      const notBefore = response.headers.get('not-before');
      const retryAfter = response.headers.get('retry-after');
      const stderrParts: string[] = [];
      if (notBefore) stderrParts.push(`not-before: ${notBefore}`);
      if (retryAfter) stderrParts.push(`retry-after: ${retryAfter}`);
      throw new ProviderCommandError(
        `Claude OAuth usage request failed: ${String(response.status)}`,
        {
          command: 'https://api.anthropic.com/api/oauth/usage',
          args: [],
          exitCode: response.status,
          signal: null,
          stdout: JSON.stringify(body),
          stderr: stderrParts.join('\n'),
          timedOut: false,
          durationMs: 0
        }
      );
    }

    return { status: response.status, body };
  }
}

export class ClaudeCodeStatusLineQuotaTransport implements ClaudeCodeQuotaTransport {
  async readQuota(claudeConfigDir: string): Promise<unknown> {
    try {
      return await readClaudeStatusLineSnapshot(join(claudeConfigDir, 'aiqm-quota-snapshot.json'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProviderUnavailableError(
          'Claude Code quota snapshot unavailable until Claude Code statusLine captures rate limits'
        );
      }
      throw error;
    }
  }
}

export class UnsupportedClaudeCodeQuotaTransport implements ClaudeCodeQuotaTransport {
  readQuota(): Promise<unknown> {
    return Promise.reject(
      new ProviderUnavailableError('Claude Code quota source has not been validated yet')
    );
  }
}

export class StubClaudeCodeAuthStatusTransport implements ClaudeCodeAuthStatusTransport {
  readonly calls: string[] = [];

  constructor(private readonly handler: (claudeConfigDir: string) => Promise<unknown>) {}

  async readAuthStatus(claudeConfigDir: string): Promise<unknown> {
    this.calls.push(claudeConfigDir);
    return this.handler(claudeConfigDir);
  }
}

export class StubClaudeCodeQuotaTransport implements ClaudeCodeQuotaTransport {
  readonly calls: string[] = [];

  constructor(private readonly handler: (claudeConfigDir: string) => Promise<unknown>) {}

  async readQuota(claudeConfigDir: string): Promise<unknown> {
    this.calls.push(claudeConfigDir);
    return this.handler(claudeConfigDir);
  }
}

export async function validateClaudeCodeAccountWithTransport(
  transport: ClaudeCodeAuthStatusTransport,
  input: { claudeConfigDir: string; expectedEmail: string }
): Promise<AccountValidationResult> {
  const response = await transport.readAuthStatus(input.claudeConfigDir);
  return parseClaudeCodeAuthStatusResponse(response, { expectedEmail: input.expectedEmail });
}

export async function fetchClaudeCodeQuotaWithTransport(
  transport: ClaudeCodeQuotaTransport,
  input: { claudeConfigDir: string; accountEmail: string; fetchedAt: string }
): Promise<ProviderQuotaResult> {
  const response = await transport.readQuota(input.claudeConfigDir);
  return parseClaudeCodeQuotaResponse(response, {
    accountEmail: input.accountEmail,
    fetchedAt: input.fetchedAt
  });
}

function resolveClaudeCommand(): string {
  return process.env.AIQM_CLAUDE_BIN ?? process.env.CLAUDE_BIN ?? 'claude';
}
