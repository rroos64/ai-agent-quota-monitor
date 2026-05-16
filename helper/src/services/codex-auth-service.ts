import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { redactSecrets } from '../diagnostics/index.js';
import type { AuthSession } from '../domain/index.js';
import { ProviderCommandError } from '../providers/index.js';
import type {
  CodexDeviceAuthHarness,
  CodexDeviceAuthInstructions,
  CodexDeviceAuthProcess,
  CodexDeviceAuthStatus,
  CodexLoginStatus,
  ProviderCommandLogger,
  ProviderCommandRunner
} from '../providers/index.js';
import { loginCodexWithOAuth } from '../providers/codex/codex-oauth.js';
import type { AppPaths, ProviderProfileStore } from '../storage/index.js';
import type { ProviderCapabilitiesService } from './provider-capabilities-service.js';

export type CodexAuthMode = 'device' | 'browser';

export type CodexHomeFileMetadata = {
  path: string;
  type: 'file' | 'directory' | 'other';
  mode: string;
};

export type CodexPassiveProbeClassification =
  | 'supported'
  | 'unsupported'
  | 'auth_required'
  | 'error'
  | 'passive_only';

export type CodexPassiveProbeResult = {
  command: string;
  args: string[];
  classification: CodexPassiveProbeClassification;
  exitCode: number | null;
  summary: string;
  passive: boolean;
  opensAgentSession: boolean;
  quotaDataFound: boolean;
  unsafeReason: string | null;
};

export type CodexPostLoginDiscoveryResult = {
  mode: 'codex_login';
  provider: 'codex';
  codexHome: string;
  loginStatus: CodexLoginStatus;
  files: CodexHomeFileMetadata[];
  emptyHomeStatus: CodexLoginStatus;
  probes: CodexPassiveProbeResult[];
  discoveredCommands: string[];
};

export type CodexPassiveDiscoveryEvidence = {
  schemaVersion: '1';
  provider: 'codex';
  mode: 'codex_login';
  generatedAt: string;
  cliVersion: string | null;
  loginStatus: CodexDeviceAuthStatus;
  emptyHomeStatus: CodexDeviceAuthStatus;
  files: CodexHomeFileMetadata[];
  discoveredCommands: string[];
  probes: {
    commandLabel: string;
    classification: CodexPassiveProbeClassification;
    exitCode: number | null;
    summary: string;
    passive: boolean;
    opensAgentSession: boolean;
    quotaDataFound: boolean;
    unsafeReason: string | null;
  }[];
  safety: {
    rawStdoutStored: false;
    rawStderrStored: false;
    tokenContentsStored: false;
    urlsRedacted: true;
    emailsRedacted: true;
  };
};

export type CodexEvidenceExportResult = {
  path: string;
  evidence: CodexPassiveDiscoveryEvidence;
};

export type CodexAuthStartResult = {
  mode: 'codex_login';
  authMode: CodexAuthMode;
  enabled: false;
  codexHome: string;
  authSession: AuthSession;
  instructions: CodexDeviceAuthInstructions | null;
  process: CodexDeviceAuthProcess;
  safeOutputSummary?: string;
  files: CodexHomeFileMetadata[];
};

export class CodexAuthService {
  constructor(
    private readonly options: {
      paths: AppPaths;
      deviceHarness: CodexDeviceAuthHarness;
      browserHarness: CodexDeviceAuthHarness;
      commandRunner: ProviderCommandRunner;
      providerCapabilitiesService: ProviderCapabilitiesService;
      providerProfileStore: ProviderProfileStore;
      logger: ProviderCommandLogger;
    }
  ) {}

  async start(input: { expectedEmail: string }): Promise<CodexAuthStartResult> {
    return this.startBrowserLogin(input);
  }

