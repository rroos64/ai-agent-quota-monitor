import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';

export type StatusCommandOptions = {
  json?: boolean;
};

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show the latest normalized quota state')
    .option('--json', 'print latest state as JSON')
    .action(async (options: StatusCommandOptions) => {
      const { latestStateStore } = createAppServices();
      const state = await latestStateStore.load();

      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }

      if (state.accounts.length === 0) {
        console.log(
          'AIQM status: no accounts in latest state. Run `aiqm setup --provider fake --email <email> --poll`.'
        );
        return;
      }

      const lines = state.accounts.map(
        (account) =>
          `${account.provider}:${account.email} ${account.status} (${String(account.windows.length)} window(s))`
      );
      console.log(['AIQM status:', ...lines].join('\n'));
    });
}
