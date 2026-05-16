import { redactSecrets } from '../diagnostics/index.js';
import { PROVIDER_IDS, providerDisplayName, type ProviderId } from '../domain/index.js';
import {
  ProviderCommandError,
  ProviderCommandNotFoundError,
  ProviderCommandTimeoutError,
  type ProviderCommandRunner
} from '../providers/index.js';

export type ProviderCapabilityStatus = 'usable' | 'not_implemented' | 'spike_required';
export type ProviderCliAvailabilityStatus =
  | 'available'
  | 'missing'
  | 'error'
  | 'timeout'
  | 'not_checked';

export type ProviderCliAvailability = {
  status: ProviderCliAvailabilityStatus;
  command: string | null;
  args: string[];
  shell: false;
  timeoutMs: number | null;
  version: string | null;
  errorType: string | null;
};

export type ProviderCapability = {
  provider: ProviderId;
  displayName: string;
  implemented: boolean;
  usable: boolean;
  status: ProviderCapabilityStatus;
  requirement: string;
  blockReason: string | null;
  cliAvailability: ProviderCliAvailability;
};

const CLI_CHECK_TIMEOUT_MS = 1_000;

function safeVersionLine(stdout: string): string | null {
  const version = stdout.trim().split(/\r?\n/u)[0]?.slice(0, 120);
  if (!version) return null;
  const redacted = redactSecrets(version);
  return typeof redacted === 'string' ? redacted : null;
}

export class ProviderCapabilitiesService {
  constructor(private readonly commandRunner?: ProviderCommandRunner) {}

  list(): ProviderCapability[] {
    return PROVIDER_IDS.map((provider) => this.get(provider));
  }

  async listWithCliAvailability(): Promise<ProviderCapability[]> {
    return Promise.all(PROVIDER_IDS.map((provider) => this.getWithCliAvailability(provider)));
  }

  get(provider: ProviderId): ProviderCapability {
    switch (provider) {
      case 'fake':
        return {
          provider,
          displayName: providerDisplayName(provider),
          implemented: true,
          usable: true,
          status: 'usable',
          requirement: 'Local fake provider; no external credentials required.',
          blockReason: null,
          cliAvailability: this.notCheckedCliAvailability(null)
        };
      case 'codex':
        return {
          provider,
          displayName: providerDisplayName(provider),
          implemented: true,
          usable: true,
          status: 'usable',
          requirement: 'Codex live quota provider; each account requires providerConfig.codexHome.',
          blockReason: null,
          cliAvailability: this.notCheckedCliAvailability(this.cliCommand(provider))
        };
      case 'claude-code':
        return this.blocked(
          provider,
          'Claude Code provider spike is required before implementation.'
        );
      case 'antigravity':
        return this.blocked(provider, 'Antigravity provider is not implemented in this MVP.');
    }
  }

  async getWithCliAvailability(provider: ProviderId): Promise<ProviderCapability> {
    const capability = this.get(provider);
    return {
      ...capability,
      cliAvailability: await this.checkCliAvailability(provider)
    };
  }

  assertUsable(provider: ProviderId): void {
    const capability = this.get(provider);
    if (!capability.usable) {
      throw new Error(capability.blockReason ?? `Provider is not usable: ${provider}`);
    }
  }

  private blocked(provider: ProviderId, blockReason: string): ProviderCapability {
    return {
      provider,
      displayName: providerDisplayName(provider),
      implemented: false,
      usable: false,
      status: provider === 'antigravity' ? 'not_implemented' : 'spike_required',
      requirement: blockReason,
      blockReason,
      cliAvailability: this.notCheckedCliAvailability(this.cliCommand(provider))
    };
  }

  private cliCommand(provider: ProviderId): string | null {
    switch (provider) {
      case 'codex':
        return 'codex';
      case 'claude-code':
        return 'claude';
      case 'fake':
      case 'antigravity':
        return null;
    }
  }

  private notCheckedCliAvailability(command: string | null): ProviderCliAvailability {
    return {
      status: 'not_checked',
      command,
      args: command ? ['--version'] : [],
      shell: false,
      timeoutMs: command ? CLI_CHECK_TIMEOUT_MS : null,
      version: null,
      errorType: null
    };
  }

  private async checkCliAvailability(provider: ProviderId): Promise<ProviderCliAvailability> {
    const command = this.cliCommand(provider);
    const base = this.notCheckedCliAvailability(command);
    if (!command || !this.commandRunner) return base;

    try {
      const result = await this.commandRunner.run({
        command,
        args: ['--version'],
        timeoutMs: CLI_CHECK_TIMEOUT_MS,
        shell: false
      });
      return {
        ...base,
        status: 'available',
        version: safeVersionLine(result.stdout)
      };
    } catch (error) {
      if (error instanceof ProviderCommandNotFoundError) {
        return { ...base, status: 'missing', errorType: error.name };
      }
      if (error instanceof ProviderCommandTimeoutError) {
        return { ...base, status: 'timeout', errorType: error.name };
      }
      if (error instanceof ProviderCommandError) {
        return { ...base, status: 'error', errorType: error.name };
      }
      return { ...base, status: 'error', errorType: 'Error' };
    }
  }
}