  async startDeviceAuth(input: { expectedEmail: string }): Promise<CodexAuthStartResult> {
    const codexHome = join(this.options.paths.cacheDir, 'codex-login-home');
    await mkdir(codexHome, { recursive: true });
    const started = await this.options.deviceHarness.startDeviceAuth({
      codexHome,
      expectedEmail: input.expectedEmail
    });
    await this.options.logger.info('codex.auth.start', 'Started Codex device-auth flow', {
      provider: 'codex',
      mode: 'codex_login',
      codexHome
    });

    return {
      mode: 'codex_login',
      authMode: 'device',
      enabled: false,
      codexHome,
      ...started,
      files: await this.listCodexHomeFiles(codexHome)
    };
  }

  async startBrowserLogin(input: { expectedEmail: string }): Promise<CodexAuthStartResult> {
    const email = input.expectedEmail.trim().toLowerCase();
    const now = new Date();
    const authSession: AuthSession = {
      id: `codex-browser-login-${String(now.getTime())}`,
      provider: 'codex',
      expectedEmail: email,
      status: 'waiting',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      completedAt: null,
      authenticatedEmail: null,
      tokenRef: null,
      failureReason: null,
      userMessage: 'Complete Codex login in the browser opened by AIQM.'
    };

    await this.options.logger.info(
      'codex.auth.browser_start',
      'Started AIQM Codex browser login flow',
      {
        provider: 'codex',
        mode: 'aiqm_oauth',
        authMode: 'browser'
      }
    );

    const tokens = await loginCodexWithOAuth({
      onAuth: async () => {
        await this.options.logger.info('codex.auth.browser_open', 'Opened Codex browser login', {
          provider: 'codex',
          mode: 'aiqm_oauth'
        });
      }
    });

    const codexHome = await this.options.providerProfileStore.writeManagedCodexHome(email, {
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      lastRefresh: new Date().toISOString()
    });

    return {
      mode: 'codex_login',
      authMode: 'browser',
      enabled: false,
      codexHome,
      authSession: {
        ...authSession,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        authenticatedEmail: email
      },
      instructions: null,
      process: {
        output: '',
        cancel: () => undefined
      },
      safeOutputSummary: '[AIQM_CODEX_BROWSER_LOGIN_COMPLETE]',
      files: await this.listCodexHomeFiles(codexHome)
    };
  }

  async checkStatus(codexHome: string): Promise<CodexLoginStatus> {
    return this.checkManagedCodexHomeStatus(codexHome);
  }

  async cancel(process: CodexDeviceAuthProcess): Promise<void> {
    await process.cancel('SIGTERM');
  }

  private async checkManagedCodexHomeStatus(codexHome: string): Promise<CodexLoginStatus> {
    try {
      const raw = await readFile(join(codexHome, 'auth.json'), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const tokens = parsed.tokens;
      if (!tokens || typeof tokens !== 'object')
        return { status: 'not_logged_in', summary: 'Not logged in' };
      const record = tokens as Record<string, unknown>;
      if (
        typeof record.access_token === 'string' &&
        typeof record.refresh_token === 'string' &&
        typeof record.account_id === 'string'
      ) {
        return { status: 'logged_in', summary: 'Logged in with AIQM-managed Codex account' };
      }
      return { status: 'not_logged_in', summary: 'Not logged in' };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { status: 'not_logged_in', summary: 'Not logged in' };
      }
      return { status: 'unknown', summary: 'Unable to determine login status' };
    }
  }

