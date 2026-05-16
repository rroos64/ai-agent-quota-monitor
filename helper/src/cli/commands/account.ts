import type { Command } from 'commander';
import { normalizeEmail } from '../../domain/index.js';
import { createAppServices } from '../../app/index.js';
import {
  addClaudeAccount,
  addCodexAccount,
  addFakeAccount,
  migrateCodexProfiles,
  parseProvider,
  printJson,
  type AccountAddInput
} from './account-actions.js';

type AccountListOptions = {
  json?: boolean;
};

type AccountAddOptions = AccountAddInput & {
  json?: boolean;
};

type AccountDeleteOptions = {
  provider: string;
  email: string;
  json?: boolean;
};

export function registerAccountCommand(program: Command): void {
  const account = program.command('account').description('Manage configured provider accounts');

  account
    .command('list')
    .description('List configured accounts')
    .option('--json', 'print accounts as JSON')
    .action(async (options: AccountListOptions) => {
      const { configStore } = createAppServices();
      const accounts = await configStore.getAccounts();

      if (options.json) {
        printJson({ accounts });
        return;
      }

      console.log(`AIQM accounts: ${String(accounts.length)} configured`);
    });

  account
    .command('add')
    .description('Add a provider account')
    .requiredOption('--provider <provider>', 'provider id; fake, codex, or claude-code')
    .requiredOption('--email <email>', 'account email')
    .option('--scenario <scenario>', 'fake provider scenario', 'success')
    .option('--display-name <name>', 'optional display name')
    .option('--display-order <n>', 'display order')
    .option('--codex-home <path>', 'isolated CODEX_HOME for Codex provider')
    .option('--claude-config-dir <path>', 'isolated CLAUDE_CONFIG_DIR for Claude Code provider')
    .option('--json', 'print result as JSON')
    .action(async (options: AccountAddOptions) => {
      const result =
        options.provider === 'codex'
          ? await addCodexAccount(options)
          : options.provider === 'claude-code'
            ? await addClaudeAccount(options)
            : await addFakeAccount(options);

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(`Added account ${result.account.provider}:${result.account.email}`);
    });

  account
    .command('migrate-codex-profiles')
    .description('Copy configured Codex homes into persistent app-owned provider profile storage')
    .option('--json', 'print result as JSON')
    .action(async (options: { json?: boolean }) => {
      const result = await migrateCodexProfiles(createAppServices());

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(
        `Migrated ${String(result.migrated.length)} Codex profile(s); skipped ${String(result.skipped.length)}.`
      );
    });

  account
    .command('delete')
    .description('Delete a configured fake provider account')
    .requiredOption('--provider <provider>', 'provider id; only fake is supported in this MVP')
    .requiredOption('--email <email>', 'account email')
    .option('--json', 'print result as JSON')
    .action(async (options: AccountDeleteOptions) => {
      const provider = parseProvider(options.provider);
      const email = normalizeEmail(options.email);
      const { configStore, logger, tokenStore } = createAppServices();
      const existing = await configStore.getAccountByProviderEmail(provider, email);
      const deletedAccount = existing ? await configStore.deleteAccount(existing.id) : false;
      const deletedToken = await tokenStore.deleteTokenByProviderEmail(provider, email);
      const result = { deleted: deletedAccount, deletedToken, provider, email };
      await logger.info('account.delete', 'Account delete requested', result);

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(
        deletedAccount
          ? `Deleted account ${provider}:${email}`
          : `Account not found ${provider}:${email}`
      );
    });
}
