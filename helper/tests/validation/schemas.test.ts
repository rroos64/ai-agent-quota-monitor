// Provenance: docs/test-traceability.md — Domain contracts area
import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  historyEntrySchema,
  latestStateSchema,
  tokenFileSchema
} from '../../src/validation/index.js';

const now = '2026-05-09T12:00:00.000Z';
const offsetDateTime = '2026-05-09T14:00:00+02:00';

// Traceability: BR: validated local contracts; AC: reject malformed config/latest/token/history data; TS: TSD §9 storage contracts.
describe('runtime validation schemas', () => {
  it('accepts a valid app config and rejects duplicate provider/email accounts', () => {
    const validConfig = {
      schemaVersion: '1',
      accounts: [
        {
          id: 'codex:dev@example.com',
          provider: 'codex',
          email: 'dev@example.com',
          displayOrder: 0,
          providerConfig: { profile: 'default' },
          createdAt: now,
          updatedAt: now
        }
      ],
      settings: {
        refreshIntervalMinutes: 5,
        setupCommand: 'aiqm setup',
        providerPollIntervalSeconds: { codex: 60, 'claude-code': 1800 }
      }
    };

    expect(appConfigSchema.safeParse(validConfig).success).toBe(true);
    expect(
      appConfigSchema.safeParse({
        ...validConfig,
        accounts: [
          validConfig.accounts[0],
          { ...validConfig.accounts[0], id: 'codex:DEV@example.com', email: 'DEV@example.com' }
        ]
      }).success
    ).toBe(false);
  });

  it('rejects duplicate account ids', () => {
    const account = {
      id: 'codex:dev@example.com',
      provider: 'codex',
      email: 'dev@example.com',
      displayOrder: 0,
      createdAt: now,
      updatedAt: now
    };

    expect(
      appConfigSchema.safeParse({
        schemaVersion: '1',
        accounts: [account, { ...account, email: 'other@example.com', displayOrder: 1 }],
        settings: { refreshIntervalMinutes: 5 }
      }).success
    ).toBe(false);
  });

  it('accepts RFC3339 date-time values with offsets', () => {
    expect(
      latestStateSchema.safeParse({
        schemaVersion: '1',
        generatedAt: offsetDateTime,
        accounts: []
      }).success
    ).toBe(true);

    expect(
      historyEntrySchema.safeParse({
        schemaVersion: '1',
        timestamp: offsetDateTime,
        provider: 'codex',
        email: 'dev@example.com',
        quotaWindow: 'weekly',
        usedPercentage: null,
        resetAt: offsetDateTime,
        status: 'fresh'
      }).success
    ).toBe(true);
  });

  it('accepts configurable positive refresh intervals and rejects invalid config values', () => {
    expect(
      appConfigSchema.safeParse({
        schemaVersion: '1',
        accounts: [],
        settings: { refreshIntervalMinutes: 10, providerPollIntervalSeconds: { codex: 60 } }
      }).success
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({
        schemaVersion: '1',
        accounts: [],
        settings: { refreshIntervalMinutes: 0 }
      }).success
    ).toBe(false);
    expect(
      appConfigSchema.safeParse({
        schemaVersion: '1',
        accounts: [],
        settings: { refreshIntervalMinutes: 10, providerPollIntervalSeconds: { codex: 29 } }
      }).success
    ).toBe(false);
  });

  it('accepts valid latest state and rejects invalid quota percentages', () => {
    const validLatest = {
      schemaVersion: '1',
      generatedAt: now,
      accounts: [
        {
          provider: 'codex',
          email: 'dev@example.com',
          displayOrder: 0,
          status: 'fresh',
          windows: [
            {
              id: 'weekly',
              providerWindowName: 'Weekly',
              usedPercentage: 42,
              resetAt: now,
              resetInText: 'in 2 days',
              status: 'fresh',
              hint: null
            }
          ],
          lastSuccessfulRefreshAt: now,
          lastAttemptedRefreshAt: now,
          stale: false,
          errorHint: null
        }
      ]
    };

    expect(latestStateSchema.safeParse(validLatest).success).toBe(true);
    expect(
      latestStateSchema.safeParse({
        ...validLatest,
        accounts: [
          {
            ...validLatest.accounts[0],
            windows: [{ ...validLatest.accounts[0].windows[0], usedPercentage: 101 }]
          }
        ]
      }).success
    ).toBe(false);
  });

  it('accepts a token file while keeping token payload provider-specific', () => {
    expect(
      tokenFileSchema.safeParse({
        schemaVersion: '1',
        tokens: [
          {
            schemaVersion: '1',
            accountId: 'codex:dev@example.com',
            provider: 'codex',
            email: 'dev@example.com',
            createdAt: now,
            updatedAt: now,
            tokenType: 'fake',
            tokenPayload: { accessToken: 'secret' }
          }
        ]
      }).success
    ).toBe(true);
  });

  it('accepts valid history entries and rejects extra properties', () => {
    const validHistoryEntry = {
      schemaVersion: '1',
      timestamp: now,
      provider: 'codex',
      email: 'dev@example.com',
      quotaWindow: 'weekly',
      usedPercentage: null,
      resetAt: null,
      status: 'unavailable'
    };

    expect(historyEntrySchema.safeParse(validHistoryEntry).success).toBe(true);
    expect(
      historyEntrySchema.safeParse({
        ...validHistoryEntry,
        tokenPayload: { accessToken: 'secret' }
      }).success
    ).toBe(false);
  });
});
