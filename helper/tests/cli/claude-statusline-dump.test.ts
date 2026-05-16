// Provenance: docs/test-traceability.md — CLI area
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/index.js';

async function runStatusLineDump(inputJson: string, args: string[]): Promise<string[]> {
  const output: string[] = [];
  const logSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
  const originalStdin = process.stdin;
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([inputJson]),
    configurable: true
  });
  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'aiqm', 'claude-statusline-dump', ...args]);
    return output;
  } finally {
    logSpy.mockRestore();
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  }
}

// Traceability: BR-043 Claude statusLine CLI bridge writes display-safe quota snapshots.
describe('claude-statusline-dump command', () => {
  it('writes a snapshot and prints a compact status line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-claude-statusline-cli-'));
    const output = await runStatusLineDump(
      JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 10, resets_at: 1_768_928_400 },
          seven_day: { used_percentage: 20, resets_at: 1_769_360_400 }
        },
        token: 'SECRET_SENTINEL_DO_NOT_LEAK'
      }),
      ['--email', 'dev@example.com', '--claude-config-dir', root]
    );

    expect(output.join('')).toBe('Claude dev@example.com: 5h 10% | weekly 20%\n');
    const snapshot = await readFile(join(root, 'aiqm-quota-snapshot.json'), 'utf8');
    expect(snapshot).toContain('claude-code:5h');
    expect(snapshot).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
