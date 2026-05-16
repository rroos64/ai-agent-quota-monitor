import type {
  AccountStatus,
  ProviderQuotaResult,
  ProviderQuotaWindowResult
} from '../../domain/index.js';
import { AuthRequiredError } from '../../domain/index.js';
import { ProviderShapeChangedError } from '../base/index.js';
import { CODEX_PROVIDER_ID } from './codex-provider-adapter.js';

type ParseOptions = {
  accountEmail: string;
  fetchedAt: string;
};

type JsonObject = Record<string, unknown>;

type CodexRateLimitWindow = {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: unknown;
};

type CodexCreditsSnapshot = {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string | null;
};

type CodexRateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: CodexCreditsSnapshot | null;
  planType: string | null;
  rateLimitReachedType: string | null;
};

export function parseCodexRateLimitsResponse(
  input: unknown,
  options: ParseOptions
): ProviderQuotaResult {
  const root = asObject(input, 'Codex rate limits response');
  throwIfAuthRequired(root);

  const snapshot = selectRateLimitSnapshot(root);
  const windows = toQuotaWindows(snapshot);
  if (windows.length === 0) {
    throw new ProviderShapeChangedError('Codex rate limits response did not contain quota windows');
  }

  const status = statusFromSnapshot(snapshot);
  return {
    provider: CODEX_PROVIDER_ID,
    accountEmail: options.accountEmail,
    fetchedAt: options.fetchedAt,
    status,
    windows,
    errorHint: status === 'fresh' ? null : hintFromSnapshot(snapshot),
    rawMetadata: safeMetadata(snapshot)
  };
}

function throwIfAuthRequired(root: JsonObject): void {
  const status = readString(root.status);
  if (status === 'auth_required' || status === 'unauthenticated') {
    throw new AuthRequiredError('Codex authentication is required to read rate limits');
  }

  const error = readObject(root.error);
  const code = readString(error?.code);
  const message = readString(error?.message);
  if (
    code === 'auth_required' ||
    code === 'unauthenticated' ||
    code === 'unauthorized' ||
    code === 'token_invalidated' ||
    /401 Unauthorized/iu.test(message ?? '') ||
    /authentication token has been invalidated/iu.test(message ?? '') ||
    /authentication required/iu.test(message ?? '')
  ) {
    throw new AuthRequiredError(
      'Codex authentication token has been invalidated; re-login required'
    );
  }
}

function selectRateLimitSnapshot(root: JsonObject): CodexRateLimitSnapshot {
  const byLimitId = readObject(root.rateLimitsByLimitId);
  const codexBucket = findCodexBucket(byLimitId);
  if (codexBucket) return parseSnapshot(codexBucket);

  const legacySnapshot = readObject(root.rateLimits);
  if (!legacySnapshot) {
    throw new ProviderShapeChangedError('Codex rate limits response missing rateLimits');
  }
  return parseSnapshot(legacySnapshot);
}

function findCodexBucket(byLimitId: JsonObject | null): JsonObject | null {
  if (!byLimitId) return null;

  const exact = readObject(byLimitId.codex);
  if (exact) return exact;

  for (const [key, value] of Object.entries(byLimitId)) {
    if (key.toLowerCase().includes('codex')) {
      const bucket = readObject(value);
      if (bucket) return bucket;
    }
  }

  return null;
}

function parseSnapshot(value: JsonObject): CodexRateLimitSnapshot {
  return {
    limitId: readNullableString(value.limitId),
    limitName: readNullableString(value.limitName),
    primary: parseWindow(value.primary, 'primary'),
    secondary: parseWindow(value.secondary, 'secondary'),
    credits: parseCredits(value.credits),
    planType: readNullableString(value.planType) ?? readNullableString(value.chatgptPlanType),
    rateLimitReachedType: readNullableString(value.rateLimitReachedType)
  };
}

function parseWindow(value: unknown, name: string): CodexRateLimitWindow | null {
  if (value === null || value === undefined) return null;
  const window = asObject(value, `Codex ${name} rate limit window`);
  const usedPercent = readNullableNumber(
    window.usedPercent,
    `Codex ${name} rate limit usedPercent`
  );
  const windowDurationMins = readNullableNumber(
    window.windowDurationMins,
    `Codex ${name} rate limit windowDurationMins`
  );

  if (usedPercent === null && windowDurationMins === null && window.resetsAt === undefined) {
    return null;
  }

  if (usedPercent !== null && !Number.isFinite(usedPercent)) {
    throw new ProviderShapeChangedError(`Codex ${name} rate limit usedPercent is invalid`);
  }

  return {
    usedPercent,
    windowDurationMins,
    resetsAt: window.resetsAt ?? null
  };
}

