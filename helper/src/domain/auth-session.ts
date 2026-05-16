import type { ProviderId } from './provider.js';
import type { TokenRef } from '../storage/index.js';

export type AuthSessionStatus = 'waiting' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export type AuthSessionFailureReason =
  | 'provider_error'
  | 'expired'
  | 'cancelled'
  | 'email_mismatch';

export type AuthSession = {
  id: string;
  provider: ProviderId;
  expectedEmail: string;
  status: AuthSessionStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  authenticatedEmail: string | null;
  tokenRef: TokenRef | null;
  failureReason: AuthSessionFailureReason | null;
  userMessage: string | null;
};
