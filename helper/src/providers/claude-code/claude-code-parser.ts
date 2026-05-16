import type {
  AccountValidationResult,
  ProviderQuotaResult,
  ProviderQuotaWindowResult
} from '../../domain/index.js';
import { AuthRequiredError } from '../../domain/index.js';
import { ProviderShapeChangedError } from '../base/index.js';
import { CLAUDE_CODE_PROVIDER_ID } from './claude-code-provider-adapter.js';

type ParseOptions = {
  accountEmail: string;
  fetchedAt: string;
};

type AuthStatusOptions = {
  expectedEmail: string;
};

type JsonObject = Record<string, unknown>;

type ClaudeWindow = {
  id: string | null;
  name: string | null;
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: unknown;
};

export function parseClaudeCodeAuthStatusResponse(
  input: unknown,
  options: AuthStatusOptions
): AccountValidationResult {
  const root = asObject(input, 'Claude Code auth status response');
  const loggedIn = readBoolean(root.loggedIn);
  if (loggedIn === false) {
    throw new AuthRequiredError('Claude Code authentication is required');
  }
  if (loggedIn !== true) {
    throw new ProviderShapeChangedError('Claude Code auth status missing loggedIn');
  }

  const actualEmail = readNullableString(root.email);
  return {
    provider: CLAUDE_CODE_PROVIDER_ID,
    expectedEmail: options.expectedEmail,
    actualEmail,
    matches: normalizeEmail(actualEmail) === normalizeEmail(options.expectedEmail),
    canReadQuota: true,
    hint: readNullableString(root.subscriptionType)
  };
}

export function parseClaudeCodeQuotaResponse(
  input: unknown,
  options: ParseOptions
): ProviderQuotaResult {
  const root = asObject(input, 'Claude Code quota response');
  throwIfAuthRequired(root);

  const windows = toQuotaWindows(readWindowArray(root));
  if (windows.length === 0) {
    throw new ProviderShapeChangedError('Claude Code quota response did not contain quota windows');
  }

  const rateLimitReached = readBoolean(root.rateLimitReached) ?? readBoolean(root.limitReached);
  const status = rateLimitReached ? 'unavailable' : 'fresh';
  return {
    provider: CLAUDE_CODE_PROVIDER_ID,
    accountEmail: options.accountEmail,
    fetchedAt: options.fetchedAt,
    status,
    windows,
    errorHint: status === 'fresh' ? null : 'Claude Code quota limit reached',
    rawMetadata: safeMetadata(root)
  };
}

function throwIfAuthRequired(root: JsonObject): void {
  const status = readString(root.status);
  if (status === 'auth_required' || status === 'unauthenticated' || status === 'unauthorized') {
    throw new AuthRequiredError('Claude Code authentication is required to read quota');
  }

  const error = readObject(root.error);
  const code = readString(error?.code);
  const type = readString(error?.type);
  if (
    code === 'auth_required' ||
    code === 'unauthenticated' ||
    code === 'unauthorized' ||
    type === 'authentication_error'
  ) {
    throw new AuthRequiredError('Claude Code authentication is required to read quota');
  }
}

function readWindowArray(root: JsonObject): ClaudeWindow[] {
  const oauthWindows = readOAuthUsageWindows(root);
  if (oauthWindows) return oauthWindows;

  const candidate = readArray(root.limits) ?? readArray(root.rateLimits) ?? readArray(root.windows);
  if (!candidate) {
    throw new ProviderShapeChangedError('Claude Code quota response missing limits');
  }
  return candidate.map(parseWindow);
}

function readOAuthUsageWindows(root: JsonObject): ClaudeWindow[] | null {
  const fiveHour = readObject(root.five_hour);
  const sevenDay = readObject(root.seven_day);
  if (!fiveHour && !sevenDay) return null;

  const windows: ClaudeWindow[] = [];
  if (fiveHour) {
    windows.push(
      parseOAuthUsageWindow(fiveHour, {
        id: 'claude-code:5h',
        name: '5-hour Claude Code limit',
        windowDurationMins: 300
      })
    );
  }
  if (sevenDay) {
    windows.push(
      parseOAuthUsageWindow(sevenDay, {
        id: 'claude-code:weekly',
        name: 'Weekly Claude Code limit',
        windowDurationMins: 10_080
      })
    );
  }

  const sevenDaySonnet = readObject(root.seven_day_sonnet);
  if (sevenDaySonnet) {
    windows.push(
      parseOAuthUsageWindow(sevenDaySonnet, {
        id: 'claude-code:weekly-sonnet',
        name: 'Weekly Claude Code Sonnet limit',
        windowDurationMins: 10_080
      })
    );
  }

  const sevenDayOpus = readObject(root.seven_day_opus);
  if (sevenDayOpus) {
    windows.push(
      parseOAuthUsageWindow(sevenDayOpus, {
        id: 'claude-code:weekly-opus',
        name: 'Weekly Claude Code Opus limit',
        windowDurationMins: 10_080
      })
    );
  }

  return windows;
}

