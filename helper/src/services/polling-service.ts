import type {
  AccountQuotaCard,
  AccountStatus,
  ConfiguredAccount,
  ProviderId,
  QuotaWindow
} from '../domain/index.js';
import { normalizeEmail, statusFromError } from '../domain/index.js';
import { assignNoBrainerScores } from './nbs.js';
import {
  PROVIDER_POLL_DEFAULTS,
  ProviderCommandError,
  UnknownProviderError,
  type Clock,
  systemClock
} from '../providers/index.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ConfigStore, HistoryWriter, LatestStateStore } from '../storage/index.js';
import type { HistoryEntryContract, LatestStateContract } from '../validation/index.js';

export type AccountPollSummary = {
  accountId: string;
  provider: ProviderId;
  email: string;
  status: AccountStatus;
  success: boolean;
  staleMerged: boolean;
  historyEntriesWritten: number;
  errorHint?: string | null;
  skipped?: boolean;
};

export type PollSummary = {
  generatedAt: string;
  accountsConfigured: number;
  accountsPolled: number;
  successes: number;
  failures: number;
  skipped: number;
  staleMerged: number;
  historyEntriesWritten: number;
  accounts: AccountPollSummary[];
};

export type PollingServiceOptions = {
  configStore: ConfigStore;
  latestStateStore: LatestStateStore;
  historyWriter: HistoryWriter;
  providerRegistry: ProviderRegistry;
  clock?: Clock;
};

type AccountPollResult = {
  account: ConfiguredAccount;
  card: AccountQuotaCard;
  summary: AccountPollSummary;
  success: boolean;
  skipped: boolean;
  staleMerged: boolean;
  historyEntries: HistoryEntryContract[];
};

type PollSettings = {
  providerPollIntervalSeconds?: Partial<Record<ProviderId, number>>;
  providerPollMaxIntervalSeconds?: Partial<Record<ProviderId, number>>;
};

function accountKey(provider: ProviderId, email: string): string {
  return `${provider}:${normalizeEmail(email)}`;
}

function previousCardFor(
  previousLatest: LatestStateContract,
  account: ConfiguredAccount
): AccountQuotaCard | null {
  const key = accountKey(account.provider, account.email);
  return (
    previousLatest.accounts.find((card) => accountKey(card.provider, card.email) === key) ?? null
  );
}

function errorStatus(error: unknown): AccountStatus {
  if (error instanceof UnknownProviderError) return 'config_error';
  return statusFromError(error);
}

