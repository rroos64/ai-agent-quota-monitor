// Provenance: docs/test-traceability.md — Setup/TUI area
import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import { resolveAppPaths } from '../../src/storage/index.js';
import type { ProviderCapability } from '../../src/services/index.js';
import { buildSetupScreenModel, formatSetupScreenModel } from '../../src/tui/index.js';

const now = '2026-05-09T12:00:00.000Z';

function account(email: string, displayOrder: number): ConfiguredAccount {
  return {
    id: `fake:${email}`,
    provider: 'fake',
    email,
    displayOrder,
    providerConfig: { scenario: 'success' },
    createdAt: now,
    updatedAt: now
  };
}

const cliAwareProviders: ProviderCapability[] = [
  {
    provider: 'fake',
    displayName: 'Fake',
    implemented: true,
    usable: true,
    status: 'usable',
    requirement: 'Local fake provider; no external credentials required.',
    blockReason: null,
    cliAvailability: {
      status: 'not_checked',
      command: null,
      args: [],
      shell: false,
      timeoutMs: null,
      version: null,
      errorType: null
    }
  },
  {
    provider: 'codex',
    displayName: 'Codex',
    implemented: false,
    usable: false,
    status: 'spike_required',
    requirement: 'Codex quota-source spike is required before implementation.',
    blockReason: 'Codex quota-source spike is required before implementation.',
    cliAvailability: {
      status: 'available',
      command: 'codex',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      version: 'codex 0.1.0',
      errorType: null
    }
  },
  {
    provider: 'claude-code',
    displayName: 'Claude Code',
    implemented: false,
    usable: false,
    status: 'spike_required',
    requirement: 'Claude Code provider spike is required before implementation.',
    blockReason: 'Claude Code provider spike is required before implementation.',
    cliAvailability: {
      status: 'missing',
      command: 'claude',
      args: ['--version'],
      shell: false,
      timeoutMs: 1_000,
      version: null,
      errorType: 'ProviderCommandNotFoundError'
    }
  }
];

// Traceability: BR: setup UX without exposing secrets; AC: TUI screen model shows account count, paths, accounts, provider requirements/blocking, CLI availability, and non-interactive add instructions; TS: TSD setup/TUI boundary and AUTH-STORE-001 capabilities.
describe('setup screen model', () => {
  it('builds a safe setup shell model from services data', () => {
    const paths = resolveAppPaths({ dataDir: '/tmp/aiqm-data', cacheDir: '/tmp/aiqm-cache' });

    const model = buildSetupScreenModel(
      [account('b@example.com', 2), account('a@example.com', 1)],
      paths,
      cliAwareProviders
    );

    expect(model).toMatchObject({
      title: 'AI Agent Quota Monitor Setup',
      accountCount: 2,
      paths: {
        dataDir: '/tmp/aiqm-data',
        cacheDir: '/tmp/aiqm-cache',
        latestStateFile: '/tmp/aiqm-data/latest.json'
      }
    });
    expect(model.accounts.map((item) => item.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(model.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'fake', usable: true }),
        expect.objectContaining({ provider: 'codex', usable: false, status: 'spike_required' }),
        expect.objectContaining({
          provider: 'claude-code',
          usable: false,
          status: 'spike_required'
        })
      ])
    );
    expect(model.instructions.join('\n')).toContain(
      'aiqm setup --provider fake --email <email> --scenario success --poll'
    );
    expect(model.instructions.join('\n')).toContain(
      'Use r/refresh to force-refresh the selected account'
    );
    expect(model.instructions.join('\n')).toContain('h/refres(h)-all');
    expect(model.instructions.join('\n')).toContain('refresh-all');
    expect(model.instructions.join('\n')).toContain('rate limit');
    expect(JSON.stringify(model)).not.toContain('tokenPayload');
    expect(JSON.stringify(model)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
    expect(formatSetupScreenModel(model)).toContain('AI Agent Quota Monitor Setup');
    expect(formatSetupScreenModel(model)).toContain('fake:a@example.com order=1');
    expect(formatSetupScreenModel(model)).toContain('Codex: blocked');
    expect(formatSetupScreenModel(model)).toContain('CLI codex: available (codex 0.1.0)');
    expect(formatSetupScreenModel(model)).toContain('CLI claude: missing');
    expect(formatSetupScreenModel(model)).toContain(
      'Use r/refresh to force-refresh the selected account'
    );
    expect(formatSetupScreenModel(model)).toContain('h/refres(h)-all');
    expect(formatSetupScreenModel(model)).toContain('refresh-all');
  });
});
