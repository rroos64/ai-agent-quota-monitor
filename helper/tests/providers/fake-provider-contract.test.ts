// Provenance: docs/test-traceability.md — Providers area
import { accountIdFor, type ConfiguredAccount } from '../../src/domain/index.js';
import { FakeProviderAdapter, type Clock } from '../../src/providers/index.js';
import { describeProviderAdapterContract } from './provider-contract-harness.js';

const now = '2026-05-09T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

const fakeClock: Clock = {
  now: () => new Date(now),
  nowIso: () => now
};

const validAccount: ConfiguredAccount = {
  id: accountIdFor('fake', 'contract@example.com'),
  provider: 'fake',
  email: 'contract@example.com',
  displayOrder: 0,
  providerConfig: { scenario: 'success', ignoredSecretInput: secretSentinel },
  createdAt: now,
  updatedAt: now
};

// Traceability: BR: provider adapter extensibility; AC: shared provider contract validates auth/account/quota/normalisation/no-secret leakage; TS: TSD §6 Provider Adapter Design.
describeProviderAdapterContract({
  providerName: 'Fake',
  expectedProviderId: 'fake',
  createAdapter: () => new FakeProviderAdapter(fakeClock),
  validAccount,
  expectedEmail: 'contract@example.com',
  mismatchedEmail: 'other@example.com',
  secretSentinel
});