function parseCredits(value: unknown): CodexCreditsSnapshot | null {
  if (value === null || value === undefined) return null;
  const credits = asObject(value, 'Codex credits snapshot');
  const hasCredits = readBoolean(credits.hasCredits);
  const unlimited = readBoolean(credits.unlimited);
  if (hasCredits === null || unlimited === null) {
    throw new ProviderShapeChangedError('Codex credits snapshot missing hasCredits/unlimited');
  }

  return {
    hasCredits,
    unlimited,
    balance: readNullableString(credits.balance)
  };
}

function toQuotaWindows(snapshot: CodexRateLimitSnapshot): ProviderQuotaWindowResult[] {
  const entries: [name: 'primary' | 'secondary', window: CodexRateLimitWindow | null][] = [
    ['primary', snapshot.primary],
    ['secondary', snapshot.secondary]
  ];

  return entries.flatMap(([name, window]) => {
    if (!window) return [];
    return [
      {
        id: windowId(snapshot, window, name),
        providerWindowName: windowLabel(snapshot, window, name),
        usedPercentage: window.usedPercent,
        resetAt: toIsoReset(window.resetsAt),
        hint: windowHint(snapshot)
      }
    ];
  });
}

function windowId(
  snapshot: CodexRateLimitSnapshot,
  window: CodexRateLimitWindow,
  name: 'primary' | 'secondary'
): string {
  const bucket = slug(snapshot.limitId ?? snapshot.limitName ?? 'codex');
  const duration = durationSlug(window.windowDurationMins);
  return `${bucket}:${duration ?? name}`;
}

function windowLabel(
  snapshot: CodexRateLimitSnapshot,
  window: CodexRateLimitWindow,
  name: 'primary' | 'secondary'
): string {
  const explicit = snapshot.limitName?.trim();
  const durationLabel = labelFromDuration(window.windowDurationMins) ?? labelFromName(explicit);
  if (durationLabel) return durationLabel;
  if (explicit) return `${explicit} ${name} limit`;
  return `Codex ${name} limit`;
}

function labelFromDuration(durationMins: number | null): string | null {
  if (durationMins === null) return null;
  if (durationMins === 300) return '5-hour Codex limit';
  if (durationMins === 10_080) return 'Weekly Codex limit';
  if (durationMins % 1_440 === 0) return `${String(durationMins / 1_440)}-day Codex limit`;
  if (durationMins % 60 === 0) return `${String(durationMins / 60)}-hour Codex limit`;
  return `${String(durationMins)}-minute Codex limit`;
}

function labelFromName(name: string | undefined): string | null {
  const normalized = name?.toLowerCase() ?? '';
  if (normalized.includes('5-hour') || normalized.includes('5 hour')) return '5-hour Codex limit';
  if (normalized.includes('weekly') || normalized.includes('week')) return 'Weekly Codex limit';
  return null;
}

function durationSlug(durationMins: number | null): string | null {
  if (durationMins === null) return null;
  if (durationMins === 300) return '5h';
  if (durationMins === 10_080) return 'weekly';
  return `${String(durationMins)}m`;
}

function toIsoReset(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const millis = Number(value);
    if (Number.isFinite(millis)) return timestampToIso(millis);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ProviderShapeChangedError('Codex rate limit resetsAt is invalid');
    }
    return date.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return timestampToIso(value);
  throw new ProviderShapeChangedError('Codex rate limit resetsAt is invalid');
}

function timestampToIso(value: number): string {
  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderShapeChangedError('Codex rate limit resetsAt is invalid');
  }
  return date.toISOString();
}

function statusFromSnapshot(snapshot: CodexRateLimitSnapshot): AccountStatus {
  if (snapshot.rateLimitReachedType) return 'unavailable';
  return 'fresh';
}

function hintFromSnapshot(snapshot: CodexRateLimitSnapshot): string | null {
  return snapshot.rateLimitReachedType
    ? `Codex rate limit state: ${snapshot.rateLimitReachedType}`
    : null;
}

function windowHint(snapshot: CodexRateLimitSnapshot): string | null {
  if (snapshot.rateLimitReachedType) return snapshot.rateLimitReachedType;
  return null;
}

function safeMetadata(snapshot: CodexRateLimitSnapshot): Record<string, unknown> {
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    planType: snapshot.planType,
    credits: snapshot.credits
      ? {
          hasCredits: snapshot.credits.hasCredits,
          unlimited: snapshot.credits.unlimited,
          balancePresent:
            snapshot.credits.balance !== null && snapshot.credits.balance !== undefined,
          creditsExhausted: !snapshot.credits.unlimited && !snapshot.credits.hasCredits
        }
      : null,
    rateLimitReachedType: snapshot.rateLimitReachedType
  };
}

function asObject(value: unknown, label: string): JsonObject {
  const object = readObject(value);
  if (!object) throw new ProviderShapeChangedError(`${label} was not an object`);
  return object;
}

function readObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value === null || value === undefined || typeof value === 'string'
    ? (value ?? null)
    : null;
}

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  throw new ProviderShapeChangedError(`${label} was not a number`);
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function slug(value: string): string {
  const slugged = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slugged || 'codex';
}
