import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { AppPaths } from '../storage/index.js';
import { redactSecrets } from './redact.js';

export type LogLevel = 'info' | 'warn' | 'error';

export type DiagnosticLogEntry = {
  timestamp: string;
  level: LogLevel;
  operation: string;
  message: string;
  context?: unknown;
};

export type DiagnosticsLoggerOptions = {
  logFile: string;
  clock?: () => Date;
  maxBytes?: number;
};

const defaultMaxLogBytes = 1024 * 1024;

export class DiagnosticsLogger {
  private readonly logFile: string;
  private readonly clock: () => Date;
  private readonly maxBytes: number;

  constructor(pathsOrOptions: AppPaths | DiagnosticsLoggerOptions) {
    this.logFile = pathsOrOptions.logFile;
    this.clock =
      'clock' in pathsOrOptions && pathsOrOptions.clock ? pathsOrOptions.clock : () => new Date();
    this.maxBytes =
      'maxBytes' in pathsOrOptions && typeof pathsOrOptions.maxBytes === 'number'
        ? pathsOrOptions.maxBytes
        : defaultMaxLogBytes;
  }

  async info(operation: string, message: string, context?: unknown): Promise<void> {
    await this.write('info', operation, message, context);
  }

  async warn(operation: string, message: string, context?: unknown): Promise<void> {
    await this.write('warn', operation, message, context);
  }

  async error(operation: string, message: string, context?: unknown): Promise<void> {
    await this.write('error', operation, message, context);
  }

  async write(
    level: LogLevel,
    operation: string,
    message: string,
    context?: unknown
  ): Promise<void> {
    const entry: DiagnosticLogEntry = {
      timestamp: this.clock().toISOString(),
      level,
      operation,
      message,
      ...(context === undefined ? {} : { context: redactSecrets(context) })
    };

    await fs.mkdir(dirname(this.logFile), { recursive: true });
    await this.truncateIfOversized();
    await fs.appendFile(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async truncateIfOversized(): Promise<void> {
    try {
      const stat = await fs.stat(this.logFile);
      if (stat.size >= this.maxBytes) await fs.truncate(this.logFile, 0);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}
