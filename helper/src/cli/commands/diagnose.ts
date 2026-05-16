import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { Command } from 'commander';
import { createAppServices } from '../../app/index.js';

export type DiagnoseCommandOptions = {
  json?: boolean;
};

type ValidityCheck = {
  exists: boolean;
  valid: boolean;
  error?: string;
};

type FilePresenceCheck = {
  exists: boolean;
  readable: boolean;
  writable: boolean;
};

type TokenFileCheck = {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  mode: string | null;
  securePermissions: boolean | null;
};

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
}

async function checkAccess(path: string, mode: number): Promise<boolean> {
  return access(path, mode)
    .then(() => true)
    .catch(() => false);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkFilePresence(path: string): Promise<FilePresenceCheck> {
  const fileExists = await exists(path);
  return {
    exists: fileExists,
    readable: fileExists ? await checkAccess(path, constants.R_OK) : false,
    writable: fileExists ? await checkAccess(path, constants.W_OK) : false
  };
}

async function checkTokenFile(path: string): Promise<TokenFileCheck> {
  const fileExists = await exists(path);
  if (!fileExists) {
    return {
      exists: false,
      readable: false,
      writable: false,
      mode: null,
      securePermissions: null
    };
  }

  const stats = await stat(path);
  const mode = stats.mode & 0o777;
  return {
    exists: true,
    readable: await checkAccess(path, constants.R_OK),
    writable: await checkAccess(path, constants.W_OK),
    mode: `0${mode.toString(8)}`,
    securePermissions: (mode & 0o077) === 0
  };
}

export function registerDiagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('Run local diagnostics for configuration, storage, and provider registry')
    .option('--json', 'print diagnostics as JSON')
    .action(async (options: DiagnoseCommandOptions) => {
      const { configStore, latestStateStore, logger, paths, providerRegistry } =
        createAppServices();

      const config: ValidityCheck = { exists: await exists(paths.configFile), valid: true };
      try {
        await configStore.load();
      } catch (error) {
        config.valid = false;
        config.error = errorMessage(error);
      }

      const latest: ValidityCheck = { exists: await exists(paths.latestStateFile), valid: true };
      try {
        await latestStateStore.load();
      } catch (error) {
        latest.valid = false;
        latest.error = errorMessage(error);
      }

      const tokenFile = await checkTokenFile(paths.tokenFile);
      const logFile = await checkFilePresence(paths.logFile);
      const providers = {
        fakeRegistered: providerRegistry.has('fake'),
        registered: providerRegistry.list().map((adapter) => adapter.providerId)
      };
      const result = {
        ok: config.valid && latest.valid && providers.fakeRegistered,
        paths: {
          dataDir: paths.dataDir,
          cacheDir: paths.cacheDir,
          configFile: paths.configFile,
          tokenFile: paths.tokenFile,
          latestStateFile: paths.latestStateFile,
          historyLogFile: paths.historyLogFile,
          logDir: paths.logDir,
          logFile: paths.logFile,
          providerCacheDir: paths.providerCacheDir
        },
        checks: {
          config,
          latest,
          tokenFile,
          logFile,
          providers
        }
      };

      await logger.info('diagnose', 'Diagnostics completed', {
        ok: result.ok,
        config: { exists: config.exists, valid: config.valid },
        latest: { exists: latest.exists, valid: latest.valid },
        tokenFile,
        logFile,
        providers
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        [
          result.ok ? 'AIQM diagnostics passed' : 'AIQM diagnostics found issues',
          `Config: ${config.exists ? 'present' : 'missing'}, ${config.valid ? 'valid' : 'invalid'}`,
          `Latest: ${latest.exists ? 'present' : 'missing'}, ${latest.valid ? 'valid' : 'invalid'}`,
          `Token file: ${tokenFile.exists ? `present (${tokenFile.mode ?? 'unknown mode'})` : 'missing'}`,
          `Log file: ${logFile.exists ? 'present' : 'missing'}`,
          `Providers: ${providers.registered.join(', ')}`
        ].join('\n')
      );
    });
}
