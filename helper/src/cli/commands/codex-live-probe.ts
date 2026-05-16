import type { Command } from 'commander';
import { runCodexLiveRateLimitsProbe } from '../../providers/index.js';
import { printJson } from './account-actions.js';

export type CodexLiveProbeOptions = {
  socket?: string;
  wsUrl?: string;
  codexHome?: string;
  email?: string;
  out?: string;
  timeoutMs?: string;
};

export function registerCodexLiveProbeCommand(program: Command): void {
  program
    .command('codex-live-probe', { hidden: true })
    .description('Hidden, explicitly opt-in Codex app-server account/rateLimits/read probe')
    .option(
      '--socket <path>',
      'existing app-server Unix socket path; this command does not start app-server'
    )
    .option(
      '--ws-url <url>',
      'existing loopback app-server WebSocket URL, for example ws://127.0.0.1:18080'
    )
    .requiredOption('--codex-home <path>', 'isolated CODEX_HOME to pass to codex app-server proxy')
    .requiredOption('--email <email>', 'account email label for parser output')
    .option('--out <path>', 'write redacted evidence JSON to this path')
    .option('--timeout-ms <ms>', 'probe timeout in milliseconds', '5000')
    .action(async (options: CodexLiveProbeOptions) => {
      const timeoutMs = Number(options.timeoutMs ?? '5000');
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive number');
      }

      const evidence = await runCodexLiveRateLimitsProbe({
        socketPath: options.socket,
        wsUrl: options.wsUrl,
        codexHome: options.codexHome ?? '',
        accountEmail: options.email ?? '',
        fetchedAt: new Date().toISOString(),
        timeoutMs,
        outputPath: options.out
      });
      printJson(evidence);
    });
}
