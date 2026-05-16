import { spawn } from 'node:child_process';
import { redactSecrets } from '../../diagnostics/index.js';

export type ProviderCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  shell?: boolean;
  stdin?: string;
  suppressLogging?: boolean;
};

export type ProviderCommandResult = {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

export type SafeProviderCommandResult = Omit<ProviderCommandResult, 'stdout' | 'stderr'> & {
  stdout: unknown;
  stderr: unknown;
};

export type ProviderCommandLogger = {
  info(event: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
  warn?(event: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
};

export class ProviderCommandError extends Error {
  constructor(
    message: string,
    readonly result: ProviderCommandResult
  ) {
    super(message);
    this.name = 'ProviderCommandError';
  }
}

export class ProviderCommandTimeoutError extends ProviderCommandError {
  constructor(result: ProviderCommandResult) {
    super(
      `Provider command timed out after ${String(result.durationMs)}ms: ${result.command}`,
      result
    );
    this.name = 'ProviderCommandTimeoutError';
  }
}

export class ProviderCommandNotFoundError extends ProviderCommandError {
  constructor(result: ProviderCommandResult) {
    super(`Provider command not found: ${result.command}`, result);
    this.name = 'ProviderCommandNotFoundError';
  }
}

export interface ProviderCommandRunner {
  run(input: ProviderCommandInput): Promise<ProviderCommandResult>;
}

function redactProviderCommandText(value: string): unknown {
  try {
    return redactSecrets(JSON.parse(value));
  } catch {
    return redactSecrets({ output: value });
  }
}

export function safeProviderCommandResult(
  result: ProviderCommandResult
): SafeProviderCommandResult {
  const safeArgs = result.args.map((arg) => redactProviderCommandText(arg));
  return {
    ...result,
    args: safeArgs.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))),
    stdout: redactProviderCommandText(result.stdout),
    stderr: redactProviderCommandText(result.stderr)
  };
}

export class NodeProviderCommandRunner implements ProviderCommandRunner {
  constructor(private readonly logger?: ProviderCommandLogger) {}

  run(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    const started = Date.now();
    const args = input.args ?? [];

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const child = spawn(input.command, args, {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: input.shell ?? false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const finish = (result: ProviderCommandResult): void => {
        if (settled) return;
        settled = true;
        if (!input.suppressLogging) {
          const safe = safeProviderCommandResult(result);
          if (result.exitCode === 0 && !result.timedOut) {
            void this.logger?.info('provider.command', 'Provider command completed', {
              result: safe
            });
          } else if (this.logger?.warn) {
            void this.logger.warn('provider.command', 'Provider command completed', {
              result: safe
            });
          } else {
            void this.logger?.info('provider.command', 'Provider command completed', {
              result: safe
            });
          }
        }

        if (result.timedOut) {
          reject(new ProviderCommandTimeoutError(result));
          return;
        }
        if (result.exitCode === 127) {
          reject(new ProviderCommandNotFoundError(result));
          return;
        }
        if (result.exitCode !== 0) {
          reject(new ProviderCommandError(`Provider command failed: ${input.command}`, result));
          return;
        }
        resolve(result);
      };

      const timeout = input.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, input.timeoutMs)
        : null;

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (timeout) clearTimeout(timeout);
        const result: ProviderCommandResult = {
          command: input.command,
          args,
          cwd: input.cwd,
          exitCode: error.code === 'ENOENT' ? 127 : null,
          signal: null,
          stdout,
          stderr: error.code ?? error.message,
          timedOut,
          durationMs: Date.now() - started
        };
        if (error.code === 'ENOENT') {
          finish(result);
          return;
        }
        reject(new ProviderCommandError(error.message, result));
      });
      child.on('close', (exitCode, signal) => {
        if (timeout) clearTimeout(timeout);
        finish({
          command: input.command,
          args,
          cwd: input.cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - started
        });
      });

      if (input.stdin !== undefined) {
        child.stdin.write(input.stdin);
      }
      child.stdin.end();
    });
  }
}

export class StubProviderCommandRunner implements ProviderCommandRunner {
  readonly calls: ProviderCommandInput[] = [];

  constructor(
    private readonly handler: (input: ProviderCommandInput) => Promise<ProviderCommandResult>
  ) {}

  async run(input: ProviderCommandInput): Promise<ProviderCommandResult> {
    this.calls.push(input);
    return this.handler(input);
  }
}
