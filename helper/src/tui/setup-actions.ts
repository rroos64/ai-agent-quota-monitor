import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppServices } from '../app/index.js';
import { isProviderId, type ConfiguredAccount } from '../domain/index.js';
import {
  addClaudeAccount,
  addCodexAccount,
  parseFakeScenario,
  type AccountAddResult,
  type ClaudeAccountActionDependencies,
  type CodexAccountActionDependencies
} from '../cli/commands/account-actions.js';
import type {
  ClaudeAuthStartResult,
  ClaudeLoginStatus,
  CodexAuthMode,
  CodexEvidenceExportResult,
  CodexAuthStartResult,
  CodexPostLoginDiscoveryResult,
  FakeSetupFlowEvent,
  PollSummary
} from '../services/index.js';
import type { CodexDeviceAuthProcess, CodexLoginStatus } from '../providers/index.js';

export const FAKE_SETUP_SCENARIOS = [
  'success',
  'multi_window',
  'auth_required',
  'offline',
  'provider_error',
  'malformed',
  'email_mismatch'
] as const;

export type FakeSetupScenario = (typeof FAKE_SETUP_SCENARIOS)[number];

export type FakeSetupInput = {
  email: string;
  scenario: FakeSetupScenario;
  pollAfterAdd: boolean;
  authOutcome?: 'success' | 'failure' | 'expired' | 'cancelled';
  authActualEmail?: string;
};

export type FakeSetupActionResult = {
  add: AccountAddResult;
  poll: PollSummary | null;
  events?: FakeSetupFlowEvent[];
};

export type FakeSetupActionProgress = (event: FakeSetupFlowEvent) => void;

export type CodexSetupInput = {
  email: string;
  displayName?: string;
  codexHome: string;
  pollAfterAdd: boolean;
};

export type CodexSetupActionResult = {
  add: AccountAddResult;
  poll: PollSummary | null;
};

export type ClaudeSetupInput = {
  email: string;
  displayName?: string;
  claudeConfigDir: string;
  pollAfterAdd: boolean;
};

export type ClaudeSetupActionResult = {
  add: AccountAddResult;
  poll: PollSummary | null;
};

export type CodexAuthActionResult = Omit<CodexAuthStartResult, 'process'> & {
  process: CodexDeviceAuthProcess;
  label: 'AIQM Codex login completed; save to add the account.';
};

export type ClaudeAuthActionResult = ClaudeAuthStartResult & {
  label: 'AIQM Claude login started; save after login completes.';
};

export type AccountLogoutInput = {
  provider: string;
  email: string;
};

export type AccountEditInput = {
  provider: string;
  email: string;
  displayName?: string;
  displayOrder?: number;
};

export type CodexReloginInput = {
  email: string;
  codexHome: string;
};

export type ClaudeReloginInput = {
  email: string;
  claudeConfigDir: string;
};

export type AccountLogoutActionResult = {
  provider: string;
  email: string;
  deletedAccount: boolean;
  deletedToken: boolean;
  deletedProfile: boolean;
  poll: PollSummary | null;
};

export type AccountEditActionResult = {
  provider: string;
  email: string;
  displayName?: string;
  displayOrder: number;
  accounts: { provider: string; email: string; displayOrder: number; displayName?: string }[];
  poll: PollSummary | null;
};

export type CodexReloginActionResult = AccountEditActionResult;
export type ClaudeReloginActionResult = AccountEditActionResult;

export function isValidSetupEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function startCodexAuthAction(
  expectedEmail: string,
  services: AppServices,
  authMode: CodexAuthMode = 'browser'
): Promise<CodexAuthActionResult> {
  const email = expectedEmail.trim().toLowerCase();
  if (!isValidSetupEmail(email)) {
    throw new Error(`Invalid email address: ${expectedEmail}`);
  }
  const started =
    authMode === 'browser'
      ? await services.codexAuthService.startBrowserLogin({ expectedEmail: email })
      : await services.codexAuthService.startDeviceAuth({ expectedEmail: email });
  return {
    ...started,
    label: 'AIQM Codex login completed; save to add the account.'
  };
}

export function pollCodexAuthStatusAction(
  codexHome: string,
  services: AppServices
): Promise<CodexLoginStatus> {
  return services.codexAuthService.checkStatus(codexHome);
}