function errorHint(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function retryAfterSeconds(error: unknown, now: Date): number | null {
  if (!(error instanceof ProviderCommandError)) return null;
  const stderr = error.result.stderr;

  const notBeforeMatch = /not-before:\s*(.+)/iu.exec(stderr);
  if (notBeforeMatch) {
    const notBeforeMs = Date.parse(notBeforeMatch[1].trim());
    if (!Number.isNaN(notBeforeMs)) {
      const seconds = Math.ceil((notBeforeMs - now.getTime()) / 1000) + 2;
      return seconds > 0 ? seconds : null;
    }
  }

  const retryAfterMatch = /retry-after:\s*(\d+)/iu.exec(stderr);
  if (!retryAfterMatch) return null;
  const seconds = Number.parseInt(retryAfterMatch[1], 10);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

function isQuotaLimitHint(hint: string): boolean {
  return (
    /rate limit (state|reached|exceeded)/iu.test(hint) ||
    /rate limits response missing ratelimits/iu.test(hint)
  );
}

function effectiveErrorStatus(status: AccountStatus, hint: string): AccountStatus {
  return isQuotaLimitHint(hint) ? 'unavailable' : status;
}

function shouldMergePreviousAsStale(status: AccountStatus, hint: string): boolean {
  if (status === 'unavailable' || status === 'config_error') {
    return false;
  }
  return !isQuotaLimitHint(hint);
}

function failedCard(
  account: ConfiguredAccount,
  status: AccountStatus,
  attemptedAt: string,
  hint: string,
  previousCard: AccountQuotaCard | null
): { card: AccountQuotaCard; staleMerged: boolean } {
  if (previousCard && previousCard.windows.length > 0 && shouldMergePreviousAsStale(status, hint)) {
    return {
      staleMerged: true,
      card: {
        ...previousCard,
        status: 'stale',
        windows: previousCard.windows.map((window) => ({ ...window, status: 'stale' })),
        lastAttemptedRefreshAt: attemptedAt,
        stale: true,
        errorHint: hint
      }
    };
  }

  return {
    staleMerged: false,
    card: {
      provider: account.provider,
      email: account.email,
      displayOrder: account.displayOrder,
      status,
      windows: [],
      lastSuccessfulRefreshAt: null,
      lastAttemptedRefreshAt: attemptedAt,
      stale: false,
      errorHint: hint
    }
  };
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function accountMinPollIntervalSeconds(account: ConfiguredAccount, settings: PollSettings): number {
  return (
    readPositiveInteger(account.providerConfig?.pollIntervalSeconds) ??
    readPositiveInteger(account.providerConfig?.minPollIntervalSeconds) ??
    settings.providerPollIntervalSeconds?.[account.provider] ??
    PROVIDER_POLL_DEFAULTS[account.provider]?.minIntervalSeconds ??
    0
  );
}

function accountMaxPollIntervalSeconds(
  account: ConfiguredAccount,
  settings: PollSettings,
  minInterval: number
): number {
  const configured =
    readPositiveInteger(account.providerConfig?.pollMaxIntervalSeconds) ??
    readPositiveInteger(account.providerConfig?.maxPollIntervalSeconds) ??
    settings.providerPollMaxIntervalSeconds?.[account.provider] ??
    PROVIDER_POLL_DEFAULTS[account.provider]?.maxIntervalSeconds ??
    minInterval;
  return Math.max(configured, minInterval);
}

function accountBackoffRatio(account: ConfiguredAccount): number {
  return PROVIDER_POLL_DEFAULTS[account.provider]?.backoffRatio ?? 2;
}

function hasQuotaDataChanged(newWindows: QuotaWindow[], previousWindows: QuotaWindow[]): boolean {
  if (newWindows.length !== previousWindows.length) return true;
  const previousById = new Map(previousWindows.map((w) => [w.id, w]));
  for (const window of newWindows) {
    const previous = previousById.get(window.id);
    if (!previous) return true;
    if (previous.usedPercentage !== window.usedPercentage) return true;
    if (previous.status !== window.status) return true;
  }
  return false;
}

function computeNextPollIntervalSeconds(
  outcome: 'changed' | 'unchanged' | 'error',
  currentInterval: number,
  minInterval: number,
  maxInterval: number,
  ratio: number,
  retryAfter: number | null = null
): number {
  if (outcome === 'changed') return minInterval;
  if (retryAfter !== null) return Math.max(retryAfter, minInterval);
  return Math.min(Math.ceil(Math.max(currentInterval, minInterval) * ratio), maxInterval);
}

function withEffectiveInterval(card: AccountQuotaCard, nextInterval: number): AccountQuotaCard {
  if (nextInterval <= 0) return card;
  return { ...card, effectivePollIntervalSeconds: nextInterval };
}

function shouldSkipAccountPoll(
  previousCard: AccountQuotaCard | null,
  generatedAt: string,
  currentIntervalSeconds: number
): boolean {
  if (currentIntervalSeconds <= 0 || !previousCard?.lastAttemptedRefreshAt) return false;

  const lastAttemptedMillis = Date.parse(previousCard.lastAttemptedRefreshAt);
  const generatedMillis = Date.parse(generatedAt);
  if (Number.isNaN(lastAttemptedMillis) || Number.isNaN(generatedMillis)) return false;

  return generatedMillis - lastAttemptedMillis < currentIntervalSeconds * 1000;
}

function historyEntryFor(
  account: ConfiguredAccount,
  window: QuotaWindow,
  timestamp: string
): HistoryEntryContract {
  return {
    schemaVersion: '1',
    timestamp,
    provider: account.provider,
    email: account.email,
    quotaWindow: window.id,
    usedPercentage: window.usedPercentage,
    resetAt: window.resetAt,
    status: window.status
  };
}

function compareCards(left: AccountQuotaCard, right: AccountQuotaCard): number {
  if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
  const leftKey = accountKey(left.provider, left.email);
  const rightKey = accountKey(right.provider, right.email);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export class PollingService {
  private readonly configStore: ConfigStore;
  private readonly latestStateStore: LatestStateStore;
  private readonly historyWriter: HistoryWriter;
  private readonly providerRegistry: ProviderRegistry;
  private readonly clock: Clock;

  constructor(options: PollingServiceOptions) {
    this.configStore = options.configStore;
    this.latestStateStore = options.latestStateStore;
    this.historyWriter = options.historyWriter;
    this.providerRegistry = options.providerRegistry;
    this.clock = options.clock ?? systemClock;
  }

  async pollAll(): Promise<PollSummary> {
    const config = await this.configStore.load();
    const previousLatest = await this.latestStateStore.load();
    const generatedAt = this.clock.nowIso();
    const results = await Promise.all(
      config.accounts.map((account) =>
        this.pollAccount(account, previousLatest, generatedAt, config.settings)
      )
    );

    const cards = results.map((result) => result.card).sort(compareCards);
    const rankedCards = assignNoBrainerScores(cards, generatedAt);
    let historyEntriesWritten = 0;

    for (const result of results) {
      for (const historyEntry of result.historyEntries) {
        await this.historyWriter.append(historyEntry);
        historyEntriesWritten += 1;
      }
    }

    await this.latestStateStore.save({
      schemaVersion: '1',
      generatedAt,
      accounts: rankedCards
    });

    const successes = results.filter((result) => result.success).length;
    const skipped = results.filter((result) => result.skipped).length;
    const staleMergedCount = results.filter((result) => result.staleMerged).length;

    return {
      generatedAt,
      accountsConfigured: config.accounts.length,
      accountsPolled: config.accounts.length - skipped,
      successes,
      failures: config.accounts.length - skipped - successes,
      skipped,
      staleMerged: staleMergedCount,
      historyEntriesWritten,
      accounts: results.map((result) => result.summary)
    };
  }

  private async pollAccount(
    account: ConfiguredAccount,
    previousLatest: LatestStateContract,
    generatedAt: string,
    settings: PollSettings
  ): Promise<AccountPollResult> {
    const previousCard = previousCardFor(previousLatest, account);
    const minInterval = accountMinPollIntervalSeconds(account, settings);
    const maxInterval = accountMaxPollIntervalSeconds(account, settings, minInterval);
    const ratio = accountBackoffRatio(account);
    const currentInterval = previousCard?.effectivePollIntervalSeconds ?? minInterval;

    if (shouldSkipAccountPoll(previousCard, generatedAt, currentInterval) && previousCard) {
      return {
        account,
        card: withEffectiveInterval(previousCard, currentInterval),
        success: false,
        skipped: true,
        staleMerged: false,
        historyEntries: [],
        summary: {
          accountId: account.id,
          provider: account.provider,
          email: account.email,
          status: previousCard.status,
          success: false,
          skipped: true,
          staleMerged: false,
          historyEntriesWritten: 0,
          errorHint: previousCard.errorHint ?? null
        }
      };
    }

    try {
      const adapter = this.providerRegistry.get(account.provider);
      const quota = await adapter.fetchQuota(account);
      const card = await adapter.normaliseQuota(account, quota);
      const success = quota.status === 'fresh';

      let nextInterval: number;
      if (success) {
        const changed = hasQuotaDataChanged(card.windows, previousCard?.windows ?? []);
        nextInterval = computeNextPollIntervalSeconds(
          changed ? 'changed' : 'unchanged',
          currentInterval,
          minInterval,
          maxInterval,
          ratio
        );
      } else {
        nextInterval = computeNextPollIntervalSeconds(
          'error',
          currentInterval,
          minInterval,
          maxInterval,
          ratio
        );
      }

      const historyEntries = success
        ? card.windows.map((window) => historyEntryFor(account, window, generatedAt))
        : [];

      return {
        account,
        card: withEffectiveInterval(card, nextInterval),
        success,
        skipped: false,
        staleMerged: false,
        historyEntries,
        summary: {
          accountId: account.id,
          provider: account.provider,
          email: account.email,
          status: card.status,
          success,
          skipped: false,
          staleMerged: false,
          historyEntriesWritten: historyEntries.length,
          errorHint: card.errorHint ?? null
        }
      };
    } catch (error) {
      const hint = errorHint(error);
      const status = effectiveErrorStatus(errorStatus(error), hint);
      const { card, staleMerged } = failedCard(account, status, generatedAt, hint, previousCard);
      const nextInterval = computeNextPollIntervalSeconds(
        'error',
        currentInterval,
        minInterval,
        maxInterval,
        ratio,
        retryAfterSeconds(error, this.clock.now())
      );

      return {
        account,
        card: withEffectiveInterval(card, nextInterval),
        success: false,
        skipped: false,
        staleMerged,
        historyEntries: [],
        summary: {
          accountId: account.id,
          provider: account.provider,
          email: account.email,
          status: card.status,
          success: false,
          skipped: false,
          staleMerged,
          historyEntriesWritten: 0,
          errorHint: hint
        }
      };
    }
  }
}
