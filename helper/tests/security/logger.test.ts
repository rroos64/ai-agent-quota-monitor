// Provenance: docs/test-traceability.md — Security area
import { mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DiagnosticsLogger } from '../../src/diagnostics/index.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

// Traceability: BR: diagnostics logging without secrets; AC: logger creates/appends redacted JSONL entries; TS: TSD diagnostics/logging secret handling.
describe('DiagnosticsLogger', () => {
  it('creates parent directories and writes redacted JSONL entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-logger-'));
    const logFile = join(root, 'logs', 'aiqm.log');
    const logger = new DiagnosticsLogger({ logFile, clock: () => new Date(now) });

    await logger.info('test.operation', 'completed', {
      email: 'dev@example.com',
      accessToken: secretSentinel,
      nested: { clientSecret: secretSentinel, safe: 'ok' }
    });

    const content = await readFile(logFile, 'utf8');
    const entry = JSON.parse(content.trim()) as {
      timestamp: string;
      level: string;
      operation: string;
      message: string;
      context: {
        email: string;
        accessToken: string;
        nested: { clientSecret: string; safe: string };
      };
    };

    expect(entry).toMatchObject({
      timestamp: now,
      level: 'info',
      operation: 'test.operation',
      message: 'completed',
      context: { email: 'dev@example.com', nested: { safe: 'ok' } }
    });
    expect(content).not.toContain(secretSentinel);
    expect((await stat(logFile)).isFile()).toBe(true);
  });

  it('appends multiple log entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-logger-append-'));
    const logFile = join(root, 'logs', 'aiqm.log');
    await mkdir(join(root, 'logs'), { recursive: true });
    const logger = new DiagnosticsLogger({ logFile, clock: () => new Date(now) });

    await logger.info('one', 'first');
    await logger.warn('two', 'second');

    const lines = (await readFile(logFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ operation: 'one' });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ operation: 'two' });
  });
});
