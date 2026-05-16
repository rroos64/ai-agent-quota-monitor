// Provenance: docs/test-traceability.md — Storage area
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeJsonAtomic } from '../../src/storage/index.js';

async function exists(path: string): Promise<boolean> {
  return access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

// Traceability: BR: reliable local state writes; AC: parent creation, overwrite, mode, and failure safety; TS: TSD §9 atomic file storage.
describe('atomic JSON writes', () => {
  it('creates parent directories and writes formatted JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-atomic-'));
    const target = join(root, 'nested', 'latest.json');

    await writeJsonAtomic(target, { schemaVersion: '1', accounts: [] });

    await expect(readFile(target, 'utf8')).resolves.toBe(
      '{\n  "schemaVersion": "1",\n  "accounts": []\n}\n'
    );
  });

  it('overwrites an existing file atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-atomic-overwrite-'));
    const target = join(root, 'config.json');

    await writeJsonAtomic(target, { version: 1 });
    await writeJsonAtomic(target, { version: 2 });

    await expect(readFile(target, 'utf8')).resolves.toBe('{\n  "version": 2\n}\n');
  });

  it('applies a mode option where supported', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-atomic-mode-'));
    const target = join(root, 'tokens.json');

    await writeJsonAtomic(target, { tokens: [] }, { mode: 0o600 });

    const stats = await stat(target);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('cleans up temp files and does not create the target when serialization fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-atomic-failure-'));
    const target = join(root, 'bad', 'latest.json');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeJsonAtomic(target, circular)).rejects.toThrow(TypeError);
    await expect(exists(target)).resolves.toBe(false);
  });
});
