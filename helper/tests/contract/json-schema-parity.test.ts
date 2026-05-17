// Provenance: docs/test-traceability.md — Domain contracts area
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  historyEntrySchema,
  latestStateSchema,
  tokenFileSchema
} from '../../src/validation/index.js';

const contractsDir = resolve(import.meta.dirname, '../../../contracts/v1');
const now = '2026-05-09T12:00:00.000Z';
const offsetNow = '2026-05-09T14:00:00+02:00';

const fixtures = {
  config: {
    schemaVersion: '1',
    accounts: [
      {
        id: 'codex:dev@example.com',
        provider: 'codex',
        email: 'dev@example.com',
        displayOrder: 0,
        providerConfig: { profile: 'default' },
        createdAt: offsetNow,
        updatedAt: now
      }
    ],
    settings: {
      refreshIntervalMinutes: 5,
      setupCommand: 'aiqm setup',
      providerPollIntervalSeconds: { codex: 60, 'claude-code': 1800 }
    }
  },
  latestState: {
    schemaVersion: '1',
    generatedAt: offsetNow,
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
            resetAt: offsetNow,
            resetInText: 'in 2 days',
            status: 'fresh',
            hint: null
          }
        ],
        lastSuccessfulRefreshAt: now,
        lastAttemptedRefreshAt: offsetNow,
        stale: false,
        errorHint: null
      }
    ]
  },
  tokenFile: {
    schemaVersion: '1',
    tokens: [
      {
        schemaVersion: '1',
        accountId: 'codex:dev@example.com',
        provider: 'codex',
        email: 'dev@example.com',
        createdAt: now,
        updatedAt: offsetNow,
        tokenType: 'fake',
        tokenPayload: { accessToken: 'secret' }
      }
    ]
  },
  historyEntry: {
    schemaVersion: '1',
    timestamp: offsetNow,
    provider: 'codex',
    email: 'dev@example.com',
    quotaWindow: 'weekly',
    usedPercentage: null,
    resetAt: offsetNow,
    status: 'fresh'
  }
} as const;

async function loadJsonSchema(fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(contractsDir, fileName), 'utf8')) as unknown;
}

// Traceability: BR: desklet/helper contract compatibility; AC: JSON Schema and Zod accept representative v1 fixtures; TS: contracts/v1 parity.
describe('JSON Schema and Zod contract parity', () => {
  it.each([
    ['config.schema.json', fixtures.config, appConfigSchema],
    ['latest-state.schema.json', fixtures.latestState, latestStateSchema],
    ['token-record.schema.json', fixtures.tokenFile, tokenFileSchema],
    ['history-entry.schema.json', fixtures.historyEntry, historyEntrySchema]
  ])(
    'accepts a representative %s fixture with Ajv and Zod',
    async (schemaFile, fixture, zodSchema) => {
      const ajv = new Ajv2020({ strict: true });
      addFormats(ajv);
      const validate = ajv.compile(await loadJsonSchema(schemaFile));

      expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
      expect(zodSchema.safeParse(fixture).success).toBe(true);
    }
  );
});