export async function startClaudeAuthAction(
  expectedEmail: string,
  services: AppServices
): Promise<ClaudeAuthActionResult> {
  const email = expectedEmail.trim().toLowerCase();
  if (!isValidSetupEmail(email)) {
    throw new Error(`Invalid email address: ${expectedEmail}`);
  }
  const started = await services.claudeAuthService.startBrowserLogin({ expectedEmail: email });
  return {
    ...started,
    label: 'AIQM Claude login started; save after login completes.'
  };
}

export function pollClaudeAuthStatusAction(
  claudeConfigDir: string,
  services: AppServices,
  expectedEmail?: string
): Promise<ClaudeLoginStatus> {
  return services.claudeAuthService.checkStatus(claudeConfigDir, expectedEmail);
}

export function cancelClaudeAuthAction(
  process: ClaudeAuthActionResult['process'],
  services: AppServices
): Promise<void> {
  return services.claudeAuthService.cancel(process);
}

export function runCodexDiscoveryAction(
  codexHome: string,
  services: AppServices
): Promise<CodexPostLoginDiscoveryResult> {
  return services.codexAuthService.runPostLoginDiscovery(codexHome);
}

export function exportCodexEvidenceAction(
  discovery: CodexPostLoginDiscoveryResult,
  services: AppServices,
  outputPath?: string
): Promise<CodexEvidenceExportResult> {
  return services.codexAuthService.exportDiscoveryEvidence(discovery, outputPath);
}

export function cancelCodexAuthAction(
  process: CodexDeviceAuthProcess,
  services: AppServices
): Promise<void> {
  return services.codexAuthService.cancel(process);
}

export async function submitCodexSetupAction(
  input: CodexSetupInput,
  services: AppServices,
  dependencies: CodexAccountActionDependencies = {}
): Promise<CodexSetupActionResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidSetupEmail(email)) {
    throw new Error(`Invalid email address: ${input.email}`);
  }

  const status = await services.codexAuthService.checkStatus(input.codexHome);
  if (status.status !== 'logged_in') {
    throw new Error(`Codex login is not complete: ${status.status}`);
  }

  const add = await addCodexAccount(
    {
      provider: 'codex',
      email,
      codexHome: input.codexHome,
      displayName: input.displayName,
      displayOrder: String((await services.configStore.getAccounts()).length)
    },
    services,
    dependencies
  );
  const poll = input.pollAfterAdd ? await services.pollingService.pollAll() : null;

  await services.logger.info('setup.tui.codex.add', 'Interactive Codex account setup completed', {
    provider: add.account.provider,
    email: add.account.email,
    pollRequested: input.pollAfterAdd,
    pollSummary: poll
      ? {
          successes: poll.successes,
          failures: poll.failures,
          historyEntriesWritten: poll.historyEntriesWritten
        }
      : null
  });

  return { add, poll };
}

export async function submitClaudeSetupAction(
  input: ClaudeSetupInput,
  services: AppServices,
  dependencies: ClaudeAccountActionDependencies = {}
): Promise<ClaudeSetupActionResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidSetupEmail(email)) {
    throw new Error(`Invalid email address: ${input.email}`);
  }

  const status = await services.claudeAuthService.checkStatus(input.claudeConfigDir, email);
  if (status.status !== 'logged_in') {
    throw new Error(`Claude Code login is not complete: ${status.status}`);
  }

  const add = await addClaudeAccount(
    {
      provider: 'claude-code',
      email,
      claudeConfigDir: input.claudeConfigDir,
      displayName: input.displayName,
      displayOrder: String((await services.configStore.getAccounts()).length)
    },
    services,
    dependencies
  );
  const poll = input.pollAfterAdd ? await services.pollingService.pollAll() : null;

  await services.logger.info('setup.tui.claude.add', 'Interactive Claude account setup completed', {
    provider: add.account.provider,
    email: add.account.email,
    pollRequested: input.pollAfterAdd,
    pollSummary: poll
      ? {
          successes: poll.successes,
          failures: poll.failures,
          historyEntriesWritten: poll.historyEntriesWritten
        }
      : null
  });

  return { add, poll };
}

function accountList(accounts: ConfiguredAccount[]): AccountEditActionResult['accounts'] {
  return accounts.map((account) => ({
    provider: account.provider,
    email: account.email,
    displayOrder: account.displayOrder,
    displayName:
      typeof account.providerConfig?.displayName === 'string'
        ? account.providerConfig.displayName
        : undefined
  }));
}

