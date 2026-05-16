import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonAtomic } from '../../storage/index.js';

export type ClaudeStatusLineSnapshot = {
  schemaVersion: '1';
  provider: 'claude-code';
  email: string;
  capturedAt: string;
  sessionId: string | null;
  model: string | null;
  claudeCodeVersion: string | null;
  hasRateLimits: boolean;
  limits: ClaudeStatusLineSnapshotLimit[];
  rawSource: 'claude-code-statusline';
};

export type ClaudeStatusLineSnapshotLimit = {
  id: string;
  name: string;
  usedPercent: number | null;
  windowDurationMins: number;
  resetsAt: string | null;
};

type JsonObject = Record<string, unknown>;

export async function readStdinText(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function writeClaudeStatusLineSnapshot(input: {
  rawJson: string;
  email: string;
  snapshotFile: string;
  capturedAt?: string;
}): Promise<ClaudeStatusLineSnapshot> {
  const parsed = parseJsonObject(input.rawJson);
  const rateLimits = readObject(parsed.rate_limits) ?? readObject(parsed.rateLimits) ?? {};
  const snapshot: ClaudeStatusLineSnapshot = {
    schemaVersion: '1',
    provider: 'claude-code',
    email: input.email.trim().toLowerCase(),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    sessionId: readString(parsed.session_id) ?? readString(parsed.sessionId),
    model: readString(readObject(parsed.model)?.display_name) ?? readString(parsed.model),
    claudeCodeVersion: readString(parsed.version),
    hasRateLimits: Object.keys(rateLimits).length > 0,
    limits: [
      quotaWindowFromClaudeRateLimit(
        'claude-code:5h',
        '5-hour Claude Code limit',
        300,
        rateLimits.five_hour ?? rateLimits.fiveHour
      ),
      quotaWindowFromClaudeRateLimit(
        'claude-code:weekly',
        'Weekly Claude Code limit',
        10_080,
        rateLimits.seven_day ?? rateLimits.weekly ?? rateLimits.sevenDay
      )
    ],
    rawSource: 'claude-code-statusline'
  };

  await mkdir(dirname(input.snapshotFile), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(input.snapshotFile, snapshot, { mode: 0o600 });
  return snapshot;
}

export function formatClaudeStatusLine(snapshot: ClaudeStatusLineSnapshot): string {
  const fiveHour = snapshot.limits.find((window) => window.id === 'claude-code:5h');
  const weekly = snapshot.limits.find((window) => window.id === 'claude-code:weekly');
  return `Claude ${snapshot.email}: 5h ${formatPercent(fiveHour?.usedPercent)} | weekly ${formatPercent(weekly?.usedPercent)}`;
}

export async function readClaudeStatusLineSnapshot(
  snapshotFile: string
): Promise<ClaudeStatusLineSnapshot> {
  return JSON.parse(await readFile(snapshotFile, 'utf8')) as ClaudeStatusLineSnapshot;
}

function quotaWindowFromClaudeRateLimit(
  id: string,
  name: string,
  windowDurationMins: number,
  value: unknown
): ClaudeStatusLineSnapshotLimit {
  const object = readObject(value);
  return {
    id,
    name,
    usedPercent: readNumber(object?.used_percentage) ?? readNumber(object?.usedPercent),
    windowDurationMins,
    resetsAt: epochSecondsToIso(object?.resets_at) ?? toIsoString(object?.resetsAt)
  };
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readObject(parsed) ?? {};
  } catch {
    return {};
  }
}

function readObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function epochSecondsToIso(value: unknown): string | null {
  const number = readNumber(value);
  return number === null ? null : new Date(number * 1000).toISOString();
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : `${String(Math.round(value))}%`;
}
