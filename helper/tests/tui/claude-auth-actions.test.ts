// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppServices } from '../../src/app/index.js';
import { ClaudeAuthService } from '../../src/services/index.js';
import {
  cancelClaudeAuthAction,
  pollClaudeAuthStatusAction,
  startClaudeAuthAction,
  submitClaudeSetupAction
} from '../../src/tui/index.js';
import type { ConfiguredAccount, ProviderQuotaResult } from '../../src/domain/index.js';

function quota(account: ConfiguredAccount): ProviderQuotaResult {
  return {
    provider: 'claude-code',
    accountEmail: account.email,
    fetchedAt: '2026-05-14T12:00:00.000Z',
    status: 'fresh',
    windows: [
      {
        id: 'claude-code:5h',
        providerWindowName: '5-hour Claude Code limit',
        usedPercentage: 10,
        resetAt: null
      }
    ]
  };
}

async function makeServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-claude-auth-actions-'));
  const services = createAppServices({
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache')
  });
  const process = { output: 'Opening browser to sign in…', cancel: vi.fn() };
  const authStatusTransport = {
    readAuthStatus: vi.fn(() =>
      Promise.resolve({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        email: 'claude-user@example.test',
        subscriptionType: 'pro'
      })
    )
  };
  const starter = {
    start: vi.fn(() => Promise.resolve(process))
  };
  services.claudeAuthService = new ClaudeAuthService({
    commandRunner: { run: vi.fn() },
    processStarter: starter,
    providerProfileStore: services.providerProfileStore,
    logger: services.logger,
    authStatusTransport
  });
  return { services, starter, process, authStatusTransport };
}

// Traceability: BR-043 Claude browser-login action boundary and AIQM-owned profile setup.
describe('Claude auth TUI actions', () => {
  it('starts Claude browser login in an AIQM-owned config dir without exposing raw output', async () => {
    const { services, starter } = await makeServices();

    const started = await startClaudeAuthAction(' Claude-User@Example.TEST ', services);

    expect(started).toMatchObject({
      mode: 'claude_login',
      authMode: 'browser',
      enabled: false,
      label: 'AIQM Claude login started; save after login completes.',
      authSession: {
        provider: 'claude-code',
        expectedEmail: 'claude-user@example.test',
        status: 'waiting',
        tokenRef: null
      },
      safeOutputSummary: '[AIQM_CLAUDE_BROWSER_LOGIN_STARTED]'
    });
    expect(started.claudeConfigDir).toContain(
      'providers/claude-code/claude-user@example.test/claude-config'
    );
    expect(starter.start).toHaveBeenCalledWith({
      command: 'claude',
      args: ['auth', 'login', '--claudeai', '--email', 'claude-user@example.test'],
      env: { CLAUDE_CONFIG_DIR: started.claudeConfigDir },
      shell: false
    });
    expect(JSON.stringify(started)).not.toContain('Opening browser');
  });

  it('polls Claude auth status and cancels active login processes', async () => {
    const { services, process } = await makeServices();
    const started = await startClaudeAuthAction('claude-user@example.test', services);

    await expect(
      pollClaudeAuthStatusAction(started.claudeConfigDir, services, 'claude-user@example.test')
    ).resolves.toEqual({
      status: 'logged_in',
      summary: 'Logged in with AIQM-managed Claude Code account',
      authenticatedEmail: 'claude-user@example.test',
      subscriptionType: 'pro'
    });

    await cancelClaudeAuthAction(started.process, services);
    expect(process.cancel).toHaveBeenCalledWith('SIGTERM');
  });

  it('submits Claude setup through shared account add action', async () => {
    const { services } = await makeServices();
    const started = await startClaudeAuthAction('claude-user@example.test', services);
    const validateAccount = vi.fn(() =>
      Promise.resolve({
        matches: true,
        actualEmail: 'claude-user@example.test',
        canReadQuota: true
      })
    );
    const fetchQuota = vi.fn((account: ConfiguredAccount) => Promise.resolve(quota(account)));

    const result = await submitClaudeSetupAction(
      {
        email: 'claude-user@example.test',
        claudeConfigDir: started.claudeConfigDir,
        pollAfterAdd: false
      },
      services,
      { claudeAdapter: { validateAccount, fetchQuota } }
    );

    expect(result).toMatchObject({
      add: {
        added: true,
        account: { provider: 'claude-code', email: 'claude-user@example.test' },
        tokenRef: { provider: 'claude-code', accountId: 'claude-code:claude-user@example.test' }
      },
      poll: null
    });
  });
});
