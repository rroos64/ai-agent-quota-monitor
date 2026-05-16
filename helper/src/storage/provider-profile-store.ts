import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isSensitiveKey } from '../diagnostics/index.js';
import { normalizeEmail, type ProviderId } from '../domain/index.js';
import type { AppPaths } from './app-paths.js';
import { writeJsonAtomic } from './atomic-write.js';

export type ProviderProfileMetadata = {
  schemaVersion: '1';
  provider: ProviderId;
  email: string;
  createdAt: string;
  updatedAt: string;
  displayName?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ManagedCodexAuthTokens = {
  idToken: string | null;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh: string;
};

function safePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.@_-]+/g, '_');
}

function isSensitiveProfileKey(key: string): boolean {
  return isSensitiveKey(key) || /^tokenpayload$/iu.test(key);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafeMetadata(value: unknown, path = 'profile'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeMetadata(item, `${path}[${String(index)}]`));
    return;
  }

  if (typeof value === 'string' && value.includes('SECRET_SENTINEL_DO_NOT_LEAK')) {
    throw new Error(`Provider profile metadata contains sensitive value at ${path}`);
  }

  if (typeof value !== 'object' || value === null) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveProfileKey(key)) {
      throw new Error(`Provider profile metadata contains sensitive key: ${key}`);
    }
    assertSafeMetadata(nestedValue, `${path}.${key}`);
  }
}

export class ProviderProfileStore {
  constructor(private readonly paths: AppPaths) {}

  profileDir(provider: ProviderId, email: string): string {
    return join(this.paths.providerProfilesDir, provider, safePathSegment(normalizeEmail(email)));
  }

  metadataFile(provider: ProviderId, email: string): string {
    return join(this.profileDir(provider, email), 'profile.json');
  }

  codexHomeDir(email: string): string {
    return join(this.profileDir('codex', email), 'codex-home');
  }

  claudeConfigDir(email: string): string {
    return join(this.profileDir('claude-code', email), 'claude-config');
  }

  claudeQuotaSnapshotFile(email: string): string {
    return join(this.claudeConfigDir(email), 'aiqm-quota-snapshot.json');
  }

  claudeSettingsFile(email: string): string {
    return join(this.claudeConfigDir(email), 'settings.json');
  }

  async ensureProfileDir(provider: ProviderId, email: string): Promise<string> {
    const dir = this.profileDir(provider, email);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.tryChmod700(this.paths.providerProfilesDir);
    await this.tryChmod700(join(this.paths.providerProfilesDir, provider));
    await this.tryChmod700(dir);
    return dir;
  }

  async saveMetadata(metadata: ProviderProfileMetadata): Promise<void> {
    assertSafeMetadata(metadata);
    await this.ensureProfileDir(metadata.provider, metadata.email);
    await writeJsonAtomic(this.metadataFile(metadata.provider, metadata.email), metadata, {
      mode: 0o600
    });
  }

