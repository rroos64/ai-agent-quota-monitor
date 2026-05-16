// Provenance: docs/test-traceability.md — Providers area
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatClaudeStatusLine,
  writeClaudeStatusLineSnapshot
} from '../../src/providers/index.js';

// Traceability: BR-043 Claude passive quota capture through Claude Code statusLine.
describe('Claude Code statusLine snapshot bridge', () => {
  it('extracts rate limits from Claude Code statusLine JSON without retaining raw input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-claude-statusline-'));
    const snapshotFile = join(root, 'snapshot.json');
    const snapshot = await writeClaudeStatusLineSnapshot({
      email: 'Claude-User@Example.TEST',
      snapshotFile,
      capturedAt: '2026-05-14T12:00:00.000Z',
      rawJson: JSON.stringify({
        session_id: 'session-redacted',
        model: { display_name: 'Claude Sonnet' },
        version: '2.1.138',
        rate_limits: {
          five_hour: { used_percentage: 23.5, resets_at: 1_768_928_400 },
          seven_day: { used_percentage: 41.2, resets_at: 1_769_360_400 }
        },
        token: 'SECRET_SENTINEL_DO_NOT_LEAK'
      })
    });

    expect(snapshot).toMatchObject({
      provider: 'claude-code',
      email: 'claude-user@example.test',
      hasRateLimits: true,
      limits: [
        {
          id: 'claude-code:5h',
          name: '5-hour Claude Code limit',
          usedPercent: 23.5,
          resetsAt: '2026-01-20T17:00:00.000Z'
        },
        {
          id: 'claude-code:weekly',
          name: 'Weekly Claude Code limit',
          usedPercent: 41.2,
          resetsAt: '2026-01-25T17:00:00.000Z'
        }
      ]
    });
    expect(formatClaudeStatusLine(snapshot)).toBe(
      'Claude claude-user@example.test: 5h 24% | weekly 41%'
    );
    expect(await readFile(snapshotFile, 'utf8')).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
