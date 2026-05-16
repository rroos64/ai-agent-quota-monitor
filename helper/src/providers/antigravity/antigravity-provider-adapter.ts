import type {
  AccountValidationResult,
  ConfiguredAccount,
  ProviderQuotaResult
} from '../../domain/index.js';
import type { TokenRef } from '../../storage/index.js';
import {
  AbstractProviderAdapter,
  ProviderNotImplementedError,
  type AuthInput,
  type AuthResult
} from '../base/index.js';

export const ANTIGRAVITY_PROVIDER_ID = 'antigravity' as const;

const notYetImplemented = new ProviderNotImplementedError(
  'Antigravity provider is not yet implemented.'
);

export class AntigravityProviderAdapter extends AbstractProviderAdapter {
  readonly providerId = ANTIGRAVITY_PROVIDER_ID;
  readonly providerName = 'Antigravity';

  // Makes the inherited protected constructor explicitly public for external instantiation.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor() {
    super();
  }

  authenticate(_input: AuthInput): Promise<AuthResult> {
    return Promise.reject(notYetImplemented);
  }

  validateAccount(_tokenRef: TokenRef, _expectedEmail: string): Promise<AccountValidationResult> {
    return Promise.reject(notYetImplemented);
  }

  fetchQuota(_account: ConfiguredAccount): Promise<ProviderQuotaResult> {
    return Promise.reject(notYetImplemented);
  }
}