  async exportDiscoveryEvidence(
    discovery: CodexPostLoginDiscoveryResult,
    outputPath = join(
      this.options.paths.dataDir,
      'diagnostics',
      'codex-passive-discovery-evidence.redacted.json'
    )
  ): Promise<CodexEvidenceExportResult> {
    const evidence: CodexPassiveDiscoveryEvidence = {
      schemaVersion: '1',
      provider: 'codex',
      mode: 'codex_login',
      generatedAt: new Date().toISOString(),
      cliVersion: await this.readCliVersion(discovery.codexHome),
      loginStatus: discovery.loginStatus.status,
      emptyHomeStatus: discovery.emptyHomeStatus.status,
      files: discovery.files.map((file) => ({
        ...file,
        path: this.sanitizeEvidencePath(file.path)
      })),
      discoveredCommands: discovery.discoveredCommands,
      probes: discovery.probes.map((probe) => ({
        commandLabel: [probe.command, ...probe.args].join(' '),
        classification: probe.classification,
        exitCode: probe.exitCode,
        summary: this.safeProbeSummary(probe.summary),
        passive: probe.passive,
        opensAgentSession: probe.opensAgentSession,
        quotaDataFound: probe.quotaDataFound,
        unsafeReason: probe.unsafeReason
      })),
      safety: {
        rawStdoutStored: false,
        rawStderrStored: false,
        tokenContentsStored: false,
        urlsRedacted: true,
        emailsRedacted: true
      }
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await this.options.logger.info(
      'codex.auth.evidence_export',
      'Exported Codex passive discovery evidence',
      {
        provider: 'codex',
        mode: 'codex_login',
        path: outputPath,
        probeCount: evidence.probes.length
      }
    );
    return { path: outputPath, evidence };
  }

  async runPostLoginDiscovery(codexHome: string): Promise<CodexPostLoginDiscoveryResult> {
    const loginStatus = await this.checkStatus(codexHome);
    const files = await this.listCodexHomeFiles(codexHome);
    await mkdir(this.options.paths.cacheDir, { recursive: true });
    const emptyHome = await mkdtemp(join(this.options.paths.cacheDir, 'codex-empty-home-'));
    const emptyHomeStatus = await this.checkStatus(emptyHome);
    const probeCatalog = [
      { command: 'codex', args: ['--help'] },
      { command: 'codex', args: ['login', '--help'] },
      { command: 'codex', args: ['login', 'status'] },
      { command: 'codex', args: ['status', '--help'] },
      { command: 'codex', args: ['debug', '--help'] },
      { command: 'codex', args: ['features', '--help'] }
    ];
    const probes = await Promise.all(
      probeCatalog.map((probe) => this.runPassiveProbe(codexHome, probe.command, probe.args))
    );
    const discoveredCommands = this.discoverCommandsFromSummary(
      probes.find((probe) => probe.args.length === 1 && probe.args[0] === '--help')?.summary ?? ''
    );

    await this.options.logger.info(
      'codex.auth.discovery',
      'Completed Codex passive discovery probes',
      {
        provider: 'codex',
        mode: 'codex_login',
        probeCount: probes.length,
        loginStatus: loginStatus.status,
        emptyHomeStatus: emptyHomeStatus.status
      }
    );

    return {
      mode: 'codex_login',
      provider: 'codex',
      codexHome,
      loginStatus,
      files,
      emptyHomeStatus,
      probes,
      discoveredCommands
    };
  }

  private async readCliVersion(codexHome: string): Promise<string | null> {
    const probe = await this.runPassiveProbe(codexHome, 'codex', ['--version']);
    return probe.classification === 'error' ? null : probe.summary;
  }

  private async runPassiveProbe(
    codexHome: string,
    command: string,
    args: string[]
  ): Promise<CodexPassiveProbeResult> {
    try {
      const result = await this.options.commandRunner.run({
        command,
        args,
        env: { CODEX_HOME: codexHome },
        timeoutMs: 5_000,
        shell: false,
        suppressLogging: true
      });
      const output = `${result.stdout}\n${result.stderr}`;
      return this.buildProbeResult(command, args, output, result.exitCode);
    } catch (error) {
      if (error instanceof ProviderCommandError) {
        const output = `${error.result.stdout}\n${error.result.stderr}`;
        return this.buildProbeResult(command, args, output, error.result.exitCode);
      }
      return {
        command,
        args,
        classification: 'error',
        exitCode: null,
        summary: 'Probe failed without safe command output',
        passive: true,
        opensAgentSession: false,
        quotaDataFound: false,
        unsafeReason: null
      };
    }
  }

  private buildProbeResult(
    command: string,
    args: string[],
    output: string,
    exitCode: number | null
  ): CodexPassiveProbeResult {
    const safe = this.assessProbeSafety(args);
    return {
      command,
      args,
      classification: safe.passive ? this.classifyProbe(args, output, exitCode) : 'error',
      exitCode,
      summary: this.safeProbeSummary(output),
      passive: safe.passive,
      opensAgentSession: safe.opensAgentSession,
      quotaDataFound: /quota|usage|limit|remaining|reset/iu.test(output),
      unsafeReason: safe.unsafeReason
    };
  }

  private assessProbeSafety(args: string[]): {
    passive: boolean;
    opensAgentSession: boolean;
    unsafeReason: string | null;
  } {
    const command = args[0] ?? '';
    if (
      ['exec', 'review', 'resume', 'fork', 'apply', 'mcp-server', 'app-server'].includes(command)
    ) {
      return {
        passive: false,
        opensAgentSession: true,
        unsafeReason: 'Command can start agent work, apply changes, or open an agent session'
      };
    }
    if (args.length === 0) {
      return { passive: false, opensAgentSession: true, unsafeReason: 'Prompt mode is unsafe' };
    }
    if (args.includes('--help') || args.includes('--version')) {
      return { passive: true, opensAgentSession: false, unsafeReason: null };
    }
    if (args.join(' ') === 'login status') {
      return { passive: true, opensAgentSession: false, unsafeReason: null };
    }
    return {
      passive: false,
      opensAgentSession: false,
      unsafeReason: 'Probe is not in safe catalog'
    };
  }

  private classifyProbe(
    args: string[],
    output: string,
    exitCode: number | null
  ): CodexPassiveProbeClassification {
    if (/not\s+logged\s+in|not\s+authenticated|login\s+required/iu.test(output)) {
      return 'auth_required';
    }
    if (exitCode !== 0) return 'error';
    if (args.includes('--help')) return 'passive_only';
    if (/quota|usage|limit/iu.test(output)) return 'supported';
    return 'unsupported';
  }

  private safeProbeSummary(output: string): string {
    const firstLine = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstLine) return 'No output';
    const redacted = this.redactSummary(firstLine.slice(0, 160));
    return typeof redacted === 'string' ? redacted : 'Output redacted';
  }

