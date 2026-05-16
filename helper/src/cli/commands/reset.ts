import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';

export type ResetCommandOptions = {
  all?: boolean;
  json?: boolean;
};

async function removeIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Reset local helper data under configured app paths')
    .option('--all', 'remove config, tokens, latest state, history, and logs')
    .option('--json', 'print reset result as JSON')
    .action(async (options: ResetCommandOptions) => {
      if (!options.all) {
        throw new Error('Refusing to reset without --all');
      }

      const { logger, paths } = createAppServices();
      await logger.info('reset', 'Reset requested', { all: true, dataDir: paths.dataDir });
      const targets = [
        paths.configFile,
        paths.tokenFile,
        paths.latestStateFile,
        paths.historyLogFile,
        paths.logFile,
        paths.logDir,
        paths.providerProfilesDir
      ];
      const removed = [] as { path: string; removed: boolean }[];

      for (const path of targets) {
        removed.push({ path, removed: await removeIfPresent(path) });
      }

      const result = {
        reset: true,
        dataDir: paths.dataDir,
        cacheDir: paths.cacheDir,
        removed
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`AIQM reset complete: removed configured files under ${paths.dataDir}`);
    });
}
