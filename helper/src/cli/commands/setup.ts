import React from 'react';
import { render } from 'ink';
import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';
import {
  SetupApp,
  buildSetupScreenModel,
  cancelClaudeAuthAction,
  cancelCodexAuthAction,
  formatSetupScreenModel,
  editAccountAction,
  exportCodexEvidenceAction,
  logoutAccountAction,
  pollClaudeAuthStatusAction,
  pollCodexAuthStatusAction,
  reloginClaudeAccountAction,
  reloginCodexAccountAction,
  signOutAccountAction,
  runCodexDiscoveryAction,
  startClaudeAuthAction,
  startCodexAuthAction,
  submitClaudeSetupAction,
  submitCodexSetupAction,
  submitFakeSetupAction
} from '../../tui/index.js';
import { addFakeAccount, printJson, type AccountAddInput } from './account-actions.js';

export type SetupCommandOptions = AccountAddInput & {
  poll?: boolean;
  json?: boolean;
};

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Configure AIQM accounts; interactive setup supports Codex')
    .option('--provider <provider>', 'provider id; non-interactive mode currently supports fake')
    .option('--email <email>', 'account email')
    .option('--scenario <scenario>', 'fake provider scenario', 'success')
    .option('--display-name <name>', 'optional display name')
    .option('--display-order <n>', 'display order')
    .option('--poll', 'poll immediately after adding the account')
    .option('--json', 'print setup result as JSON')
    .action(async (options: SetupCommandOptions) => {
      if (!options.provider && !options.email) {
        const services = createAppServices();
        const model = buildSetupScreenModel(
          await services.configStore.getAccounts(),
          services.paths,
          await services.providerCapabilitiesService.listWithCliAvailability()
        );
        if (options.json) {
          printJson({ interactive: true, implemented: true, model });
          return;
        }
        if (!process.stdin.isTTY) {
          console.log(formatSetupScreenModel(model));
          return;
        }
        const app = render(
          React.createElement(SetupApp, {
            model,
            onSubmit: (input) => submitFakeSetupAction(input, services),
            onCodexStart: (expectedEmail, authMode) =>
              startCodexAuthAction(expectedEmail, services, authMode),
            onCodexPoll: (codexHome) => pollCodexAuthStatusAction(codexHome, services),
            onCodexDiscover: (codexHome) => runCodexDiscoveryAction(codexHome, services),
            onCodexExport: (discovery) => exportCodexEvidenceAction(discovery, services),
            onCodexCancel: (process) => cancelCodexAuthAction(process, services),
            onCodexSubmit: (input) => submitCodexSetupAction(input, services),
            onClaudeStart: (expectedEmail) => startClaudeAuthAction(expectedEmail, services),
            onClaudePoll: (claudeConfigDir, expectedEmail) =>
              pollClaudeAuthStatusAction(claudeConfigDir, services, expectedEmail),
            onClaudeCancel: (process) => cancelClaudeAuthAction(process, services),
            onClaudeSubmit: (input) => submitClaudeSetupAction(input, services),
            onAccountLogout: (input) => logoutAccountAction(input, services),
            onAccountSignOut: (input) => signOutAccountAction(input, services),
            onCodexRelogin: (input) => reloginCodexAccountAction(input, services),
            onClaudeRelogin: (input) => reloginClaudeAccountAction(input, services),
            onAccountEdit: (input) => editAccountAction(input, services)
          })
        );
        await app.waitUntilExit();
        return;
      }

      if (!options.provider || !options.email) {
        throw new Error('Both --provider and --email are required for non-interactive setup');
      }

      const services = createAppServices();
      const add = await addFakeAccount(options, services);
      const poll = options.poll ? await services.pollingService.pollAll() : null;
      await services.logger.info('setup', 'Setup completed', {
        provider: add.account.provider,
        email: add.account.email,
        pollRequested: options.poll === true,
        pollSummary: poll
          ? {
              successes: poll.successes,
              failures: poll.failures,
              historyEntriesWritten: poll.historyEntriesWritten
            }
          : null
      });
      const result = {
        setup: true,
        add,
        poll
      };

      if (options.json) {
        printJson(result);
        return;
      }

      console.log(
        [
          `Setup complete for ${add.account.provider}:${add.account.email}`,
          poll
            ? `Poll complete: ${String(poll.successes)} success(es), ${String(poll.failures)} failure(s)`
            : 'Run `aiqm poll` to refresh quota state.'
        ].join('\n')
      );
    });
}
