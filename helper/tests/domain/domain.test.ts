// Provenance: docs/test-traceability.md — Domain contracts area
import { describe, expect, it } from 'vitest';
import {
  accountIdFor,
  clampUsedPercentage,
  isAccountStatus,
  isErrorStatus,
  isProviderId,
  isValidUsedPercentage,
  normalizeEmail,
  providerDisplayName,
  statusFromError,
  AuthRequiredError,
  ConfigError,
  OfflineError,
  ProviderError
} from '../../src/domain/index.js';

// Traceability: BR: local quota domain model; AC: stable account identity/status/percentage rules; TS: TSD §5 domain model.
describe('domain helpers', () => {
  it('normalizes email addresses for stable account ids', () => {
    expect(normalizeEmail(' Dev@Example.COM ')).toBe('dev@example.com');
    expect(accountIdFor('codex', ' Dev@Example.COM ')).toBe('codex:dev@example.com');
  });

  it('recognizes supported providers and display names', () => {
    expect(isProviderId('codex')).toBe(true);
    expect(isProviderId('unknown')).toBe(false);
    expect(providerDisplayName('claude-code')).toBe('Claude Code');
  });

  it('recognizes account statuses and error statuses', () => {
    expect(isAccountStatus('fresh')).toBe(true);
    expect(isAccountStatus('broken')).toBe(false);
    expect(isErrorStatus('fresh')).toBe(false);
    expect(isErrorStatus('auth_required')).toBe(true);
  });

  it('validates and clamps quota percentages', () => {
    expect(isValidUsedPercentage(null)).toBe(true);
    expect(isValidUsedPercentage(0)).toBe(true);
    expect(isValidUsedPercentage(100)).toBe(true);
    expect(isValidUsedPercentage(-1)).toBe(false);
    expect(isValidUsedPercentage(101)).toBe(false);
    expect(clampUsedPercentage(-1)).toBe(0);
    expect(clampUsedPercentage(101)).toBe(100);
    expect(clampUsedPercentage(null)).toBeNull();
  });

  it('maps domain errors to account statuses', () => {
    expect(statusFromError(new AuthRequiredError())).toBe('auth_required');
    expect(statusFromError(new OfflineError())).toBe('offline');
    expect(statusFromError(new ProviderError())).toBe('provider_error');
    expect(statusFromError(new ConfigError())).toBe('config_error');
    expect(statusFromError(new Error('boom'))).toBe('provider_error');
  });
});
