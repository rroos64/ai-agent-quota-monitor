import type { Command } from 'commander';
import { join } from 'node:path';
import {
  formatClaudeStatusLine,
  readStdinText,
  writeClaudeStatusLineSnapshot
} from '../../providers/index.js';
import { createAppServices } from '../../app/index.js';
import { isValidSetupEmail } from '../../tui/index.js';

type ClaudeStatusLineDumpOptions = {
  email: string;
  claudeConfigDir?: string;
};

export function registerClaudeStatusLineDumpCommand(program: Command): void {
  program
    .command('claude-statusline-dump')
    .description('Internal Claude Code statusLine bridge; reads status JSON on stdin')
    .requiredOption('--email <email>', 'Claude account email')
    .option('--claude-config-dir <path>', 'AIQM-owned Claude config dir')
    .action(async (options: ClaudeStatusLineDumpOptions) => {
      const email = options.email.trim().toLowerCase();
      if (!isValidSetupEmail(email)) throw new Error(`Invalid email address: ${options.email}`);
      const services = createAppServices();
      const claudeConfigDir =
        options.claudeConfigDir ?? services.providerProfileStore.claudeConfigDir(email);
      const snapshot = await writeClaudeStatusLineSnapshot({
        rawJson: await readStdinText(),
        email,
        snapshotFile: join(claudeConfigDir, 'aiqm-quota-snapshot.json')
      });
      process.stdout.write(`${formatClaudeStatusLine(snapshot)}\n`);
    });
}
