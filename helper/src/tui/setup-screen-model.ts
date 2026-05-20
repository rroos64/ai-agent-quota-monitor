import type { ConfiguredAccount } from '../domain/index.js';
import { ProviderCapabilitiesService, type ProviderCapability } from '../services/index.js';
import type { AppPaths } from '../storage/index.js';

export type SetupScreenModel = {
  title: string;
  accountCount: number;
  accounts: { provider: string; email: string; displayOrder: number; displayName?: string }[];
  providers: ProviderCapability[];
  paths: {
    dataDir: string;
    cacheDir: string;
    latestStateFile: string;
  };
  instructions: string[];
};

function formatCliAvailability(provider: ProviderCapability): string {
  const cli = provider.cliAvailability;
  if (!cli.command) return 'CLI: n/a';
  const version = cli.version ? ` (${cli.version})` : '';
  return `CLI ${cli.command}: ${cli.status}${version}`;
}

export function formatSetupScreenModel(model: SetupScreenModel): string {
  const accountLines =
    model.accounts.length === 0
      ? ['No accounts configured.']
      : model.accounts.map(
          (account) => `${account.provider}:${account.email} order=${String(account.displayOrder)}`
        );

  return [
    model.title,
    `Configured accounts: ${String(model.accountCount)}`,
    `Data: ${model.paths.dataDir}`,
    `Cache: ${model.paths.cacheDir}`,
    `Latest: ${model.paths.latestStateFile}`,
    '',
    'Accounts',
    ...accountLines,
    '',
    'Providers',
    ...model.providers.map(
      (provider) =>
        `${provider.displayName}: ${provider.usable ? 'usable' : 'blocked'} - ${provider.requirement} (${formatCliAvailability(provider)})`
    ),
    '',
    'Next steps',
    ...model.instructions
  ].join('\n');
}

export function buildSetupScreenModel(
  accounts: ConfiguredAccount[],
  paths: AppPaths,
  providers: ProviderCapability[] = new ProviderCapabilitiesService().list()
): SetupScreenModel {
  return {
    title: 'AI Agent Quota Monitor Setup',
    accountCount: accounts.length,
    accounts: accounts
      .map((account) => ({
        provider: account.provider,
        email: account.email,
        displayOrder: account.displayOrder,
        displayName:
          typeof account.providerConfig?.displayName === 'string'
            ? account.providerConfig.displayName
            : undefined
      }))
      .sort((left, right) => {
        if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
        const leftKey = `${left.provider}:${left.email}`;
        const rightKey = `${right.provider}:${right.email}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
    providers,
    paths: {
      dataDir: paths.dataDir,
      cacheDir: paths.cacheDir,
      latestStateFile: paths.latestStateFile
    },
    instructions: [
      'Press o to add a Codex/OpenAI account using AIQM-owned browser login, quota test, and optional poll.',
      'Press a to add a Claude/Anthropic account using AIQM-owned browser login and passive statusLine quota capture.',
      'Flow: email → display name → start auth → poll status → save → test quota → optional poll.',
      'No tokens or provider secrets are displayed in the TUI.',
      'Use r/refresh to force-refresh the selected account; this bypasses local back-off/rate-limit spacing for that account.',
      'Use h/refres(h)-all or type refresh-all then Enter to force-refresh all accounts; use sparingly because providers may rate limit repeated polling.',
      'Press a only for the development fake-provider flow.',
      'Development fake setup also works non-interactively:',
      'aiqm setup --provider fake --email <email> --scenario success --poll',
      'Press q or Ctrl+C to quit.'
    ]
  };
}