export async function editAccountAction(
  input: AccountEditInput,
  services: AppServices
): Promise<AccountEditActionResult> {
  if (!isProviderId(input.provider)) {
    throw new Error(`Unsupported provider: ${input.provider}`);
  }
  const provider = input.provider;
  const email = input.email.trim().toLowerCase();
  const existing = await services.configStore.getAccountByProviderEmail(provider, email);
  if (!existing) throw new Error(`Account not found: ${provider}:${email}`);

  const displayName = input.displayName?.trim();
  const providerConfig = { ...(existing.providerConfig ?? {}) };
  if (displayName !== undefined) {
    if (displayName.length > 0) providerConfig.displayName = displayName;
    else delete providerConfig.displayName;
  }

  const config = await services.configStore.load();
  const updatedAccount = {
    ...existing,
    providerConfig,
    updatedAt: new Date().toISOString()
  };
  const orderedAccounts = [...config.accounts].sort((left, right) => {
    if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const otherAccounts = orderedAccounts.filter((account) => account.id !== existing.id);
  const targetIndex = Math.max(
    0,
    Math.min(input.displayOrder ?? existing.displayOrder, otherAccounts.length)
  );
  otherAccounts.splice(targetIndex, 0, updatedAccount);
  const accounts = otherAccounts.map((account, index) => ({
    ...account,
    displayOrder: index,
    updatedAt: account.id === existing.id ? updatedAccount.updatedAt : account.updatedAt
  }));
  await services.configStore.save({ ...config, accounts });
  const updated = accounts.find((account) => account.id === existing.id) ?? updatedAccount;
  const metadata = await services.providerProfileStore.loadMetadata(provider, email);
  if (metadata) {
    await services.providerProfileStore.saveMetadata({
      ...metadata,
      updatedAt: new Date().toISOString(),
      ...(displayName ? { displayName } : {})
    });
  }
  const poll = null;
  await services.logger.info('setup.tui.account.edit', 'Interactive account edit completed', {
    provider,
    email,
    displayOrder: updated.displayOrder,
    displayName: displayName ?? null
  });
  const updatedDisplayName =
    typeof updated.providerConfig?.displayName === 'string'
      ? updated.providerConfig.displayName
      : undefined;
  return {
    provider,
    email,
    displayName: updatedDisplayName,
    displayOrder: updated.displayOrder,
    accounts: accountList(accounts),
    poll
  };
}

export async function reloginCodexAccountAction(
  input: CodexReloginInput,
  services: AppServices
): Promise<CodexReloginActionResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await services.configStore.getAccountByProviderEmail('codex', email);
  if (!existing) throw new Error(`Account not found: codex:${email}`);

  const status = await services.codexAuthService.checkStatus(input.codexHome);
  if (status.status !== 'logged_in') {
    throw new Error(`Codex login is not complete: ${status.status}`);
  }

  const providerConfig = { ...(existing.providerConfig ?? {}), codexHome: input.codexHome };
  const nextConfig = await services.configStore.updateAccount(existing.id, { providerConfig });
  const updated = nextConfig.accounts.find((account) => account.id === existing.id) ?? existing;
  const poll = await services.pollingService.pollAll();
  const polledAccount = poll.accounts.find((account) => account.accountId === existing.id);
  if (!polledAccount?.success) {
    throw new Error(polledAccount?.errorHint ?? 'Codex quota unreadable after re-login');
  }

  await services.logger.info('setup.tui.codex.relogin', 'Interactive Codex re-login completed', {
    provider: 'codex',
    email
  });

  const displayName =
    typeof updated.providerConfig?.displayName === 'string'
      ? updated.providerConfig.displayName
      : undefined;
  return {
    provider: 'codex',
    email,
    displayName,
    displayOrder: updated.displayOrder,
    accounts: accountList(nextConfig.accounts),
    poll
  };
}

export async function reloginClaudeAccountAction(
  input: ClaudeReloginInput,
  services: AppServices
): Promise<ClaudeReloginActionResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await services.configStore.getAccountByProviderEmail('claude-code', email);
  if (!existing) throw new Error(`Account not found: claude-code:${email}`);

  const status = await services.claudeAuthService.checkStatus(input.claudeConfigDir, email);
  if (status.status !== 'logged_in') {
    throw new Error(`Claude Code login is not complete: ${status.status}`);
  }

  const poll = await services.pollingService.pollAll();

  await services.logger.info('setup.tui.claude.relogin', 'Interactive Claude re-login completed', {
    provider: 'claude-code',
    email
  });

  const accounts = await services.configStore.getAccounts();
  const updated = accounts.find((a) => a.id === existing.id) ?? existing;
  const displayName =
    typeof updated.providerConfig?.displayName === 'string'
      ? updated.providerConfig.displayName
      : undefined;
  return {
    provider: 'claude-code',
    email,
    displayName,
    displayOrder: updated.displayOrder,
    accounts: accountList(accounts),
    poll
  };
}

