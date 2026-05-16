// Provenance: docs/test-traceability.md — CLI area
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCliEntrypoint } from '../../src/cli/index.js';

describe('CLI entrypoint detection', () => {
  it('treats symlink invocation as the CLI entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-cli-entrypoint-'));
    const realBin = join(root, 'dist', 'cli', 'index.js');
    const linkBin = join(root, 'bin', 'aiqm');
    await mkdir(join(root, 'dist', 'cli'), { recursive: true });
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(realBin, '#!/usr/bin/env node\n');
    await symlink(realBin, linkBin);

    expect(isCliEntrypoint(pathToFileURL(realBin).href, ['node', linkBin])).toBe(true);
  });

  it('does not treat unrelated invocations as the CLI entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-cli-entrypoint-'));
    const realBin = join(root, 'dist', 'cli', 'index.js');
    const otherBin = join(root, 'other.js');
    await mkdir(join(root, 'dist', 'cli'), { recursive: true });
    await writeFile(realBin, '#!/usr/bin/env node\n');
    await writeFile(otherBin, '#!/usr/bin/env node\n');

    expect(isCliEntrypoint(pathToFileURL(realBin).href, ['node', otherBin])).toBe(false);
  });
});
