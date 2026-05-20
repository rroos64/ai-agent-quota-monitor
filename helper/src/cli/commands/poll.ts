import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';
import { normalizeEmail } from '../../domain/index.js';
import type { PollTarget } from '../../services/index.js';
import { parseProvider } from './account-actions.js';

export type PollCommandOptions = {
  json?: boolean;
  force?: boolean;
  provider?: string;
  email?: string;
  account?: string;
};

function parseAccountTarget(value: string): PollTarget {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error('Account target must use <provider:email>');
  }

  return {
    kind: 'account',
    provider: parseProvider(value.slice(0, separatorIndex)),
    email: normalizeEmail(value.slice(separatorIndex + 1))
  };
}

function pollTargetFromOptions(options: PollCommandOptions): PollTarget | undefined {
  if (options.account && (options.provider || options.email)) {
    throw new Error('--account cannot be used with --provider or --email');
  }
  if (options.account) return parseAccountTarget(options.account);

  if (options.email && !options.provider) {
    throw new Error('--email requires --provider');
  }
  if (options.provider && !options.email) {
    throw new Error('--provider requires --email');
  }
  if (!options.provider || !options.email) return undefined;

  return {
    kind: 'account',
    provider: parseProvider(options.provider),
    email: normalizeEmail(options.email)
  };
}

function pollContextLabel(force: boolean, target: PollTarget | undefined): string {
  const parts: string[] = [];
  if (force) parts.push('forced');
  if (target?.kind === 'account') parts.push(`target ${target.provider}:${target.email}`);
  if (target?.kind === 'all') parts.push('target all');
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function registerPollCommand(program: Command): void {
  program
    .command('poll')
    .description('Poll configured providers and write the latest quota state')
    .option('--json', 'print poll summary as JSON')
    .option('--force', 'bypass provider poll interval/back-off skips')
    .option('--provider <provider>', 'target provider id')
    .option('--email <email>', 'target account email; requires --provider')
    .option('--account <provider:email>', 'target account shorthand')
    .action(async (options: PollCommandOptions) => {
      const target = pollTargetFromOptions(options);
      const force = options.force === true;
      const { latestStateStore, logger, pollingService, paths } = createAppServices();
      const summary = await pollingService.pollAll({ force, target });
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
          `AIQM poll complete${pollContextLabel(force, target)}: ${String(summary.successes)} success(es), ${String(summary.failures)} failure(s), ${String(summary.skipped)} skipped, ${String(latest.accounts.length)} latest account(s)`,
          ...accountLines
        ].join('\n')
      );
    });
}
