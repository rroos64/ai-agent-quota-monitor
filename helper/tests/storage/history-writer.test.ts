// Provenance: docs/test-traceability.md — Storage area
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { HistoryWriter, resolveAppPaths } from '../../src/storage/index.js';
import type { HistoryEntryContract } from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

async function tempWriter(): Promise<{ writer: HistoryWriter; historyLogFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-history-writer-'));
  const paths = resolveAppPaths({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') });
  return { writer: new HistoryWriter(paths), historyLogFile: paths.historyLogFile };
}

function historyEntry(windowName = 'weekly'): HistoryEntryContract {
  return {
    schemaVersion: '1',
    timestamp: now,
    provider: 'codex',
    email: 'dev@example.com',
    quotaWindow: windowName,
    usedPercentage: 42,
    resetAt: now,
    status: 'fresh'
  };
}

// Traceability: BR: local usage history; AC: append-only validated JSONL without token fields; TS: TSD §9.5 History Store.
describe('HistoryWriter', () => {
  it('appends validated JSONL entries and creates parent directories', async () => {
    const { writer, historyLogFile } = await tempWriter();
    const entry = historyEntry();

    await writer.append(entry);

    const lines = (await readFile(historyLogFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual(entry);
    await expect(writer.readRecent()).resolves.toEqual([entry]);
  });

  it('preserves existing lines when appending', async () => {
    const { writer, historyLogFile } = await tempWriter();
    await mkdir(join(historyLogFile, '..'), { recursive: true });
    await writeFile(historyLogFile, `${JSON.stringify(historyEntry('existing'))}\n`, 'utf8');

    await writer.append(historyEntry('new'));

    const lines = (await readFile(historyLogFile, 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as HistoryEntryContract)).toEqual([
      historyEntry('existing'),
      historyEntry('new')
    ]);
  });

  it('rejects invalid history entries and does not leak secret values in errors', async () => {
    const { writer } = await tempWriter();
    const invalidEntry = {
      ...historyEntry(),
      tokenPayload: { accessToken: secretSentinel }
    };

    await expect(writer.append(invalidEntry as HistoryEntryContract)).rejects.toThrow(
      'Invalid history entry'
    );
    await writer.append(invalidEntry as HistoryEntryContract).catch((error: unknown) => {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(secretSentinel);
    });
  });

  it('limits readRecent results to the requested count', async () => {
    const { writer } = await tempWriter();

    await writer.append(historyEntry('one'));
    await writer.append(historyEntry('two'));
    await writer.append(historyEntry('three'));

    await expect(writer.readRecent(2)).resolves.toEqual([
      historyEntry('two'),
      historyEntry('three')
    ]);
  });

  it('does not write secret sentinels when given valid display-only history data', async () => {
    const { writer, historyLogFile } = await tempWriter();

    await writer.append(historyEntry());

    await expect(readFile(historyLogFile, 'utf8')).resolves.not.toContain(secretSentinel);
  });
});
