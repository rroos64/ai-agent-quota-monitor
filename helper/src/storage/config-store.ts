import { promises as fs } from 'node:fs';
import type { ConfiguredAccount, ProviderId } from '../domain/index.js';
import { accountIdFor, normalizeEmail } from '../domain/index.js';
import { z } from 'zod';
import { appConfigSchema, type AppConfigContract } from '../validation/index.js';
import type { AppPaths } from './app-paths.js';
import { writeJsonAtomic } from './atomic-write.js';

export type ConfigStoreOptions = {
  configFile: string;
};

export type AccountUpdate = Partial<
  Pick<ConfiguredAccount, 'email' | 'displayOrder' | 'providerConfig' | 'updatedAt'>
>;

export const defaultAppConfig: AppConfigContract = {
  schemaVersion: '1',
  accounts: [],
  settings: {
    refreshIntervalMinutes: 5,
    providerPollIntervalSeconds: {
      codex: 60,
      'claude-code': 600
    },
    providerPollMaxIntervalSeconds: {
      codex: 900,
      'claude-code': 900
    }
  }
};

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.code}`;
    })
    .join('; ');
}

function parseConfig(value: unknown, filePath: string): AppConfigContract {
  const result = appConfigSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid config file: ${filePath}: ${formatZodError(result.error)}`);
  }
  return result.data;
}

export class ConfigStore {
  private readonly configFile: string;

  constructor(pathsOrOptions: AppPaths | ConfigStoreOptions) {
    this.configFile = pathsOrOptions.configFile;
  }

  async load(): Promise<AppConfigContract> {
    let raw: string;

    try {
      raw = await fs.readFile(this.configFile, 'utf8');
    } catch (error) {
      if (isNotFoundError(error)) {
        return structuredClone(defaultAppConfig);
      }
      throw error;
    }

    return parseConfig(JSON.parse(raw) as unknown, this.configFile);
  }

  async save(config: AppConfigContract): Promise<void> {
    const parsed = parseConfig(config, this.configFile);
    await writeJsonAtomic(this.configFile, parsed);
  }

  async getAccounts(): Promise<ConfiguredAccount[]> {
    return (await this.load()).accounts;
  }

  async getAccount(accountId: string): Promise<ConfiguredAccount | null> {
    const config = await this.load();
    return config.accounts.find((account) => account.id === accountId) ?? null;
  }

  async addAccount(account: ConfiguredAccount): Promise<AppConfigContract> {
    const config = await this.load();
    const nextConfig = { ...config, accounts: [...config.accounts, account] };
    await this.save(nextConfig);
    return nextConfig;
  }

  async updateAccount(accountId: string, update: AccountUpdate): Promise<AppConfigContract> {
    const config = await this.load();
    const accountIndex = config.accounts.findIndex((account) => account.id === accountId);
    if (accountIndex === -1) {
      throw new Error(`Config account not found: ${accountId}`);
    }

    const existingAccount = config.accounts[accountIndex];
    const email = update.email === undefined ? existingAccount.email : normalizeEmail(update.email);
    const updatedAccount = {
      ...existingAccount,
      ...update,
      email,
      id:
        update.email === undefined
          ? existingAccount.id
          : accountIdFor(existingAccount.provider, email),
      updatedAt: update.updatedAt ?? new Date().toISOString()
    };
    const accounts = [...config.accounts];
    accounts[accountIndex] = updatedAccount;

    const nextConfig = { ...config, accounts };
    await this.save(nextConfig);
    return nextConfig;
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    const config = await this.load();
    const accounts = config.accounts.filter((account) => account.id !== accountId);
    if (accounts.length === config.accounts.length) return false;

    await this.save({ ...config, accounts });
    return true;
  }

  async getAccountByProviderEmail(
    provider: ProviderId,
    email: string
  ): Promise<ConfiguredAccount | null> {
    const normalizedEmail = normalizeEmail(email);
    const config = await this.load();
    return (
      config.accounts.find(
        (account) =>
          account.provider === provider && normalizeEmail(account.email) === normalizedEmail
      ) ?? null
    );
  }
}
