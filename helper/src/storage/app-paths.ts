import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type AppPathOptions = {
  dataDir?: string;
  cacheDir?: string;
};

export type AppPathEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, 'AIQM_DATA_DIR' | 'AIQM_CACHE_DIR'>
>;

export type AppPaths = {
  dataDir: string;
  cacheDir: string;
  configFile: string;
  tokenFile: string;
  latestStateFile: string;
  historyLogFile: string;
  logDir: string;
  logFile: string;
  providerCacheDir: string;
  providerProfilesDir: string;
};

const appDirectoryName = 'ai-agent-quota-monitor';

export function defaultDataDir(homeDirectory = homedir()): string {
  return join(homeDirectory, '.local', 'share', appDirectoryName);
}

export function defaultCacheDir(homeDirectory = homedir()): string {
  return join(homeDirectory, '.cache', appDirectoryName);
}

export function resolveAppPaths(
  options: AppPathOptions = {},
  environment: AppPathEnvironment = process.env
): AppPaths {
  const dataDir = resolve(options.dataDir ?? environment.AIQM_DATA_DIR ?? defaultDataDir());
  const cacheDir = resolve(options.cacheDir ?? environment.AIQM_CACHE_DIR ?? defaultCacheDir());
  const logDir = join(dataDir, 'logs');

  return {
    dataDir,
    cacheDir,
    configFile: join(dataDir, 'config.json'),
    tokenFile: join(dataDir, 'tokens.json'),
    latestStateFile: join(dataDir, 'latest.json'),
    historyLogFile: join(dataDir, 'history.log'),
    logDir,
    logFile: join(logDir, 'aiqm.log'),
    providerCacheDir: join(cacheDir, 'provider-cache'),
    providerProfilesDir: join(dataDir, 'providers')
  };
}