  private discoverCommandsFromSummary(summary: string): string[] {
    const known = [
      'exec',
      'review',
      'login',
      'logout',
      'mcp',
      'plugin',
      'debug',
      'features',
      'help',
      'status'
    ];
    return known.filter((command) => new RegExp(`\\b${command}\\b`, 'iu').test(summary));
  }

  private redactSummary(value: string): unknown {
    return redactSecrets(
      value
        .replace(/https?:\/\/[^\s"'`<>]+/giu, '[REDACTED]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]')
    );
  }

  private sanitizeEvidencePath(path: string): string {
    return path
      .split(/[\\/]/u)
      .map((segment) => {
        const redacted = this.redactSummary(segment);
        const safeSegment = typeof redacted === 'string' ? redacted : '[REDACTED]';
        if (safeSegment !== segment) return safeSegment;
        if (/[^\s]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(segment)) return '[REDACTED_EMAIL]';
        if (/(token|secret|session|credential|auth|bearer)[-_A-Z0-9.]*/iu.test(segment)) {
          return '[REDACTED_PATH_SEGMENT]';
        }
        if (/[A-Z0-9]{16,}/iu.test(segment)) return '[REDACTED_PATH_SEGMENT]';
        return segment;
      })
      .join('/');
  }

  async listCodexHomeFiles(codexHome: string): Promise<CodexHomeFileMetadata[]> {
    try {
      // Use string paths (no withFileTypes) to avoid Dirent.path behaviour differences
      // across Node versions (deprecated/changed in Node 23.2).
      const relativePaths = await readdir(codexHome, { recursive: true });
      const files = await Promise.all(
        relativePaths.map(async (relativePath) => {
          const absolutePath = join(codexHome, relativePath);
          const metadata = await stat(absolutePath);
          return {
            path: relativePath,
            type: metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other',
            mode: `0${(metadata.mode & 0o777).toString(8)}`
          } satisfies CodexHomeFileMetadata;
        })
      );
      return files.sort((left, right) => left.path.localeCompare(right.path));
    } catch {
      return [];
    }
  }
}