function parseOAuthUsageWindow(
  window: JsonObject,
  defaults: { id: string; name: string; windowDurationMins: number }
): ClaudeWindow {
  const usedPercent = readNullableNumber(
    window.utilization,
    'Claude OAuth usage window utilization'
  );
  if (usedPercent !== null && !Number.isFinite(usedPercent)) {
    throw new ProviderShapeChangedError('Claude OAuth usage window utilization is invalid');
  }

  return {
    id: defaults.id,
    name: defaults.name,
    usedPercent,
    windowDurationMins: defaults.windowDurationMins,
    resetsAt: window.resets_at ?? null
  };
}

function parseWindow(value: unknown): ClaudeWindow {
  const window = asObject(value, 'Claude Code quota window');
  const usedPercent = readNullableNumber(
    window.usedPercent ?? window.usedPercentage ?? window.usagePercent ?? window.used,
    'Claude Code quota window usedPercent'
  );
  if (usedPercent !== null && !Number.isFinite(usedPercent)) {
    throw new ProviderShapeChangedError('Claude Code quota window usedPercent is invalid');
  }

  return {
    id: readNullableString(window.id),
    name: readNullableString(window.name) ?? readNullableString(window.providerWindowName),
    usedPercent,
    windowDurationMins: readNullableNumber(
      window.windowDurationMins,
      'Claude Code quota window windowDurationMins'
    ),
    resetsAt: window.resetsAt ?? window.resetAt ?? null
  };
}

function toQuotaWindows(windows: ClaudeWindow[]): ProviderQuotaWindowResult[] {
  return windows.map((window, index) => ({
    id: window.id ?? windowId(window, index),
    providerWindowName: window.name ?? windowLabel(window, index),
    usedPercentage: window.usedPercent,
    resetAt: toIsoReset(window.resetsAt),
    hint: null
  }));
}

function windowId(window: ClaudeWindow, index: number): string {
  const duration = durationSlug(window.windowDurationMins);
  return `claude-code:${duration ?? String(index + 1)}`;
}

function windowLabel(window: ClaudeWindow, index: number): string {
  const duration = labelFromDuration(window.windowDurationMins);
  if (duration) return duration;
  return `Claude Code limit ${String(index + 1)}`;
}

function labelFromDuration(durationMins: number | null): string | null {
  if (durationMins === null) return null;
  if (durationMins === 300) return '5-hour Claude Code limit';
  if (durationMins === 10_080) return 'Weekly Claude Code limit';
  if (durationMins % 1_440 === 0) return `${String(durationMins / 1_440)}-day Claude Code limit`;
  if (durationMins % 60 === 0) return `${String(durationMins / 60)}-hour Claude Code limit`;
  return `${String(durationMins)}-minute Claude Code limit`;
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
      throw new ProviderShapeChangedError('Claude Code quota window resetsAt is invalid');
    }
    return date.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return timestampToIso(value);
  throw new ProviderShapeChangedError('Claude Code quota window resetsAt is invalid');
}

function timestampToIso(value: number): string {
  const millis = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderShapeChangedError('Claude Code quota window resetsAt is invalid');
  }
  return date.toISOString();
}

function safeMetadata(root: JsonObject): Record<string, unknown> {
  const account = readObject(root.account);
  return {
    subscriptionType: readNullableString(account?.subscriptionType ?? root.subscriptionType),
    rateLimitReached: readBoolean(root.rateLimitReached) ?? readBoolean(root.limitReached) ?? false
  };
}

function asObject(value: unknown, label: string): JsonObject {
  const object = readObject(value);
  if (!object) throw new ProviderShapeChangedError(`${label} is not an object`);
  return object;
}

function readObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
}

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') throw new ProviderShapeChangedError(`${label} is not a number`);
  return value;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeEmail(value: string | null): string | null {
  return value?.trim().toLowerCase() ?? null;
}
