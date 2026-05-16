// Provenance: docs/test-traceability.md — Providers area
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthRequiredError } from '../../src/domain/index.js';
import {
  parseCodexRateLimitsResponse,
  ProviderShapeChangedError
} from '../../src/providers/index.js';

const fetchedAt = '2026-05-13T12:00:00.000Z';
const accountEmail = 'dev@example.com';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

function parse(input: unknown) {
  return parseCodexRateLimitsResponse(input, { accountEmail, fetchedAt });
}

function fixture(): unknown {
  const path = resolve(
    process.cwd(),
    '../fixtures/providers/codex/quota-success.redacted.example.json'
  );
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// Traceability: CODEX-RATELIMIT-PARSER-001 parser-only fixture mapping for discovered app-server account/rateLimits/read schema; no live Codex command or adapter enablement.
describe('parseCodexRateLimitsResponse', () => {
  it('normalizes the redacted app-server rate limit fixture into ProviderQuotaResult windows', () => {
    const result = parse(fixture());

    expect(result).toMatchObject({
      provider: 'codex',
      accountEmail,
      fetchedAt,
      status: 'fresh',
      windows: [
        {
          id: 'codex:5h',
          providerWindowName: '5-hour Codex limit',
          usedPercentage: 42,
          resetAt: '2026-05-13T14:30:00.000Z',
          hint: null
        },
        {
          id: 'codex:weekly',
          providerWindowName: 'Weekly Codex limit',
          usedPercentage: 68,
          resetAt: '2026-05-17T14:30:00.000Z',
          hint: null
        }
      ]
    });
    expect(result.rawMetadata).toEqual({
      limitId: 'codex',
      limitName: 'Codex',
      planType: 'plus',
      credits: {
        hasCredits: true,
        unlimited: false,
        balancePresent: true,
        creditsExhausted: false
      },
      rateLimitReachedType: null
    });
  });

  it('prefers the codex bucket from rateLimitsByLimitId and preserves multiple windows', () => {
    const result = parse({
      rateLimits: {
        limitId: 'other',
        limitName: 'Other limit',
        primary: { usedPercent: 99, windowDurationMins: 60, resetsAt: 1778677200 },
        secondary: null,
        credits: { hasCredits: true, unlimited: true, balance: null },
        chatgptPlanType: 'team',
        rateLimitReachedType: null
      },
      rateLimitsByLimitId: {
        other: {
          limitId: 'other',
          limitName: 'Other limit',
          primary: { usedPercent: 99, windowDurationMins: 60, resetsAt: 1778677200 },
          secondary: null,
          credits: { hasCredits: true, unlimited: true, balance: null },
          chatgptPlanType: 'team',
          rateLimitReachedType: null
        },
        codex: {
          limitId: 'codex',
          limitName: 'Codex weekly quota',
          primary: {
            usedPercent: 11,
            windowDurationMins: 300,
            resetsAt: '2026-05-13T15:00:00.000Z'
          },
          secondary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1779030000000 },
          credits: { hasCredits: true, unlimited: true, balance: null },
          chatgptPlanType: 'pro',
          rateLimitReachedType: null
        }
      }
    });

    expect(result.windows).toEqual([
      {
        id: 'codex:5h',
        providerWindowName: '5-hour Codex limit',
        usedPercentage: 11,
        resetAt: '2026-05-13T15:00:00.000Z',
        hint: null
      },
      {
        id: 'codex:weekly',
        providerWindowName: 'Weekly Codex limit',
        usedPercentage: 22,
        resetAt: '2026-05-17T15:00:00.000Z',
        hint: null
      }
    ]);
    expect(result.rawMetadata).toMatchObject({ planType: 'pro' });
  });

  it('throws ProviderShapeChangedError for missing or invalid quota response shapes', () => {
    expect(() => parse({})).toThrow(ProviderShapeChangedError);
    expect(() =>
      parse({
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: '42', windowDurationMins: 300, resetsAt: 1778682600 },
          secondary: null,
          credits: { hasCredits: true, unlimited: false, balance: null },
          planType: 'plus',
          rateLimitReachedType: null
        }
      })
    ).toThrow(ProviderShapeChangedError);
  });

  it('represents exhausted credits and auth-required responses without leaking secrets', () => {
    const exhausted = parse({
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: secretSentinel },
        planType: 'plus',
        rateLimitReachedType: 'workspace_owner_credits_depleted'
      }
    });

    expect(exhausted).toMatchObject({
      status: 'unavailable',
      errorHint: 'Codex rate limit state: workspace_owner_credits_depleted',
      windows: [{ hint: 'workspace_owner_credits_depleted' }],
      rawMetadata: {
        credits: {
          hasCredits: false,
          unlimited: false,
          balancePresent: true,
          creditsExhausted: true
        }
      }
    });
    expect(JSON.stringify(exhausted)).not.toContain(secretSentinel);

    expect(() => parse({ status: 'auth_required', token: secretSentinel })).toThrow(
      AuthRequiredError
    );
  });

  it('maps app-server auth errors to auth-required without leaking payloads', () => {
    expect(() =>
      parse({
        error: {
          code: -32600,
          message: 'codex account authentication required to read rate limits'
        },
        id: 'aiqm-codex-rate-limits-read'
      })
    ).toThrow('Codex authentication token has been invalidated; re-login required');

    expect(() =>
      parse({
        error: {
          code: -32603,
          message:
            'failed to fetch codex rate limits: GET https://chatgpt.com/backend-api/wham/usage failed: 401 Unauthorized; body={"error":{"message":"Your authentication token has been invalidated. Please try signing in again.","code":"token_invalidated","secret":"' +
            secretSentinel +
            '"}}'
        },
        id: 'aiqm-codex-rate-limits-read'
      })
    ).toThrow('Codex authentication token has been invalidated; re-login required');
  });
});
