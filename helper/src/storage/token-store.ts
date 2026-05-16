import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { ProviderId } from '../domain/index.js';
import { normalizeEmail } from '../domain/index.js';
import {
  tokenFileSchema,
  type TokenFileContract,
  type TokenRecordContract
} from '../validation/index.js';
import type { AppPaths } from './app-paths.js';
import { writeJsonAtomic } from './atomic-write.js';

export type TokenStoreOptions = {
  tokenFile: string;
};

export type TokenRef = {
  accountId: string;
  provider: ProviderId;
};

const defaultTokenFile: TokenFileContract = {
  schemaVersion: '1',
  tokens: []
};

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function tokenKey(provider: ProviderId, email: string): string {
  return `${provider}:${normalizeEmail(email)}`;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.code}`;
    })
    .join('; ');
}

function parseTokenFile(value: unknown, filePath: string): TokenFileContract {
  const result = tokenFileSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid token file: ${filePath}: ${formatZodError(result.error)}`);
  }
  return result.data;
}

function assertUniqueTokens(tokenFile: TokenFileContract, filePath: string): void {
  const accountIds = new Set<string>();
  const providerEmails = new Set<string>();

  for (const token of tokenFile.tokens) {
    const byAccountId = token.accountId;
    const byProviderEmail = tokenKey(token.provider, token.email);
    if (accountIds.has(byAccountId) || providerEmails.has(byProviderEmail)) {
      throw new Error(`Invalid token file: ${filePath}: duplicate account or provider/email token`);
    }
    accountIds.add(byAccountId);
    providerEmails.add(byProviderEmail);
  }
}

export class TokenStore {
  private readonly tokenFile: string;

  constructor(pathsOrOptions: AppPaths | TokenStoreOptions) {
    this.tokenFile = pathsOrOptions.tokenFile;
  }

  async load(): Promise<TokenFileContract> {
    let raw: string;

    try {
      raw = await fs.readFile(this.tokenFile, 'utf8');
    } catch (error) {
      if (isNotFoundError(error)) {
        return structuredClone(defaultTokenFile);
      }
      throw error;
    }

    const tokenFile = parseTokenFile(JSON.parse(raw) as unknown, this.tokenFile);
    assertUniqueTokens(tokenFile, this.tokenFile);
    return tokenFile;
  }

  async save(tokenFile: TokenFileContract): Promise<void> {
    const parsed = parseTokenFile(tokenFile, this.tokenFile);
    assertUniqueTokens(parsed, this.tokenFile);
    await writeJsonAtomic(this.tokenFile, parsed, { mode: 0o600 });
  }

  async setToken(record: TokenRecordContract): Promise<TokenRecordContract> {
    const tokenFile = await this.load();
    const nextTokens = tokenFile.tokens.filter(
      (token) =>
        token.accountId !== record.accountId &&
        tokenKey(token.provider, token.email) !== tokenKey(record.provider, record.email)
    );
    const nextFile = { ...tokenFile, tokens: [...nextTokens, record] };
    await this.save(nextFile);
    return record;
  }

  async getTokenByRef(tokenRef: TokenRef): Promise<TokenRecordContract | null> {
    const tokenFile = await this.load();
    return (
      tokenFile.tokens.find(
        (token) => token.provider === tokenRef.provider && token.accountId === tokenRef.accountId
      ) ?? null
    );
  }

  async getTokenByProviderEmail(
    provider: ProviderId,
    email: string
  ): Promise<TokenRecordContract | null> {
    const expectedKey = tokenKey(provider, email);
    const tokenFile = await this.load();
    return (
      tokenFile.tokens.find((token) => tokenKey(token.provider, token.email) === expectedKey) ??
      null
    );
  }

  async deleteTokenByRef(tokenRef: TokenRef): Promise<boolean> {
    const tokenFile = await this.load();
    const tokens = tokenFile.tokens.filter(
      (token) => token.provider !== tokenRef.provider || token.accountId !== tokenRef.accountId
    );
    if (tokens.length === tokenFile.tokens.length) return false;

    await this.save({ ...tokenFile, tokens });
    return true;
  }

  async deleteTokenByProviderEmail(provider: ProviderId, email: string): Promise<boolean> {
    const expectedKey = tokenKey(provider, email);
    const tokenFile = await this.load();
    const tokens = tokenFile.tokens.filter(
      (token) => tokenKey(token.provider, token.email) !== expectedKey
    );
    if (tokens.length === tokenFile.tokens.length) return false;

    await this.save({ ...tokenFile, tokens });
    return true;
  }
}
