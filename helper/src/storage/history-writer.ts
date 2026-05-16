import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { historyEntrySchema, type HistoryEntryContract } from '../validation/index.js';
import type { AppPaths } from './app-paths.js';

export type HistoryWriterOptions = {
  historyLogFile: string;
};

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function parseHistoryEntry(value: unknown, filePath: string): HistoryEntryContract {
  const result = historyEntrySchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid history entry for: ${filePath}`);
  }
  return result.data;
}

export class HistoryWriter {
  private readonly historyLogFile: string;

  constructor(pathsOrOptions: AppPaths | HistoryWriterOptions) {
    this.historyLogFile = pathsOrOptions.historyLogFile;
  }

  async append(entry: HistoryEntryContract): Promise<void> {
    const parsed = parseHistoryEntry(entry, this.historyLogFile);
    await fs.mkdir(dirname(this.historyLogFile), { recursive: true });
    await fs.appendFile(this.historyLogFile, `${JSON.stringify(parsed)}\n`, { encoding: 'utf8' });
  }

  async readRecent(limit = 100): Promise<HistoryEntryContract[]> {
    const entries: HistoryEntryContract[] = [];
    const stream = createReadStream(this.historyLogFile, { encoding: 'utf8' });
    const lineReader = createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    try {
      for await (const line of lineReader) {
        if (line.trim().length === 0) continue;
        entries.push(parseHistoryEntry(JSON.parse(line) as unknown, this.historyLogFile));
        if (entries.length > limit) entries.shift();
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    } finally {
      lineReader.close();
      stream.destroy();
    }

    return entries;
  }
}
