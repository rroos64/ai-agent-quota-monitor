// Provenance: docs/test-traceability.md — Providers area
import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import {
  AntigravityProviderAdapter,
  ClaudeCodeProviderAdapter,
  CodexProviderAdapter,
  ProviderNotImplementedError,
  ProviderSpikeRequiredError,
  StubProviderCommandRunner
} from '../../src/providers/index.js';
import { ProviderCapabilitiesService } from '../../src/services/index.js';

const now = '2026-05-09T12:00:00.000Z';

const codexAccount: ConfiguredAccount = {
  id: 'codex:dev@example.com',
  provider: 'codex',
  email: 'dev@example.com',
  displayOrder: 1,
  createdAt: now,
  updatedAt: now
};

const claudeAccount: ConfiguredAccount = {
  id: 'claude-code:dev@example.com',
  provider: 'claude-code',
  email: 'dev@example.com',
  displayOrder: 2,
  createdAt: now,
  updatedAt: now
};

function commandRunner(): StubProviderCommandRunner {
  return new StubProviderCommandRunner((input) =>
    Promise.reject(new Error(`Command runner must not be called: ${input.command}`))
  );
}

// Traceability: BR: future provider boundaries without accidental enablement; AC: Codex/Claude skeleton ids/names are exported, unsafe operations reject safely, command runner is never invoked, and capabilities remain blocked; TS: PROVIDER-SKELETON-001 disabled real-provider adapter shells.
describe('provider skeleton adapters', () => {
  it('exports Codex and Claude Code ids and names without enabling operations', () => {
    const codex = new CodexProviderAdapter();
    const claude = new ClaudeCodeProviderAdapter();

    expect(codex).toMatchObject({ providerId: 'codex', providerName: 'Codex' });
    expect(claude).toMatchObject({ providerId: 'claude-code', providerName: 'Claude Code' });
    expect(codex.authSessions).toBeDefined();
    expect(claude.authSessions).toBeDefined();
  });

  it('keeps Codex auth/setup operations spike-required and requires codexHome for quota', async () => {
    const runner = commandRunner();
    const adapter = new CodexProviderAdapter(runner);

    await expect(
      adapter.authenticate({
        provider: 'codex',
        expectedEmail: codexAccount.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    await expect(adapter.fetchQuota(codexAccount)).rejects.toMatchObject({
      status: 'config_error'
    });
    expect(runner.calls).toEqual([]);
  });

  it('keeps Claude Code setup/auth spike-required and live quota blocked until source validation', async () => {
    const runner = commandRunner();
    const adapter = new ClaudeCodeProviderAdapter(runner);

    await expect(
      adapter.authenticate({
        provider: 'claude-code',
        expectedEmail: claudeAccount.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    await expect(adapter.fetchQuota(claudeAccount)).rejects.toMatchObject({
      status: 'config_error'
    });
    await expect(
      adapter.authSessions.startAuthSession({
        provider: 'claude-code',
        expectedEmail: claudeAccount.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderSpikeRequiredError);
    expect(runner.calls).toEqual([]);
  });

  it('keeps future provider capabilities blocked independently of exported skeletons', () => {
    const service = new ProviderCapabilitiesService();

    expect(service.get('codex')).toMatchObject({
      implemented: true,
      usable: true,
      status: 'usable',
      cliAvailability: { status: 'not_checked', command: 'codex' }
    });
    expect(service.get('claude-code')).toMatchObject({
      implemented: false,
      usable: false,
      status: 'spike_required',
      cliAvailability: { status: 'not_checked', command: 'claude' }
    });
  });

  it('Antigravity adapter exports correct id/name and rejects all operations as not-implemented (BACK-001)', async () => {
    const adapter = new AntigravityProviderAdapter();
    const now = '2026-05-09T12:00:00.000Z';
    const account: ConfiguredAccount = {
      id: 'antigravity:test@example.com',
      provider: 'antigravity',
      email: 'test@example.com',
      displayOrder: 0,
      createdAt: now,
      updatedAt: now
    };

    expect(adapter).toMatchObject({ providerId: 'antigravity', providerName: 'Antigravity' });

    await expect(
      adapter.authenticate({
        provider: 'antigravity',
        expectedEmail: account.email,
        interactive: false
      })
    ).rejects.toBeInstanceOf(ProviderNotImplementedError);
    await expect(adapter.fetchQuota(account)).rejects.toBeInstanceOf(ProviderNotImplementedError);
  });

  it('keeps Antigravity capabilities blocked in the capabilities service (BACK-001)', () => {
    const service = new ProviderCapabilitiesService();

    expect(service.get('antigravity')).toMatchObject({
      implemented: false,
      usable: false,
      status: 'not_implemented'
    });
  });

  it('exposes safe typed errors for spike-required and not-implemented provider paths', () => {
    const spike = new ProviderSpikeRequiredError('Codex provider spike is required');
    const notImplemented = new ProviderNotImplementedError('Provider is not implemented');

    expect(spike).toMatchObject({ name: 'ProviderSpikeRequiredError', status: 'provider_error' });
    expect(notImplemented).toMatchObject({
      name: 'ProviderNotImplementedError',
      status: 'provider_error'
    });
    expect(JSON.stringify({ spike, notImplemented })).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
