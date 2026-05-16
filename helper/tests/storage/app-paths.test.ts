// Provenance: docs/test-traceability.md — Storage area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCacheDir, defaultDataDir, resolveAppPaths } from '../../src/storage/index.js';

// Traceability: BR: local-first user data paths; AC: production defaults and test-safe overrides; TS: TSD §9.1 storage paths.
describe('app path resolution', () => {
  it('resolves production defaults from the home directory', () => {
    const home = '/home/example';

    expect(defaultDataDir(home)).toBe('/home/example/.local/share/ai-agent-quota-monitor');
    expect(defaultCacheDir(home)).toBe('/home/example/.cache/ai-agent-quota-monitor');
  });

  it('uses constructor options before environment overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-paths-'));
    const optionDataDir = join(root, 'option-data');
    const optionCacheDir = join(root, 'option-cache');

    const paths = resolveAppPaths(
      { dataDir: optionDataDir, cacheDir: optionCacheDir },
      { AIQM_DATA_DIR: join(root, 'env-data'), AIQM_CACHE_DIR: join(root, 'env-cache') }
    );

    expect(paths.dataDir).toBe(resolve(optionDataDir));
    expect(paths.cacheDir).toBe(resolve(optionCacheDir));
    expect(paths.configFile).toBe(join(resolve(optionDataDir), 'config.json'));
    expect(paths.tokenFile).toBe(join(resolve(optionDataDir), 'tokens.json'));
    expect(paths.latestStateFile).toBe(join(resolve(optionDataDir), 'latest.json'));
    expect(paths.historyLogFile).toBe(join(resolve(optionDataDir), 'history.log'));
    expect(paths.logDir).toBe(join(resolve(optionDataDir), 'logs'));
    expect(paths.logFile).toBe(join(resolve(optionDataDir), 'logs', 'aiqm.log'));
    expect(paths.providerCacheDir).toBe(join(resolve(optionCacheDir), 'provider-cache'));
    expect(paths.providerProfilesDir).toBe(join(resolve(optionDataDir), 'providers'));
  });

  it('uses environment overrides when options are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiqm-env-paths-'));
    const dataDir = join(root, 'data');
    const cacheDir = join(root, 'cache');

    const paths = resolveAppPaths({}, { AIQM_DATA_DIR: dataDir, AIQM_CACHE_DIR: cacheDir });

    expect(paths.dataDir).toBe(resolve(dataDir));
    expect(paths.cacheDir).toBe(resolve(cacheDir));
  });
});
