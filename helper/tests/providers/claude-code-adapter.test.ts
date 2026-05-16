// Provenance: docs/test-traceability.md — Providers area
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import {
  ClaudeCodeProviderAdapter,
  ConfigError,
  ProviderSpikeRequiredError,
  ProviderUnavailableError,
  StubClaudeCodeAuthStatusTransport,
  StubProviderCommandRunner,
  StubClaudeCodeQuotaTransport
} from '../../src/providers/index.js';

const now = '2026-05-14T12:00:00.000Z';
const account: ConfiguredAccount = {
  id: 'claude-code:claude-user@example.test',
  provider: 'claude-code',
  email: 'claude-user@example.test',
  displayOrder: 0,
  providerConfig: { claudeConfigDir: '/tmp/aiqm-claude-profile' },
  createdAt: now,
  updatedAt: now
};

const clock = { now: () => new Date(now), nowIso: () => now };

function fixture(name: string): unknown {
  const path = resolve(process.cwd(), `../fixtures/providers/claude-code/${name}`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// Traceability: BR-043 / BR-043-AC-002..004; TSD CLAUDE-PARSER-001 and Claude provider boundary.
describe('Claude Code adapter boundary', () => {
  it('keeps auth/session setup spike-required while quota transport is being validated', async () => {
    const adapter = new ClaudeCodeProviderAdapter();

    await expect(
      adapter.authenticate({
        provider: 'claude-code',
        expectedEmail: account.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    await expect(
      adapter.authSessions.startAuthSession({
        provider: 'claude-code',
        expectedEmail: account.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
  });

  it('requires an AIQM-owned Claude config directory for polling', async () => {
    const adapter = new ClaudeCodeProviderAdapter(undefined, clock);
    await expect(adapter.fetchQuota({ ...account, providerConfig: {} })).rejects.toBeInstanceOf(
      ConfigError
    );
  });

  it('defaults auth validation to claude auth status with the configured profile', async () => {
    const runner = new StubProviderCommandRunner((input) =>
      Promise.resolve({
        command: input.command,
        args: input.args ?? [],
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify(fixture('auth-status.redacted.example.json')),
        stderr: '',
        timedOut: false,
        durationMs: 5
      })
    );
    const adapter = new ClaudeCodeProviderAdapter(runner, clock, {
      claudeConfigDir: '/tmp/aiqm-claude-profile'
    });

    await expect(
      adapter.validateAccount({ provider: 'claude-code', accountId: account.id }, account.email)
    ).resolves.toMatchObject({ provider: 'claude-code', matches: true, canReadQuota: true });
    expect(runner.calls).toMatchObject([
      {
        command: 'claude',
        args: ['auth', 'status'],
        env: { CLAUDE_CONFIG_DIR: '/tmp/aiqm-claude-profile' },
        suppressLogging: true
      }
    ]);
  });

  it('validates auth status through a stubbed safe transport', async () => {
    const authStatusTransport = new StubClaudeCodeAuthStatusTransport(() =>
      Promise.resolve(fixture('auth-status.redacted.example.json'))
    );
    const adapter = new ClaudeCodeProviderAdapter(undefined, clock, {
      authStatusTransport,
      claudeConfigDir: '/tmp/aiqm-claude-profile'
    });

    await expect(
      adapter.validateAccount({ provider: 'claude-code', accountId: account.id }, account.email)
    ).resolves.toMatchObject({ provider: 'claude-code', matches: true, canReadQuota: true });
    expect(authStatusTransport.calls).toEqual(['/tmp/aiqm-claude-profile']);
  });

  it('normalizes quota through an injected read-only transport', async () => {
    const quotaTransport = new StubClaudeCodeQuotaTransport(() =>
      Promise.resolve(fixture('quota-success.redacted.example.json'))
    );
    const adapter = new ClaudeCodeProviderAdapter(undefined, clock, { quotaTransport });

    await expect(adapter.fetchQuota(account)).resolves.toMatchObject({
      provider: 'claude-code',
      accountEmail: account.email,
      fetchedAt: now,
      status: 'fresh',
      windows: [
        { id: 'claude-code:5h', providerWindowName: '5-hour Claude Code limit' },
        { id: 'claude-code:weekly', providerWindowName: 'Weekly Claude Code limit' }
      ]
    });
    expect(quotaTransport.calls).toEqual(['/tmp/aiqm-claude-profile']);
  });

  it('fails safely when Claude OAuth credentials are unavailable', async () => {
    const adapter = new ClaudeCodeProviderAdapter(undefined, clock);
    await expect(adapter.fetchQuota(account)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
