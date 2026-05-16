import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServices, type AppServices } from '../../app/index.js';
import {
  accountIdFor,
  normalizeEmail,
  type ConfiguredAccount,
  type ProviderId,
  type ProviderQuotaResult
} from '../../domain/index.js';
import {
  ClaudeCodeProviderAdapter,
  CodexProviderAdapter,
  type FakeProviderScenario
} from '../../providers/index.js';
const fakeScenarios = new Set<string>([
  'success',
  'multi_window',
  'auth_required',
  'offline',
  'provider_error',
  'malformed',
  'email_mismatch'
]);

export type AccountAddInput = {
  provider: string;
  email: string;
  scenario?: string;
  displayName?: string;
  displayOrder?: string;
  codexHome?: string;
  claudeConfigDir?: string;
};

export type AccountAddResult = {
  added: true;
  account: ConfiguredAccount;
  tokenRef: {
    accountId: string;
    provider: ProviderId;
  };
};

export type CodexAccountActionDependencies = {
  codexAdapter?: { fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult> };
};

export type ClaudeAccountActionDependencies = {
  claudeAdapter?: {
    validateAccount(
      tokenRef: { provider: 'claude-code'; accountId: string },
      expectedEmail: string
    ): Promise<{
      matches: boolean;
      actualEmail: string | null;
      canReadQuota: boolean;
      hint?: string | null;
    }>;
    fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;
  };
};

export type CodexProfileMigrationResult = {
  migrated: { accountId: string; email: string; codexHome: string }[];
  skipped: { accountId: string; email: string; reason: string }[];
};

export function parseProvider(provider: string): ProviderId {
  if (provider !== 'fake' && provider !== 'codex' && provider !== 'claude-code') {
    throw new Error(`Unsupported provider for account add/delete: ${provider}`);
  }
  return provider;
}

export function parseFakeScenario(scenario: string | undefined): FakeProviderScenario {
  const value = scenario ?? 'success';
  if (!fakeScenarios.has(value)) {
    throw new Error(`Unsupported fake provider scenario: ${value}`);
  }
  return value as FakeProviderScenario;
}

