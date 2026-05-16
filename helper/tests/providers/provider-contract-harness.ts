import { describe, expect, it } from 'vitest';
import type { ConfiguredAccount } from '../../src/domain/index.js';
import type { ProviderAdapter } from '../../src/providers/index.js';
import { redactSecrets } from '../../src/diagnostics/index.js';
import { latestStateSchema } from '../../src/validation/index.js';

export type ProviderContractHarnessOptions = {
  providerName: string;
  expectedProviderId: ConfiguredAccount['provider'];
  createAdapter: () => ProviderAdapter;
  validAccount: ConfiguredAccount;
  expectedEmail: string;
  mismatchedEmail: string;
  secretSentinel: string;
};

export function describeProviderAdapterContract(options: ProviderContractHarnessOptions): void {
  describe(`${options.providerName} ProviderAdapter contract`, () => {
    it('exposes provider id and provider name', () => {
      const adapter = options.createAdapter();

      expect(adapter.providerId).toBe(options.expectedProviderId);
      expect(adapter.providerName).toEqual(expect.any(String));
      expect(adapter.providerName.length).toBeGreaterThan(0);
    });

    it('authenticates to a token reference without returning token payloads', async () => {
      const adapter = options.createAdapter();

      const auth = await adapter.authenticate({
        provider: options.expectedProviderId,
        expectedEmail: options.expectedEmail,
        interactive: false
      });

      expect(auth).toMatchObject({
        provider: options.expectedProviderId,
        email: options.expectedEmail,
        tokenRef: {
          provider: options.expectedProviderId,
          accountId: options.validAccount.id
        }
      });
      expect(JSON.stringify(auth)).not.toContain('tokenPayload');
      expect(JSON.stringify(auth)).not.toContain(options.secretSentinel);
    });

    it('supports auth session lifecycle without token payload leakage when available', async () => {
      const adapter = options.createAdapter();
      if (!adapter.authSessions) return;

      const session = await adapter.authSessions.startAuthSession({
        provider: options.expectedProviderId,
        expectedEmail: options.expectedEmail,
        interactive: false
      });
      expect(session).toMatchObject({
        provider: options.expectedProviderId,
        expectedEmail: options.expectedEmail,
        status: 'waiting',
        tokenRef: null
      });

      const completed = await adapter.authSessions.completeAuthSession({ sessionId: session.id });
      expect(completed).toMatchObject({
        provider: options.expectedProviderId,
        status: 'succeeded',
        authenticatedEmail: options.expectedEmail,
        tokenRef: {
          provider: options.expectedProviderId,
          accountId: options.validAccount.id
        }
      });
      expect(JSON.stringify(completed)).not.toContain('tokenPayload');
      expect(JSON.stringify(completed)).not.toContain(options.secretSentinel);
    });

    it('validates matching accounts and reports email mismatch', async () => {
      const adapter = options.createAdapter();
      const auth = await adapter.authenticate({
        provider: options.expectedProviderId,
        expectedEmail: options.expectedEmail,
        interactive: false
      });

      await expect(
        adapter.validateAccount(auth.tokenRef, options.expectedEmail)
      ).resolves.toMatchObject({
        provider: options.expectedProviderId,
        expectedEmail: options.expectedEmail,
        actualEmail: options.expectedEmail,
        matches: true,
        canReadQuota: true
      });

      await expect(
        adapter.validateAccount(auth.tokenRef, options.mismatchedEmail)
      ).resolves.toMatchObject({
        provider: options.expectedProviderId,
        expectedEmail: options.mismatchedEmail,
        actualEmail: options.expectedEmail,
        matches: false,
        canReadQuota: false
      });
    });

    it('fetches quota and normalises to latest-state-compatible display data', async () => {
      const adapter = options.createAdapter();

      const quota = await adapter.fetchQuota(options.validAccount);
      expect(quota.provider).toBe(options.expectedProviderId);
      expect(quota.accountEmail).toBe(options.expectedEmail);
      expect(quota.windows.length).toBeGreaterThan(0);

      const card = await adapter.normaliseQuota(options.validAccount, quota);
      const latestState = {
        schemaVersion: '1',
        generatedAt: quota.fetchedAt,
        accounts: [card]
      };

      expect(latestStateSchema.safeParse(latestState).success).toBe(true);
      expect(JSON.stringify(card)).not.toContain('rawMetadata');
      expect(JSON.stringify(card)).not.toContain('tokenPayload');
      expect(JSON.stringify(card)).not.toContain(options.secretSentinel);
    });

    it('does not leak raw provider metadata into normalised output', async () => {
      const adapter = options.createAdapter();
      const quota = await adapter.fetchQuota(options.validAccount);
      quota.rawMetadata = {
        secret: options.secretSentinel
      };

      const card = await adapter.normaliseQuota(options.validAccount, quota);
      const redactedMetadata = redactSecrets(quota.rawMetadata);

      expect(JSON.stringify(quota.rawMetadata)).toContain(options.secretSentinel);
      expect(JSON.stringify(redactedMetadata)).not.toContain(options.secretSentinel);
      expect(JSON.stringify(card)).not.toContain(options.secretSentinel);
      expect(JSON.stringify(card)).not.toContain('rawMetadata');
    });
  });
}