  async loadMetadata(provider: ProviderId, email: string): Promise<ProviderProfileMetadata | null> {
    try {
      return JSON.parse(
        await readFile(this.metadataFile(provider, email), 'utf8')
      ) as ProviderProfileMetadata;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeManagedCodexHome(email: string, tokens: ManagedCodexAuthTokens): Promise<string> {
    await this.ensureProfileDir('codex', email);
    const codexHome = this.codexHomeDir(email);
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await this.chmodTreePrivate(this.profileDir('codex', email));
    await writeJsonAtomic(
      join(codexHome, 'auth.json'),
      {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: tokens.idToken,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          account_id: tokens.accountId
        },
        last_refresh: tokens.lastRefresh
      },
      { mode: 0o600 }
    );
    await this.chmodTreePrivate(codexHome);
    return codexHome;
  }

  async importCodexHome(email: string, sourceCodexHome: string): Promise<string> {
    return this.importProviderDirectory({
      provider: 'codex',
      email,
      sourceDir: sourceCodexHome,
      targetDir: this.codexHomeDir(email),
      label: 'Codex home',
      stagingPrefix: 'codex-home'
    });
  }

  async importClaudeConfigDir(email: string, sourceClaudeConfigDir: string): Promise<string> {
    return this.importProviderDirectory({
      provider: 'claude-code',
      email,
      sourceDir: sourceClaudeConfigDir,
      targetDir: this.claudeConfigDir(email),
      label: 'Claude config dir',
      stagingPrefix: 'claude-config'
    });
  }

  async installClaudeStatusLine(
    email: string,
    commandPath = process.argv[1] ?? 'aiqm'
  ): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const claudeConfigDir = await this.ensureClaudeConfigDir(normalizedEmail);
    const settingsFile = join(claudeConfigDir, 'settings.json');
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(await readFile(settingsFile, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    settings.statusLine = {
      type: 'command',
      command: `${shellQuote(commandPath)} claude-statusline-dump --email ${shellQuote(normalizedEmail)} --claude-config-dir ${shellQuote(claudeConfigDir)}`,
      refreshInterval: 120
    };

    await writeJsonAtomic(settingsFile, settings, { mode: 0o600 });
    await this.chmodTreePrivate(claudeConfigDir);
  }

  async ensureClaudeConfigDir(email: string): Promise<string> {
    await this.ensureProfileDir('claude-code', email);
    const dir = this.claudeConfigDir(email);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.chmodTreePrivate(dir);
    return dir;
  }

  async deleteProfile(provider: ProviderId, email: string): Promise<void> {
    await rm(this.profileDir(provider, email), { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await rm(this.paths.providerProfilesDir, { recursive: true, force: true });
  }

  private async tryChmod700(path: string): Promise<void> {
    try {
      await chmod(path, 0o700);
    } catch {
      // chmod is best-effort for platforms/filesystems that do not support POSIX modes.
    }
  }

  private async importProviderDirectory(input: {
    provider: ProviderId;
    email: string;
    sourceDir: string;
    targetDir: string;
    label: string;
    stagingPrefix: string;
  }): Promise<string> {
    const sourceStat = await lstat(input.sourceDir);
    if (sourceStat.isSymbolicLink()) throw new Error(`${input.label} source must not be a symlink`);
    if (!sourceStat.isDirectory()) throw new Error(`${input.label} source is not a directory`);
    await this.assertNoSymlinks(input.sourceDir, input.label);

    const profileDir = await this.ensureProfileDir(input.provider, input.email);
    const stagingDir = join(
      profileDir,
      `.${input.stagingPrefix}.staging.${process.pid.toString()}.${Date.now().toString()}`
    );
    const backupDir = join(
      profileDir,
      `.${input.stagingPrefix}.backup.${process.pid.toString()}.${Date.now().toString()}`
    );
    let targetMoved = false;
    let installed = false;

    try {
      await cp(input.sourceDir, stagingDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
      await this.chmodTreePrivate(stagingDir);

      try {
        await rename(input.targetDir, backupDir);
        targetMoved = true;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }

      await rename(stagingDir, input.targetDir);
      installed = true;
      await this.chmodTreePrivate(input.targetDir);
      if (targetMoved) await rm(backupDir, { recursive: true, force: true });
      return input.targetDir;
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });
      if (!installed && targetMoved) {
        try {
          await rename(backupDir, input.targetDir);
        } catch {
          // Preserve the original error; a failed restore is surfaced by the missing target.
        }
      }
      throw error;
    }
  }

  private async assertNoSymlinks(path: string, label = 'Codex home'): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`${label} source must not contain symlinks`);
    if (!stat.isDirectory()) return;

    const entries = await readdir(path);
    await Promise.all(
      entries.map((entry) => this.assertNoSymlinks(join(path, basename(entry)), label))
    );
  }

  private async chmodTreePrivate(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      await this.tryChmod700(path);
      const entries = await readdir(path);
      await Promise.all(entries.map((entry) => this.chmodTreePrivate(join(path, basename(entry)))));
      return;
    }
    try {
      await chmod(path, 0o600);
    } catch {
      // chmod is best-effort for platforms/filesystems that do not support POSIX modes.
    }
  }
}
