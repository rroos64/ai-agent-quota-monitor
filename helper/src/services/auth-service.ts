import type { AuthSession, ProviderId } from '../domain/index.js';
import type {
  AuthSessionCompleteInput,
  AuthSessionStartInput,
  ProviderRegistry
} from '../providers/index.js';

export class AuthService {
  constructor(private readonly providerRegistry: ProviderRegistry) {}

  startSession(input: AuthSessionStartInput): Promise<AuthSession> {
    return this.capability(input.provider).startAuthSession(input);
  }

  getSession(provider: ProviderId, sessionId: string): Promise<AuthSession> {
    return this.capability(provider).getAuthSession(sessionId);
  }

  completeSession(provider: ProviderId, input: AuthSessionCompleteInput): Promise<AuthSession> {
    return this.capability(provider).completeAuthSession(input);
  }

  cancelSession(provider: ProviderId, sessionId: string): Promise<AuthSession> {
    return this.capability(provider).cancelAuthSession(sessionId);
  }

  private capability(provider: ProviderId) {
    const adapter = this.providerRegistry.get(provider);
    if (!adapter.authSessions) {
      throw new Error(`Provider does not support auth sessions: ${provider}`);
    }
    return adapter.authSessions;
  }
}
