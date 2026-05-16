// Provenance: docs/test-traceability.md — Providers area
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { addClaudeAccount } from '../../src/cli/commands/account-actions.js';
import type { ConfiguredAccount, ProviderQuotaResult } from '../../src/domain/index.js';
import { createAppServices } from '../../src/app/index.js';

const now = '2026-05-14T12:00:00.000Z';

async function createClaudeConfigDir(root: string) {
  const dir = join(root, 'source-claude-config');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.claude.json'), '{}', 'utf8');
  return dir;
}

function quota(account: ConfiguredAccount): ProviderQuotaResult {
  return {
    provider: 'claude-code',
    accountEmail: account.email,
    fetchedAt: now,
    status: 'fresh',
    windows: [
      {
        id: 'claude-code:5h',
        providerWindowName: '5-hour Claude Code limit',
        usedPercentage: 25,
        resetAt: null
      }
    ]
  };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
}

// Traceability: BR-043 / BR-043-AC-002..004; AIQM-owned Claude config profile import boundary.
describe('Claude Code profile import', () => {
  it('imports Claude config into AIQM-owned storage before saving account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-claude-profile-import-'));
    const services = createAppServices({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    });
    const sourceClaudeConfigDir = await createClaudeConfigDir(root);
    const validateAccount = vi.fn(() =>
      Promise.resolve({
        provider: 'claude-code' as const,
        expectedEmail: 'dev@example.com',
        actualEmail: 'dev@example.com',
        matches: true,
        canReadQuota: true
      })
    );
    const fetchQuota = vi.fn((account: ConfiguredAccount) => Promise.resolve(quota(account)));

    const result = await addClaudeAccount(
      { provider: 'claude-code', email: 'dev@example.com', claudeConfigDir: sourceClaudeConfigDir },
      services,
      { claudeAdapter: { validateAccount, fetchQuota } }
    );

    const persistentClaudeConfigDir =
      services.providerProfileStore.claudeConfigDir('dev@example.com');
    expect(result.account.providerConfig?.claudeConfigDir).toBe(persistentClaudeConfigDir);
    expect(result.account.providerConfig?.claudeConfigDir).not.toBe(sourceClaudeConfigDir);
    expect(await readFile(join(persistentClaudeConfigDir, '.claude.json'), 'utf8')).toBe('{}');
    expect(validateAccount).toHaveBeenCalledWith(
      { provider: 'claude-code', accountId: 'claude-code:dev@example.com' },
      'dev@example.com'
    );
    expect(fetchQuota.mock.calls[0]?.[0].providerConfig?.claudeConfigDir).toBe(
      persistentClaudeConfigDir
    );
    expect(JSON.stringify(result)).not.toContain(sourceClaudeConfigDir);
  });

  it('rejects Claude config sources containing symlinks without installing a destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-claude-profile-import-'));
    const services = createAppServices({
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache')
    });
    const sourceClaudeConfigDir = await createClaudeConfigDir(root);
    await symlink(join(root, 'outside-secret'), join(sourceClaudeConfigDir, 'outside-link'));
    const persistentClaudeConfigDir =
      services.providerProfileStore.claudeConfigDir('dev@example.com');

    await expect(
      addClaudeAccount(
        {
          provider: 'claude-code',
          email: 'dev@example.com',
          claudeConfigDir: sourceClaudeConfigDir
        },
        services,
        {
          claudeAdapter: {
            validateAccount: vi.fn(),
            fetchQuota: vi.fn()
          }
        }
      )
    ).rejects.toThrow('Claude config dir source must not contain symlinks');
    await expect(pathExists(persistentClaudeConfigDir)).resolves.toBe(false);
  });
});