export function parseDisplayOrder(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Display order must be a non-negative integer: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Display order must be a non-negative integer: ${value}`);
  }
  return parsed;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function addFakeAccount(
  input: AccountAddInput,
  services: AppServices = createAppServices()
): Promise<AccountAddResult> {
  const provider = parseProvider(input.provider);
  if (provider !== 'fake') throw new Error('addFakeAccount only supports fake');
  const scenario = parseFakeScenario(input.scenario);
  const email = normalizeEmail(input.email);
  const { configStore, setupFlowService } = services;
  const existingAccounts = await configStore.getAccounts();
  const existing = await configStore.getAccountByProviderEmail(provider, email);
  if (existing) {
    throw new Error(`Account already configured: ${provider}:${email}`);
  }

  return setupFlowService.addFakeAccount({
    provider,
    email,
    scenario,
    displayName: input.displayName,
    displayOrder: parseDisplayOrder(input.displayOrder, existingAccounts.length)
  });
}

export async function addCodexAccount(
  input: AccountAddInput,
  services: AppServices = createAppServices(),
  dependencies: CodexAccountActionDependencies = {}
): Promise<AccountAddResult> {
  const provider = parseProvider(input.provider);
  if (provider !== 'codex') throw new Error('addCodexAccount only supports codex');
  if (!input.codexHome) throw new Error('--codex-home is required for Codex accounts');

  const email = normalizeEmail(input.email);
  const existingAccounts = await services.configStore.getAccounts();
  const existing = await services.configStore.getAccountByProviderEmail(provider, email);
  if (existing) throw new Error(`Account already configured: ${provider}:${email}`);

  await assertManagedCodexHomeLoggedIn(input.codexHome);

  const targetCodexHome = services.providerProfileStore.codexHomeDir(email);
  const persistentCodexHome =
    resolve(input.codexHome) === resolve(targetCodexHome)
      ? targetCodexHome
      : await services.providerProfileStore.importCodexHome(email, input.codexHome);

  const now = new Date().toISOString();
  const account: ConfiguredAccount = {
    id: accountIdFor(provider, email),
    provider,
    email,
    displayOrder: parseDisplayOrder(input.displayOrder, existingAccounts.length),
    providerConfig: {
      codexHome: persistentCodexHome,
      ...(input.displayName ? { displayName: input.displayName } : {})
    },
    createdAt: now,
    updatedAt: now
  };

  const adapter = dependencies.codexAdapter ?? new CodexProviderAdapter();
  const quota = await adapter.fetchQuota(account);
  if (quota.windows.length === 0) throw new Error('Codex quota unreadable during setup');

  await services.configStore.addAccount(account);
  await services.providerProfileStore.saveMetadata({
    schemaVersion: '1',
    provider,
    email,
    createdAt: now,
    updatedAt: now,
    displayName: input.displayName,
    metadata: { codexHomeConfigured: true, quotaWindowCount: quota.windows.length }
  });

  return { added: true, account, tokenRef: { provider, accountId: account.id } };
}

async function assertManagedCodexHomeLoggedIn(codexHome: string): Promise<void> {
  const raw = await readFile(resolve(codexHome, 'auth.json'), 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const tokens = parsed.tokens;
  if (!tokens || typeof tokens !== 'object') throw new Error('Codex login is not complete');
  const record = tokens as Record<string, unknown>;
  if (
    typeof record.access_token !== 'string' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.account_id !== 'string'
  ) {
    throw new Error('Codex login is not complete');
  }
}

export async function addClaudeAccount(
  input: AccountAddInput,
  services: AppServices = createAppServices(),
  dependencies: ClaudeAccountActionDependencies = {}
): Promise<AccountAddResult> {
  const provider = parseProvider(input.provider);
  if (provider !== 'claude-code') throw new Error('addClaudeAccount only supports claude-code');
  if (!input.claudeConfigDir) {
    throw new Error('--claude-config-dir is required for Claude Code accounts');
  }

  const email = normalizeEmail(input.email);
  const existingAccounts = await services.configStore.getAccounts();
  const existing = await services.configStore.getAccountByProviderEmail(provider, email);
  if (existing) throw new Error(`Account already configured: ${provider}:${email}`);

  const targetClaudeConfigDir = services.providerProfileStore.claudeConfigDir(email);
  const persistentClaudeConfigDir =
    resolve(input.claudeConfigDir) === resolve(targetClaudeConfigDir)
      ? targetClaudeConfigDir
      : await services.providerProfileStore.importClaudeConfigDir(email, input.claudeConfigDir);

  const now = new Date().toISOString();
  const account: ConfiguredAccount = {
    id: accountIdFor(provider, email),
    provider,
    email,
    displayOrder: parseDisplayOrder(input.displayOrder, existingAccounts.length),
    providerConfig: {
      claudeConfigDir: persistentClaudeConfigDir,
      ...(input.displayName ? { displayName: input.displayName } : {})
    },
    createdAt: now,
    updatedAt: now
  };

  const adapter =
    dependencies.claudeAdapter ??
    new ClaudeCodeProviderAdapter(undefined, undefined, {
      claudeConfigDir: persistentClaudeConfigDir
    });
  const validation = await adapter.validateAccount(
    { provider: 'claude-code', accountId: account.id },
    email
  );
  if (!validation.matches) {
    throw new Error(
      `Claude Code authenticated email does not match expected email: ${validation.actualEmail ?? 'unknown'}`
    );
  }

  try {
    await adapter.fetchQuota(account);
  } catch {
    // Claude Code quota is passive: the first snapshot appears only after Claude Code
    // invokes AIQM through statusLine. Account setup may proceed once auth is valid.
  }
  await services.providerProfileStore.installClaudeStatusLine(email);

  await services.configStore.addAccount(account);
  await services.providerProfileStore.saveMetadata({
    schemaVersion: '1',
    provider,
    email,
    createdAt: now,
    updatedAt: now,
    displayName: input.displayName,
    metadata: {
      claudeConfigDirConfigured: true,
      authStatusValidated: true,
      statusLineInstalled: true
    }
  });

  return { added: true, account, tokenRef: { provider, accountId: account.id } };
}

export async function migrateCodexProfiles(
  services: AppServices = createAppServices()
): Promise<CodexProfileMigrationResult> {
  const accounts = await services.configStore.getAccounts();
  const result: CodexProfileMigrationResult = { migrated: [], skipped: [] };

  for (const account of accounts) {
    if (account.provider !== 'codex') continue;
    const codexHome = account.providerConfig?.codexHome;
    if (typeof codexHome !== 'string' || !codexHome) {
      result.skipped.push({
        accountId: account.id,
        email: account.email,
        reason: 'missing codexHome'
      });
      continue;
    }

    const persistentCodexHome = services.providerProfileStore.codexHomeDir(account.email);
    if (codexHome === persistentCodexHome) {
      result.skipped.push({
        accountId: account.id,
        email: account.email,
        reason: 'already persistent'
      });
      continue;
    }

    const importedCodexHome = await services.providerProfileStore.importCodexHome(
      account.email,
      codexHome
    );
    await services.configStore.updateAccount(account.id, {
      providerConfig: { ...account.providerConfig, codexHome: importedCodexHome }
    });
    result.migrated.push({
      accountId: account.id,
      email: account.email,
      codexHome: importedCodexHome
    });
  }

  return result;
}
