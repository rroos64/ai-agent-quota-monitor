// Provenance: docs/test-traceability.md — Providers area
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthRequiredError } from '../../src/domain/index.js';
import {
  ProviderShapeChangedError,
  parseClaudeCodeAuthStatusResponse,
  parseClaudeCodeQuotaResponse
} from '../../src/providers/index.js';

const accountEmail = 'claude-user@example.test';
const fetchedAt = '2026-05-14T12:00:00.000Z';

function fixture(name: string): unknown {
  const path = resolve(process.cwd(), `../fixtures/providers/claude-code/${name}`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// Traceability: BR-043 / BR-043-AC-001, BR-043-AC-002, BR-043-AC-003; TSD CLAUDE-PARSER-001 redacted Claude Code auth/quota parsing contracts.
describe('Claude Code parser contracts', () => {
  it('parses redacted auth status metadata validated from the Claude Code CLI', () => {
    expect(
      parseClaudeCodeAuthStatusResponse(fixture('auth-status.redacted.example.json'), {
        expectedEmail: accountEmail
      })
    ).toEqual({
      provider: 'claude-code',
      expectedEmail: accountEmail,
      actualEmail: accountEmail,
      matches: true,
      canReadQuota: true,
      hint: 'pro'
    });
  });

  it('normalizes redacted quota windows into provider quota results', () => {
    expect(
      parseClaudeCodeQuotaResponse(fixture('quota-success.redacted.example.json'), {
        accountEmail,
        fetchedAt
      })
    ).toEqual({
      provider: 'claude-code',
      accountEmail,
      fetchedAt,
      status: 'fresh',
      windows: [
        {
          id: 'claude-code:5h',
          providerWindowName: '5-hour Claude Code limit',
          usedPercentage: 42.5,
          resetAt: '2026-05-14T18:00:00.000Z',
          hint: null
        },
        {
          id: 'claude-code:weekly',
          providerWindowName: 'Weekly Claude Code limit',
          usedPercentage: 61,
          resetAt: '2026-05-19T00:00:00.000Z',
          hint: null
        }
      ],
      errorHint: null,
      rawMetadata: { subscriptionType: 'pro', rateLimitReached: false }
    });
  });

  it('normalizes unofficial OAuth usage utilization as used percentage', () => {
    expect(
      parseClaudeCodeQuotaResponse(fixture('oauth-usage-success.redacted.example.json'), {
        accountEmail,
        fetchedAt
      }).windows
    ).toEqual([
      {
        id: 'claude-code:5h',
        providerWindowName: '5-hour Claude Code limit',
        usedPercentage: 33,
        resetAt: '2026-04-11T07:00:00.528Z',
        hint: null
      },
      {
        id: 'claude-code:weekly',
        providerWindowName: 'Weekly Claude Code limit',
        usedPercentage: 13,
        resetAt: '2026-04-17T00:59:59.951Z',
        hint: null
      },
      {
        id: 'claude-code:weekly-sonnet',
        providerWindowName: 'Weekly Claude Code Sonnet limit',
        usedPercentage: 1,
        resetAt: '2026-04-16T03:00:00.951Z',
        hint: null
      }
    ]);
  });

  it('derives stable ids and labels from window duration when Anthropic omits names', () => {
    expect(
      parseClaudeCodeQuotaResponse(
        {
          limits: [
            { usedPercentage: 10, windowDurationMins: 300, resetAt: 1_768_928_400_000 },
            { usagePercent: 20, windowDurationMins: 10080, resetAt: 1_769_360_400 }
          ]
        },
        { accountEmail, fetchedAt }
      ).windows
    ).toEqual([
      {
        id: 'claude-code:5h',
        providerWindowName: '5-hour Claude Code limit',
        usedPercentage: 10,
        resetAt: '2026-01-20T17:00:00.000Z',
        hint: null
      },
      {
        id: 'claude-code:weekly',
        providerWindowName: 'Weekly Claude Code limit',
        usedPercentage: 20,
        resetAt: '2026-01-25T17:00:00.000Z',
        hint: null
      }
    ]);
  });

  it('maps auth-required and reached-limit states safely', () => {
    expect(() =>
      parseClaudeCodeQuotaResponse({ status: 'auth_required' }, { accountEmail, fetchedAt })
    ).toThrow(AuthRequiredError);

    expect(() =>
      parseClaudeCodeQuotaResponse(
        {
          type: 'error',
          error: { type: 'authentication_error', message: 'Invalid authentication credentials' }
        },
        { accountEmail, fetchedAt }
      )
    ).toThrow(AuthRequiredError);

    expect(
      parseClaudeCodeQuotaResponse(
        {
          limitReached: true,
          limits: [{ usedPercent: 100, windowDurationMins: 300, resetsAt: null }]
        },
        { accountEmail, fetchedAt }
      )
    ).toMatchObject({
      status: 'unavailable',
      errorHint: 'Claude Code quota limit reached'
    });
  });

  it('rejects malformed quota shapes instead of guessing', () => {
    expect(() => parseClaudeCodeQuotaResponse({}, { accountEmail, fetchedAt })).toThrow(
      ProviderShapeChangedError
    );
    expect(() =>
      parseClaudeCodeQuotaResponse(
        { limits: [{ usedPercent: '42', windowDurationMins: 300 }] },
        { accountEmail, fetchedAt }
      )
    ).toThrow(ProviderShapeChangedError);
  });
});
