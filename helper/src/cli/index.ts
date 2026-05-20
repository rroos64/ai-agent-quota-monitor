#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAccountCommand } from './commands/account.js';
import { registerClaudeStatusLineDumpCommand } from './commands/claude-statusline-dump.js';
import { registerCodexLiveProbeCommand } from './commands/codex-live-probe.js';
import { registerDiagnoseCommand } from './commands/diagnose.js';
import { registerPollCommand } from './commands/poll.js';
import { registerResetCommand } from './commands/reset.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerStatusCommand } from './commands/status.js';

export function buildProgram(): Command {
  const program = new Command();

  program.name('aiqm').description('AI Agent Quota Monitor helper CLI').version('1.1.0');

  registerSetupCommand(program);
  registerCodexLiveProbeCommand(program);
  registerClaudeStatusLineDumpCommand(program);

  registerPollCommand(program);
  registerStatusCommand(program);

  registerAccountCommand(program);

  registerDiagnoseCommand(program);
  registerResetCommand(program);

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

function realpathOrOriginal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function isCliEntrypoint(importMetaUrl: string, argv = process.argv): boolean {
  const invokedPath = argv[1];
  if (!invokedPath) return false;

  const modulePath = fileURLToPath(importMetaUrl);
  return realpathOrOriginal(modulePath) === realpathOrOriginal(invokedPath);
}

if (isCliEntrypoint(import.meta.url)) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
