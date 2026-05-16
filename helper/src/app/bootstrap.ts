import { DiagnosticsLogger } from '../diagnostics/index.js';
import {
  ClaudeCodeProviderAdapter,
  CodexDeviceAuthHarness,
  CodexProviderAdapter,
  FakeProviderAdapter,
  NodeCodexBrowserLoginProcessStarter,
  NodeCodexDeviceAuthProcessStarter,
  NodeProviderCommandRunner,
  ProviderRegistry
} from '../providers/index.js';
import {
  AuthService,
  ClaudeAuthService,
  CodexAuthService,
  NodeClaudeAuthProcessStarter,
  PollingService,
  ProviderCapabilitiesService,
  SetupFlowService
} from '../services/index.js';
import {
  ConfigStore,
  HistoryWriter,
  LatestStateStore,
  ProviderProfileStore,
  TokenStore,
  resolveAppPaths,
  type AppPathEnvironment,
  type AppPathOptions,
  type AppPaths
} from '../storage/index.js';

export type AppServices = {
  paths: AppPaths;
  configStore: ConfigStore;
  latestStateStore: LatestStateStore;
  historyWriter: HistoryWriter;
  tokenStore: TokenStore;
  providerProfileStore: ProviderProfileStore;
  logger: DiagnosticsLogger;
  providerRegistry: ProviderRegistry;
  authService: AuthService;
  providerCapabilitiesService: ProviderCapabilitiesService;
  setupFlowService: SetupFlowService;
  codexAuthService: CodexAuthService;
  claudeAuthService: ClaudeAuthService;
  pollingService: PollingService;
};

export function createAppServices(
  pathOptions: AppPathOptions = {},
  environment: AppPathEnvironment = process.env
): AppServices {
  const paths = resolveAppPaths(pathOptions, environment);
  const configStore = new ConfigStore(paths);
  const latestStateStore = new LatestStateStore(paths);
  const historyWriter = new HistoryWriter(paths);
  const tokenStore = new TokenStore(paths);
  const providerProfileStore = new ProviderProfileStore(paths);
  const logger = new DiagnosticsLogger(paths);
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new FakeProviderAdapter());
  providerRegistry.register(new CodexProviderAdapter());
  providerRegistry.register(new ClaudeCodeProviderAdapter());
  const authService = new AuthService(providerRegistry);
  const providerCommandRunner = new NodeProviderCommandRunner(logger);
  const providerCapabilitiesService = new ProviderCapabilitiesService(providerCommandRunner);
  const setupFlowService = new SetupFlowService({
    authService,
    configStore,
    tokenStore,
    logger,
    providerRegistry,
    providerProfileStore,
    providerCapabilitiesService
  });
  const codexAuthService = new CodexAuthService({
    paths,
    deviceHarness: new CodexDeviceAuthHarness({
      commandRunner: providerCommandRunner,
      processStarter: new NodeCodexDeviceAuthProcessStarter(),
      logger
    }),
    browserHarness: new CodexDeviceAuthHarness({
      commandRunner: providerCommandRunner,
      processStarter: new NodeCodexBrowserLoginProcessStarter(),
      logger
    }),
    commandRunner: providerCommandRunner,
    providerCapabilitiesService,
    providerProfileStore,
    logger
  });
  const claudeAuthService = new ClaudeAuthService({
    commandRunner: providerCommandRunner,
    processStarter: new NodeClaudeAuthProcessStarter(),
    providerProfileStore,
    logger
  });
  const pollingService = new PollingService({
    configStore,
    latestStateStore,
    historyWriter,
    providerRegistry
  });

  return {
    paths,
    configStore,
    latestStateStore,
    historyWriter,
    tokenStore,
    providerProfileStore,
    logger,
    providerRegistry,
    authService,
    providerCapabilitiesService,
    setupFlowService,
    codexAuthService,
    claudeAuthService,
    pollingService
  };
}
