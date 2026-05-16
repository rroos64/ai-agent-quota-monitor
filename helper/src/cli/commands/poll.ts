import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';

export type PollCommandOptions = {
  json?: boolean;
};

export function registerPollCommand(program: Command): void {
  program
    .command('poll')
    .description('Poll configured providers and write the latest quota state')
    .option('--json', 'print poll summary as JSON')
    .action(async (options: PollCommandOptions) => {
      const { latestStateStore, logger, pollingService, paths } = createAppServices();
      const summary = await pollingService.pollAll();
      await logger.info('poll', 'Poll completed', {
        successes: summary.successes,
        failures: summary.failures,
        skipped: summary.skipped,
        staleMerged: summary.staleMerged,
        historyEntriesWritten: summary.historyEntriesWritten
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              summary,
              latestStateFile: paths.latestStateFile
            },
            null,
            2
          )
        );
        return;
      }

      const latest = await latestStateStore.load();
      const accountLines = latest.accounts.map(
        (account) => `- ${account.provider}:${account.email} ${account.status}`
      );
      console.log(
        [
          `AIQM poll complete: ${String(summary.successes)} success(es), ${String(summary.failures)} failure(s), ${String(summary.skipped)} skipped, ${String(latest.accounts.length)} latest account(s)`,
          ...accountLines
        ].join('\n')
      );
    });
}