export async function signOutAccountAction(
  input: AccountLogoutInput,
  services: AppServices
): Promise<AccountLogoutActionResult> {
  if (!isProviderId(input.provider)) {
    throw new Error(`Unsupported provider: ${input.provider}`);
  }
  const provider = input.provider;
  const email = input.email.trim().toLowerCase();
  const existing = await services.configStore.getAccountByProviderEmail(provider, email);
  if (!existing) throw new Error(`Account not found: ${provider}:${email}`);
  const codexHome =
    typeof existing.providerConfig?.codexHome === 'string'
      ? existing.providerConfig.codexHome
      : provider === 'codex'
        ? services.providerProfileStore.codexHomeDir(email)
        : null;
  if (codexHome) await rm(join(codexHome, 'auth.json'), { force: true });
  const deletedToken = await services.tokenStore.deleteTokenByProviderEmail(provider, email);
  const poll = await services.pollingService.pollAll();
  await services.logger.info(
    'setup.tui.account.signout',
    'Interactive account sign-out completed',
    {
      provider,
      email,
      deletedToken
    }
  );
  return { provider, email, deletedAccount: false, deletedToken, deletedProfile: false, poll };
}

export async function logoutAccountAction(
  input: AccountLogoutInput,
  services: AppServices
): Promise<AccountLogoutActionResult> {
  if (!isProviderId(input.provider)) {
    throw new Error(`Unsupported provider: ${input.provider}`);
  }
  const provider = input.provider;
  const email = input.email.trim().toLowerCase();
  const existing = await services.configStore.getAccountByProviderEmail(provider, email);
  const deletedAccount = existing ? await services.configStore.deleteAccount(existing.id) : false;
  const deletedToken = await services.tokenStore.deleteTokenByProviderEmail(provider, email);
  let deletedProfile = false;
  try {
    await services.providerProfileStore.deleteProfile(provider, email);
    deletedProfile = true;
  } catch {
    deletedProfile = false;
  }
  const poll = await services.pollingService.pollAll();
  await services.logger.info('setup.tui.account.logout', 'Interactive account logout completed', {
    provider,
    email,
    deletedAccount,
    deletedToken,
    deletedProfile
  });
  return { provider, email, deletedAccount, deletedToken, deletedProfile, poll };
}

export async function submitFakeSetupAction(
  input: FakeSetupInput,
  services: AppServices,
  onProgress?: FakeSetupActionProgress
): Promise<FakeSetupActionResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidSetupEmail(email)) {
    throw new Error(`Invalid email address: ${input.email}`);
  }

  const events: FakeSetupFlowEvent[] = [];
  const emit = (event: FakeSetupFlowEvent) => {
    events.push(event);
    onProgress?.(event);
  };
  const existingAccounts = await services.configStore.getAccounts();
  const existing = await services.configStore.getAccountByProviderEmail('fake', email);
  if (existing) {
    throw new Error(`Account already configured: fake:${email}`);
  }

  const add = await services.setupFlowService.runInteractiveFakeAccountSetup(
    {
      provider: 'fake',
      email,
      scenario: parseFakeScenario(input.scenario),
      displayOrder: existingAccounts.length,
      pollAfterAdd: input.pollAfterAdd,
      authOutcome: input.authOutcome,
      authActualEmail: input.authActualEmail
    },
    emit
  );
  const poll = input.pollAfterAdd ? await services.pollingService.pollAll() : null;

  await services.logger.info('setup.tui.add', 'Interactive fake account setup completed', {
    provider: add.account.provider,
    email: add.account.email,
    scenario: input.scenario,
    pollRequested: input.pollAfterAdd,
    pollSummary: poll
      ? {
          successes: poll.successes,
          failures: poll.failures,
          historyEntriesWritten: poll.historyEntriesWritten
        }
      : null
  });

  return { add, poll, events };
}
