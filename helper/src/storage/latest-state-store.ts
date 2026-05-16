import { promises as fs } from 'node:fs';
import { latestStateSchema, type LatestStateContract } from '../validation/index.js';
import type { AppPaths } from './app-paths.js';
import { writeJsonAtomic } from './atomic-write.js';

export type LatestStateStoreOptions = {
  latestStateFile: string;
  clock?: () => Date;
};

export type LatestStateLoadResult =
  | { exists: true; state: LatestStateContract }
  | { exists: false; state: LatestStateContract };

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function parseLatestState(value: unknown, filePath: string): LatestStateContract {
  const result = latestStateSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid latest state file: ${filePath}`);
  }
  return result.data;
}

export class LatestStateStore {
  private readonly latestStateFile: string;
  private readonly clock: () => Date;

  constructor(pathsOrOptions: AppPaths | LatestStateStoreOptions) {
    this.latestStateFile = pathsOrOptions.latestStateFile;
    this.clock =
      'clock' in pathsOrOptions && pathsOrOptions.clock ? pathsOrOptions.clock : () => new Date();
  }

  defaultState(): LatestStateContract {
    return {
      schemaVersion: '1',
      generatedAt: this.clock().toISOString(),
      accounts: []
    };
  }

  async load(): Promise<LatestStateContract> {
    return (await this.loadResult()).state;
  }

  async loadResult(): Promise<LatestStateLoadResult> {
    let raw: string;

    try {
      raw = await fs.readFile(this.latestStateFile, 'utf8');
    } catch (error) {
      if (isNotFoundError(error)) {
        return { exists: false, state: this.defaultState() };
      }
      throw error;
    }

    return {
      exists: true,
      state: parseLatestState(JSON.parse(raw) as unknown, this.latestStateFile)
    };
  }

  async save(state: LatestStateContract): Promise<void> {
    const parsed = parseLatestState(state, this.latestStateFile);
    await writeJsonAtomic(this.latestStateFile, parsed);
  }
}
